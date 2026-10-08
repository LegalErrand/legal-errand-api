import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../app";
import { makeFirm, makeMember, sessionToken } from "./helpers/factories";

const API = "/api/v1/firm";
const EMAIL = "shared@twofirms.ng";

describe("switching firms in-session", () => {
  it("lists every firm the session's address belongs to, marking the current one", async () => {
    const a = await makeFirm({ name: "First", contactEmail: "a@twofirms.ng" });
    const b = await makeFirm({ name: "Second", contactEmail: "b@twofirms.ng" });
    const atA = await makeMember(a._id, { email: EMAIL, role: "partner" });
    await makeMember(b._id, { email: EMAIL, role: "associate" });

    const res = await request(app)
      .get(`${API}/auth/my-firms`)
      .set("Authorization", `Bearer ${sessionToken(atA)}`);

    expect(res.body.data.firms).toHaveLength(2);
    const current = res.body.data.firms.find((f: { isCurrent: boolean }) => f.isCurrent);
    expect(current.firmId).toBe(String(a._id));
  });

  it("issues a token for the firm switched to", async () => {
    const a = await makeFirm({ name: "First", contactEmail: "a@twofirms.ng" });
    const b = await makeFirm({ name: "Second", contactEmail: "b@twofirms.ng" });
    const atA = await makeMember(a._id, { email: EMAIL, role: "partner" });
    const atB = await makeMember(b._id, { email: EMAIL, role: "associate" });

    const res = await request(app)
      .post(`${API}/auth/switch-firm`)
      .set("Authorization", `Bearer ${sessionToken(atA)}`)
      .send({ memberId: String(atB._id) });

    expect(res.status).toBe(200);
    expect(String(res.body.data.firm._id ?? res.body.data.firm.id)).toBe(String(b._id));

    const claims = JSON.parse(
      Buffer.from(res.body.data.token.split(".")[1], "base64").toString("utf8")
    );
    expect(claims.firmId).toBe(String(b._id));
    // The role travels with the membership, not the session it came from.
    expect(claims.role).toBe("associate");
  });

  it("refuses a membership belonging to somebody else", async () => {
    const a = await makeFirm({ name: "Mine", contactEmail: "a@mine.ng" });
    const b = await makeFirm({ name: "Theirs", contactEmail: "b@theirs.ng" });
    const me = await makeMember(a._id, { email: "me@mine.ng" });
    const them = await makeMember(b._id, { email: "them@theirs.ng", role: "managing_partner" });

    const res = await request(app)
      .post(`${API}/auth/switch-firm`)
      .set("Authorization", `Bearer ${sessionToken(me)}`)
      .send({ memberId: String(them._id) });

    expect(res.status).toBe(404);
  });

  it("refuses a deactivated membership", async () => {
    const a = await makeFirm({ name: "First", contactEmail: "a@twofirms.ng" });
    const b = await makeFirm({ name: "Second", contactEmail: "b@twofirms.ng" });
    const atA = await makeMember(a._id, { email: EMAIL });
    const atB = await makeMember(b._id, { email: EMAIL, isActive: false });

    const res = await request(app)
      .post(`${API}/auth/switch-firm`)
      .set("Authorization", `Bearer ${sessionToken(atA)}`)
      .send({ memberId: String(atB._id) });

    expect(res.status).toBe(404);
  });

  it("needs a session at all", async () => {
    await request(app).get(`${API}/auth/my-firms`).expect(401);
  });
});
