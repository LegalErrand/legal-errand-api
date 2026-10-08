import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../app";
import { FirmInvitation, FirmJoinRequest, FirmMember } from "../models/firm";
import { makeFirm, makeMember, sessionToken } from "./helpers/factories";

const API = "/api/v1/firm";
const DOMAIN = "claimed-firm.ng";
const ASKER = `newlawyer@${DOMAIN}`;

async function firmOwningDomain(role = "managing_partner") {
  const firm = await makeFirm({
    name: "Claimed Chambers",
    contactEmail: `partner@${DOMAIN}`,
    domain: DOMAIN,
  });
  const partner = await makeMember(firm._id, { email: `partner@${DOMAIN}`, role });
  return { firm, partner };
}

describe("finding a firm by domain", () => {
  it("offers the firm, with its headcount", async () => {
    const { firm } = await firmOwningDomain();

    const res = await request(app).get(`${API}/auth/firm-by-domain`).query({ email: ASKER });

    expect(res.body.data.firm.name).toBe(firm.name);
    expect(res.body.data.firm.domain).toBe(DOMAIN);
    expect(res.body.data.firm.memberCount).toBe(1);
  });

  it("never matches a free mailbox", async () => {
    await makeFirm({ name: "Gmail Chambers", contactEmail: "x@gmail.com", domain: "gmail.com" });

    const res = await request(app)
      .get(`${API}/auth/firm-by-domain`)
      .query({ email: "someone@gmail.com" });

    expect(res.body.data.firm).toBeNull();
  });

  it("answers null rather than erroring for unknown or malformed input", async () => {
    for (const email of ["nobody@nowhere.test", "not-an-email", ""]) {
      const res = await request(app).get(`${API}/auth/firm-by-domain`).query({ email });
      expect(res.status).toBe(200);
      expect(res.body.data.firm).toBeNull();
    }
  });
});

describe("join requests", () => {
  it("records a request and refreshes rather than stacking", async () => {
    const { firm } = await firmOwningDomain();

    const first = await request(app)
      .post(`${API}/auth/join-request`)
      .send({ email: ASKER, note: "First ask." });
    expect(first.status).toBe(201);
    expect(first.body.data.firmName).toBe(firm.name);

    await request(app).post(`${API}/auth/join-request`).send({ email: ASKER, note: "Second ask." });

    const rows = await FirmJoinRequest.find({ firmId: firm._id, email: ASKER, status: "pending" });
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe("Second ask.");
  });

  it("refuses someone who is already a member", async () => {
    const { partner } = await firmOwningDomain();

    const res = await request(app).post(`${API}/auth/join-request`).send({ email: partner.email });

    expect(res.status).toBe(409);
  });

  it("shows the queue to the firm, and to nobody else", async () => {
    const { firm, partner } = await firmOwningDomain();
    await request(app).post(`${API}/auth/join-request`).send({ email: ASKER, note: "Let me in." });

    const mine = await request(app)
      .get(`${API}/join-requests`)
      .set("Authorization", `Bearer ${sessionToken(partner)}`);
    expect(mine.body.data.requests).toHaveLength(1);
    expect(mine.body.data.requests[0].note).toBe("Let me in.");

    const other = await makeFirm({ name: "Unrelated", contactEmail: "z@unrelated.ng" });
    const outsider = await makeMember(other._id, {
      email: "boss@unrelated.ng",
      role: "managing_partner",
    });
    const theirs = await request(app)
      .get(`${API}/join-requests`)
      .set("Authorization", `Bearer ${sessionToken(outsider)}`);
    expect(theirs.body.data.requests).toHaveLength(0);

    const id = mine.body.data.requests[0].id;
    const steal = await request(app)
      .post(`${API}/join-requests/${id}/approve`)
      .set("Authorization", `Bearer ${sessionToken(outsider)}`)
      .send({ role: "associate" });
    expect(steal.status).toBe(404);
    expect(firm).toBeTruthy();
  });

  it("limits acting on a request to partners and admins", async () => {
    const { partner } = await firmOwningDomain();
    await request(app).post(`${API}/auth/join-request`).send({ email: ASKER });
    const queue = await request(app)
      .get(`${API}/join-requests`)
      .set("Authorization", `Bearer ${sessionToken(partner)}`);
    const id = queue.body.data.requests[0].id;

    const associate = await makeMember(partner.firmId, {
      email: "junior@claimed-firm.ng",
      role: "associate",
    });

    const res = await request(app)
      .post(`${API}/join-requests/${id}/approve`)
      .set("Authorization", `Bearer ${sessionToken(associate)}`)
      .send({ role: "paralegal" });

    expect(res.status).toBe(403);
  });

  it("will not admit anyone above the approver's own role", async () => {
    const { partner } = await firmOwningDomain("partner");
    await request(app).post(`${API}/auth/join-request`).send({ email: ASKER });
    const queue = await request(app)
      .get(`${API}/join-requests`)
      .set("Authorization", `Bearer ${sessionToken(partner)}`);
    const id = queue.body.data.requests[0].id;

    const res = await request(app)
      .post(`${API}/join-requests/${id}/approve`)
      .set("Authorization", `Bearer ${sessionToken(partner)}`)
      .send({ role: "managing_partner" });

    expect(res.status).toBe(403);
  });

  it("approves by issuing an invitation, not by creating the account", async () => {
    const { firm, partner } = await firmOwningDomain();
    await request(app).post(`${API}/auth/join-request`).send({ email: ASKER });
    const queue = await request(app)
      .get(`${API}/join-requests`)
      .set("Authorization", `Bearer ${sessionToken(partner)}`);
    const id = queue.body.data.requests[0].id;

    const res = await request(app)
      .post(`${API}/join-requests/${id}/approve`)
      .set("Authorization", `Bearer ${sessionToken(partner)}`)
      .send({ role: "associate" });
    expect(res.status).toBe(200);

    const invite = await FirmInvitation.findOne({ firmId: firm._id, email: ASKER });
    expect(invite?.role).toBe("associate");

    // The person still accepts and sets their own password.
    expect(await FirmMember.findOne({ email: ASKER })).toBeNull();

    const closed = await FirmJoinRequest.findById(id);
    expect(closed?.status).toBe("approved");
    expect(closed?.decidedBy).toBeTruthy();

    // Spent, so it cannot be approved twice.
    const again = await request(app)
      .post(`${API}/join-requests/${id}/approve`)
      .set("Authorization", `Bearer ${sessionToken(partner)}`)
      .send({ role: "associate" });
    expect(again.status).toBe(404);
  });

  it("declines without telling the asker", async () => {
    const { partner } = await firmOwningDomain();
    await request(app).post(`${API}/auth/join-request`).send({ email: ASKER });
    const queue = await request(app)
      .get(`${API}/join-requests`)
      .set("Authorization", `Bearer ${sessionToken(partner)}`);
    const id = queue.body.data.requests[0].id;

    const res = await request(app)
      .post(`${API}/join-requests/${id}/decline`)
      .set("Authorization", `Bearer ${sessionToken(partner)}`);
    expect(res.status).toBe(200);

    const closed = await FirmJoinRequest.findById(id);
    expect(closed?.status).toBe("declined");
    expect(await FirmInvitation.findOne({ email: ASKER })).toBeNull();
  });
});
