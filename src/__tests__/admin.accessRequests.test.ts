import request from "supertest";
import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import app from "../app";
import { FirmAccessGrant } from "../models/firm";
import { makeFirm, makeMember, adminToken } from "./helpers/factories";

const ADMIN = "/api/v1/admin/firms";
const FIRM = "/api/v1/firm";
const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

const ADMIN_ID = new Types.ObjectId().toString();
const OTHER_ADMIN_ID = new Types.ObjectId().toString();

async function firmWithOwner() {
  const firm = await makeFirm({ name: "Privileged Chambers" });
  const owner = await makeMember(firm._id, {
    email: "owner@privileged.ng",
    role: "managing_partner",
  });
  return { firm, owner };
}

/** Asks, then digs the raw decision token out by rewriting its hash. */
async function askAndLink(
  firmId: Types.ObjectId,
  adminId = ADMIN_ID,
  reason = "Investigating a report"
) {
  const res = await request(app)
    .post(`${ADMIN}/${firmId}/access-request`)
    .set("Authorization", `Bearer ${adminToken(adminId)}`)
    .send({ reason });

  // The raw token only ever exists in the email, so the test plants a known one.
  const token = "decision-" + adminId.slice(-6);
  await FirmAccessGrant.updateOne(
    { _id: res.body.data.grantId },
    { $set: { decisionTokenHash: sha256(token) } }
  );
  return { res, token, grantId: res.body.data.grantId as string };
}

describe("admin access requests", () => {
  it("records a request and grants nothing", async () => {
    const { firm, owner } = await firmWithOwner();

    const { res } = await askAndLink(firm._id as Types.ObjectId);

    expect(res.status).toBe(202);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.accessGranted).toBe(false);
    expect(res.body.data.owner.email).toBe(owner.email);
  });

  it("refuses to ask a firm with no managing partner", async () => {
    const firm = await makeFirm({ name: "Ownerless" });

    const res = await request(app)
      .post(`${ADMIN}/${firm._id}/access-request`)
      .set("Authorization", `Bearer ${adminToken(ADMIN_ID)}`)
      .send({ reason: "curiosity" });

    expect(res.status).toBe(409);
  });

  it("replaces an outstanding request rather than stacking links", async () => {
    const { firm } = await firmWithOwner();
    await askAndLink(firm._id as Types.ObjectId);
    await askAndLink(firm._id as Types.ObjectId);

    const pending = await FirmAccessGrant.countDocuments({
      firmId: firm._id,
      adminId: ADMIN_ID,
      status: "pending",
    });
    expect(pending).toBe(1);
  });

  it("will not mint a session while the request is only pending", async () => {
    const { firm } = await firmWithOwner();
    await askAndLink(firm._id as Types.ObjectId);

    const res = await request(app)
      .post(`${ADMIN}/${firm._id}/access-session`)
      .set("Authorization", `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(403);
  });

  it("shows the owner what is being asked, without a session", async () => {
    const { firm } = await firmWithOwner();
    const { token } = await askAndLink(firm._id as Types.ObjectId);

    const res = await request(app).get(`${FIRM}/access-request/${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.firmName).toBe("Privileged Chambers");
    expect(res.body.data.reason).toBe("Investigating a report");
    expect(res.body.data.hours).toBe(24);
  });

  it("approves once, and refuses a second answer", async () => {
    const { firm } = await firmWithOwner();
    const { token } = await askAndLink(firm._id as Types.ObjectId);

    const first = await request(app)
      .post(`${FIRM}/access-request/${token}/approve`)
      .send({ name: "Chief Adeyemi" });
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("approved");

    const second = await request(app).post(`${FIRM}/access-request/${token}/approve`).send({});
    expect(second.status).toBe(404);
  });

  it("declining leaves no usable grant", async () => {
    const { firm } = await firmWithOwner();
    const { token } = await askAndLink(firm._id as Types.ObjectId);

    await request(app).post(`${FIRM}/access-request/${token}/decline`).expect(200);

    const res = await request(app)
      .post(`${ADMIN}/${firm._id}/access-session`)
      .set("Authorization", `Bearer ${adminToken(ADMIN_ID)}`);
    expect(res.status).toBe(403);
  });

  it("mints a read-only session once approved, and records the use", async () => {
    const { firm } = await firmWithOwner();
    const { token, grantId } = await askAndLink(firm._id as Types.ObjectId);
    await request(app).post(`${FIRM}/access-request/${token}/approve`).send({});

    const res = await request(app)
      .post(`${ADMIN}/${firm._id}/access-session`)
      .set("Authorization", `Bearer ${adminToken(ADMIN_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.readOnly).toBe(true);

    const claims = JSON.parse(
      Buffer.from(res.body.data.token.split(".")[1], "base64").toString("utf8")
    );
    expect(claims.readOnly).toBe(true);
    expect(claims.firmId).toBe(String(firm._id));

    const grant = await FirmAccessGrant.findById(grantId);
    expect(grant?.uses).toHaveLength(1);
  });

  it("lets a read-only session read, and refuses every write", async () => {
    const { firm } = await firmWithOwner();
    const { token } = await askAndLink(firm._id as Types.ObjectId);
    await request(app).post(`${FIRM}/access-request/${token}/approve`).send({});
    const minted = await request(app)
      .post(`${ADMIN}/${firm._id}/access-session`)
      .set("Authorization", `Bearer ${adminToken(ADMIN_ID)}`);
    const session = minted.body.data.token;

    // Reading is the whole point.
    await request(app).get(`${FIRM}/auth/me`).set("Authorization", `Bearer ${session}`).expect(200);

    // Every unsafe method is refused by the middleware, whatever the route.
    for (const call of [
      request(app).post(`${FIRM}/signatures`).send({ kind: "typed", dataUrl: "x", name: "x" }),
      request(app).put(`${FIRM}/settings/payments/paystack`).send({ publicKey: "pk_x" }),
      request(app).delete(`${FIRM}/auth/devices`),
      request(app).patch(`${FIRM}/auth/me`).send({ name: "changed" }),
    ]) {
      const res = await call.set("Authorization", `Bearer ${session}`);
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/read-only/i);
    }
  });

  it("revoking ends a session that was already minted", async () => {
    const { firm, owner } = await firmWithOwner();
    const { token, grantId } = await askAndLink(firm._id as Types.ObjectId);
    await request(app).post(`${FIRM}/access-request/${token}/approve`).send({});
    const minted = await request(app)
      .post(`${ADMIN}/${firm._id}/access-session`)
      .set("Authorization", `Bearer ${adminToken(ADMIN_ID)}`);
    const session = minted.body.data.token;

    await request(app).get(`${FIRM}/auth/me`).set("Authorization", `Bearer ${session}`).expect(200);

    const { sessionToken } = await import("./helpers/factories");
    await request(app)
      .post(`${FIRM}/access-grants/${grantId}/revoke`)
      .set("Authorization", `Bearer ${sessionToken(owner)}`)
      .expect(200);

    // The token is still cryptographically valid; the grant behind it is not.
    const after = await request(app)
      .get(`${FIRM}/auth/me`)
      .set("Authorization", `Bearer ${session}`);
    expect(after.status).toBe(401);
  });

  it("will not let one admin use another's grant", async () => {
    const { firm } = await firmWithOwner();
    const { token } = await askAndLink(firm._id as Types.ObjectId, ADMIN_ID);
    await request(app).post(`${FIRM}/access-request/${token}/approve`).send({});

    const res = await request(app)
      .post(`${ADMIN}/${firm._id}/access-session`)
      .set("Authorization", `Bearer ${adminToken(OTHER_ADMIN_ID)}`);

    expect(res.status).toBe(403);
  });

  it("refuses an expired decision link", async () => {
    const { firm } = await firmWithOwner();
    const { token, grantId } = await askAndLink(firm._id as Types.ObjectId);
    await FirmAccessGrant.updateOne(
      { _id: grantId },
      { $set: { decisionExpiresAt: new Date(Date.now() - 1000) } }
    );

    await request(app).get(`${FIRM}/access-request/${token}`).expect(404);
    await request(app).post(`${FIRM}/access-request/${token}/approve`).send({}).expect(404);
  });

  it("refuses a session once the grant's own window has passed", async () => {
    const { firm } = await firmWithOwner();
    const { token, grantId } = await askAndLink(firm._id as Types.ObjectId);
    await request(app).post(`${FIRM}/access-request/${token}/approve`).send({});
    await FirmAccessGrant.updateOne(
      { _id: grantId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );

    const res = await request(app)
      .post(`${ADMIN}/${firm._id}/access-session`)
      .set("Authorization", `Bearer ${adminToken(ADMIN_ID)}`);
    expect(res.status).toBe(403);
  });

  it("shows a firm its own grants, and only its own", async () => {
    const { firm, owner } = await firmWithOwner();
    await askAndLink(firm._id as Types.ObjectId);

    const other = await makeFirm({ name: "Unrelated", contactEmail: "z@unrelated.ng" });
    const outsider = await makeMember(other._id, {
      email: "boss@unrelated.ng",
      role: "managing_partner",
    });

    const { sessionToken } = await import("./helpers/factories");
    const mine = await request(app)
      .get(`${FIRM}/access-grants`)
      .set("Authorization", `Bearer ${sessionToken(owner)}`);
    expect(mine.body.data.grants).toHaveLength(1);
    expect(JSON.stringify(mine.body)).not.toContain("decisionTokenHash");

    const theirs = await request(app)
      .get(`${FIRM}/access-grants`)
      .set("Authorization", `Bearer ${sessionToken(outsider)}`);
    expect(theirs.body.data.grants).toHaveLength(0);
  });

  it("only lets a partner revoke", async () => {
    const { firm } = await firmWithOwner();
    const { token, grantId } = await askAndLink(firm._id as Types.ObjectId);
    await request(app).post(`${FIRM}/access-request/${token}/approve`).send({});

    const associate = await makeMember(firm._id, {
      email: "junior@privileged.ng",
      role: "associate",
    });

    const { sessionToken } = await import("./helpers/factories");
    const res = await request(app)
      .post(`${FIRM}/access-grants/${grantId}/revoke`)
      .set("Authorization", `Bearer ${sessionToken(associate)}`);

    expect(res.status).toBe(403);
  });
});
