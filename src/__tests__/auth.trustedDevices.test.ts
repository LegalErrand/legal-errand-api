import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../app";
import { Types } from "mongoose";
import { FirmMember } from "../models/firm";
import {
  makeFirm,
  makeMember,
  plantLoginCode,
  sessionToken,
  sha256,
  PASSWORD,
} from "./helpers/factories";

const API = "/api/v1/firm";

/** Password step, then the planted code, returning whatever verify answered. */
async function loginWithCode(
  email: string,
  memberId: Types.ObjectId | string,
  body: Record<string, unknown> = {}
) {
  const first = await request(app).post(`${API}/auth/login`).send({ email, password: PASSWORD });
  const code = await plantLoginCode(memberId);
  const second = await request(app)
    .post(`${API}/auth/login/verify`)
    .set("Authorization", `Bearer ${first.body.data.challengeToken}`)
    .send({ code, ...body });
  return second;
}

describe("trusted devices", () => {
  it("asks for a code when no device is presented", async () => {
    const firm = await makeFirm();
    const member = await makeMember(firm._id);

    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: member.email, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.challengeToken).toBeTruthy();
    expect(res.body.data.token).toBeUndefined();
  });

  it("issues a device token for seven days when asked", async () => {
    const firm = await makeFirm();
    const member = await makeMember(firm._id);

    const res = await loginWithCode(member.email, member._id, {
      trustDevice: true,
      deviceLabel: "Chambers iMac",
    });

    expect(res.body.data.deviceToken).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.data.deviceTrustDays).toBe(7);
  });

  it("skips the code on a trusted device, but never the password", async () => {
    const firm = await makeFirm();
    const member = await makeMember(firm._id);
    const { deviceToken } = (await loginWithCode(member.email, member._id, { trustDevice: true }))
      .body.data;

    const good = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: member.email, password: PASSWORD, deviceToken });
    expect(good.body.data.token).toBeTruthy();
    expect(good.body.data.challengeToken).toBeUndefined();

    // The device is no substitute for the password.
    const bad = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: member.email, password: "WrongPassword1!", deviceToken });
    expect(bad.status).toBe(401);
  });

  it("ignores an unknown, revoked or expired device", async () => {
    const firm = await makeFirm();
    const member = await makeMember(firm._id);
    const { deviceToken, token } = (
      await loginWithCode(member.email, member._id, { trustDevice: true })
    ).body.data;

    const unknown = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: member.email, password: PASSWORD, deviceToken: "a".repeat(64) });
    expect(unknown.body.data.challengeToken).toBeTruthy();

    const list = await request(app)
      .get(`${API}/auth/devices`)
      .set("Authorization", `Bearer ${token}`);
    const id = list.body.data.devices[0].id;
    await request(app)
      .delete(`${API}/auth/devices/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const revoked = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: member.email, password: PASSWORD, deviceToken });
    expect(revoked.body.data.challengeToken).toBeTruthy();

    // Expiry is enforced by the query, not a timer.
    await FirmMember.updateOne(
      { _id: member._id },
      {
        $set: {
          trustedDevices: [
            {
              id: "stale",
              tokenHash: sha256("stale-token"),
              expiresAt: new Date(Date.now() - 1000),
              createdAt: new Date(),
            },
          ],
        },
      }
    );
    const expired = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: member.email, password: PASSWORD, deviceToken: "stale-token" });
    expect(expired.body.data.challengeToken).toBeTruthy();
  });

  it("never lets a partner trust a device, even holding a valid token", async () => {
    const firm = await makeFirm();
    const partner = await makeMember(firm._id, {
      email: "partner@fixture.ng",
      role: "managing_partner",
    });

    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: partner.email, password: PASSWORD });
    expect(first.body.data.mayTrustDevice).toBe(false);

    const verified = await loginWithCode(partner.email, partner._id, { trustDevice: true });
    expect(verified.body.data.deviceToken).toBeUndefined();
    expect(verified.body.data.deviceTrustRefused).toBe(true);

    // A token planted directly is still refused, so a promotion to partner
    // closes the hole at once rather than when the token expires.
    await FirmMember.updateOne(
      { _id: partner._id },
      {
        $set: {
          trustedDevices: [
            {
              id: "smuggled",
              tokenHash: sha256("smuggled-token"),
              expiresAt: new Date(Date.now() + 86_400_000),
              createdAt: new Date(),
            },
          ],
        },
      }
    );
    const attempt = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: partner.email, password: PASSWORD, deviceToken: "smuggled-token" });
    expect(attempt.body.data.challengeToken).toBeTruthy();
    expect(attempt.body.data.token).toBeUndefined();
  });

  it("never returns a token hash from the device list", async () => {
    const firm = await makeFirm();
    const member = await makeMember(firm._id);
    const { token } = (await loginWithCode(member.email, member._id, { trustDevice: true })).body
      .data;

    const res = await request(app)
      .get(`${API}/auth/devices`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.body.data.mayTrustDevices).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("tokenHash");
  });

  it("scopes the device list to the caller", async () => {
    const firm = await makeFirm();
    const mine = await makeMember(firm._id);
    const theirs = await makeMember(firm._id, { email: "other@fixture.ng" });
    await loginWithCode(mine.email, mine._id, { trustDevice: true });

    const res = await request(app)
      .get(`${API}/auth/devices`)
      .set("Authorization", `Bearer ${sessionToken(theirs)}`);

    expect(res.body.data.devices).toHaveLength(0);
  });
});
