import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../app";
import { makeFirm, makeMember, plantLoginCode, PASSWORD } from "./helpers/factories";

const API = "/api/v1/firm";
const EMAIL = "shared@twofirms.ng";

/** The same person at two firms, on one address and one password. */
async function twoMemberships(secondRole = "associate") {
  const a = await makeFirm({ name: "First Chambers", contactEmail: "a@twofirms.ng" });
  const b = await makeFirm({ name: "Second Chambers", contactEmail: "b@twofirms.ng" });
  const atA = await makeMember(a._id, { email: EMAIL, role: "senior_associate" });
  const atB = await makeMember(b._id, { email: EMAIL, role: secondRole });
  return { a, b, atA, atB };
}

describe("multi-firm membership", () => {
  it("sends one code, then asks which firm", async () => {
    const { a, b, atA } = await twoMemberships();

    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD });
    expect(first.body.data.challengeToken).toBeTruthy();

    const code = await plantLoginCode(atA._id);
    const res = await request(app)
      .post(`${API}/auth/login/verify`)
      .set("Authorization", `Bearer ${first.body.data.challengeToken}`)
      .send({ code });

    expect(res.body.data.needsFirmChoice).toBe(true);
    // Crucially, no session yet.
    expect(res.body.data.token).toBeUndefined();
    expect(res.body.data.firms.map((f: { firmId: string }) => f.firmId).sort()).toEqual(
      [String(a._id), String(b._id)].sort()
    );
  });

  it("issues a session for the firm that was chosen", async () => {
    const { b, atA, atB } = await twoMemberships();
    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD });
    const code = await plantLoginCode(atA._id);
    const verified = await request(app)
      .post(`${API}/auth/login/verify`)
      .set("Authorization", `Bearer ${first.body.data.challengeToken}`)
      .send({ code });

    const res = await request(app)
      .post(`${API}/auth/login/firm`)
      .set("Authorization", `Bearer ${verified.body.data.choiceToken}`)
      .send({ memberId: String(atB._id) });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    expect(String(res.body.data.firm._id ?? res.body.data.firm.id)).toBe(String(b._id));
  });

  it("refuses a membership the choice token was not minted for", async () => {
    const { atA } = await twoMemberships();
    const elsewhere = await makeFirm({ name: "Elsewhere", contactEmail: "c@elsewhere.ng" });
    const stranger = await makeMember(elsewhere._id, { email: "stranger@elsewhere.ng" });

    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD });
    const code = await plantLoginCode(atA._id);
    const verified = await request(app)
      .post(`${API}/auth/login/verify`)
      .set("Authorization", `Bearer ${first.body.data.challengeToken}`)
      .send({ code });

    const res = await request(app)
      .post(`${API}/auth/login/firm`)
      .set("Authorization", `Bearer ${verified.body.data.choiceToken}`)
      .send({ memberId: String(stranger._id) });

    expect(res.status).toBe(403);
  });

  it("will not accept a challenge token as a choice token", async () => {
    const { atA, atB } = await twoMemberships();
    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD });
    await plantLoginCode(atA._id);

    const res = await request(app)
      .post(`${API}/auth/login/firm`)
      .set("Authorization", `Bearer ${first.body.data.challengeToken}`)
      .send({ memberId: String(atB._id) });

    expect(res.status).toBe(401);
  });

  it("opens only the memberships the password matches", async () => {
    const a = await makeFirm({ name: "Matching", contactEmail: "a@split.ng" });
    const b = await makeFirm({ name: "Different password", contactEmail: "b@split.ng" });
    const atA = await makeMember(a._id, { email: "split@split.ng" });
    const atB = await makeMember(b._id, { email: "split@split.ng" });
    atB.set("password", "ADifferentPassword456!");
    await atB.save();

    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: "split@split.ng", password: PASSWORD });
    const code = await plantLoginCode(atA._id);
    const res = await request(app)
      .post(`${API}/auth/login/verify`)
      .set("Authorization", `Bearer ${first.body.data.challengeToken}`)
      .send({ code });

    // Only one firm answered, so there is nothing to choose.
    expect(res.body.data.needsFirmChoice).toBeUndefined();
    expect(res.body.data.token).toBeTruthy();
  });

  it("keeps a partner membership out of the trusted-device skip", async () => {
    const { a, atA, atB } = await twoMemberships("managing_partner");

    const first = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD });
    const code = await plantLoginCode(atA._id);
    const verified = await request(app)
      .post(`${API}/auth/login/verify`)
      .set("Authorization", `Bearer ${first.body.data.challengeToken}`)
      .send({ code, trustDevice: true });

    const chosen = await request(app)
      .post(`${API}/auth/login/firm`)
      .set("Authorization", `Bearer ${verified.body.data.choiceToken}`)
      .send({ memberId: String(atA._id) });
    expect(chosen.status).toBe(200);

    // The device covers the senior-associate firm only, so there is no choice
    // left to make and the partner firm is not reachable without a code.
    const again = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD, deviceToken: verified.body.data.deviceToken });

    expect(again.body.data.needsFirmChoice).toBeUndefined();
    expect(String(again.body.data.firm._id ?? again.body.data.firm.id)).toBe(String(a._id));
    expect(String(again.body.data.member.firmId)).not.toBe(String(atB.firmId));
  });
});
