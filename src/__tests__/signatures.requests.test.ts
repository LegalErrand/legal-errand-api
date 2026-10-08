import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "../app";
import { Types } from "mongoose";
import { FirmDocument, SignatureRequest } from "../models/firm";
import { makeFirm, makeMember, sessionToken } from "./helpers/factories";

const API = "/api/v1/firm";

async function docWithRequest(firmId: Types.ObjectId, requestedBy: Types.ObjectId, email: string) {
  const doc = await FirmDocument.create({
    firmId,
    name: "Deed of assignment",
    type: "Contract",
    status: "draft",
    modifiedText: "just now",
    aiTags: [],
    content: "<p>The parties agree.</p>",
  });
  const req = await SignatureRequest.create({
    firmId,
    documentId: doc._id,
    name: "Chief Adeyemi",
    capacity: "Assignor",
    email,
    status: "pending",
    requestedBy,
    requestedAt: new Date(),
    tokenId: Math.random().toString(16).slice(2),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { doc, req };
}

describe("listing signature requests", () => {
  it("lists what a document was sent out for", async () => {
    const firm = await makeFirm();
    const member = await makeMember(firm._id, { role: "partner" });
    const { doc } = await docWithRequest(firm._id, member._id, "signer@example.ng");

    const res = await request(app)
      .get(`${API}/signatures/requests`)
      .query({ documentId: String(doc._id) })
      .set("Authorization", `Bearer ${sessionToken(member)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.requests).toHaveLength(1);
    expect(res.body.data.requests[0].name).toBe("Chief Adeyemi");
    expect(res.body.data.requests[0].requestedByName).toBe(member.name);
    expect(res.body.data.requests[0].spent).toBe(false);
  });

  it("never returns another firm's requests", async () => {
    const mine = await makeFirm({ name: "Mine", contactEmail: "a@mine.ng" });
    const theirs = await makeFirm({ name: "Theirs", contactEmail: "b@theirs.ng" });
    const me = await makeMember(mine._id, { email: "me@mine.ng", role: "partner" });
    const them = await makeMember(theirs._id, { email: "them@theirs.ng", role: "partner" });
    const { doc } = await docWithRequest(theirs._id, them._id, "signer@example.ng");

    const res = await request(app)
      .get(`${API}/signatures/requests`)
      .query({ documentId: String(doc._id) })
      .set("Authorization", `Bearer ${sessionToken(me)}`);

    expect(res.body.data.requests).toHaveLength(0);
  });

  it("marks an expired link as spent even while pending", async () => {
    const firm = await makeFirm();
    const member = await makeMember(firm._id, { role: "partner" });
    const { doc, req } = await docWithRequest(firm._id, member._id, "signer@example.ng");
    await SignatureRequest.updateOne(
      { _id: req._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );

    const res = await request(app)
      .get(`${API}/signatures/requests`)
      .query({ documentId: String(doc._id) })
      .set("Authorization", `Bearer ${sessionToken(member)}`);

    expect(res.body.data.requests[0].status).toBe("pending");
    expect(res.body.data.requests[0].spent).toBe(true);
  });

  it("does not leak the certificate's evidence into the list", async () => {
    const firm = await makeFirm();
    const member = await makeMember(firm._id, { role: "partner" });
    const { doc } = await docWithRequest(firm._id, member._id, "signer@example.ng");

    const res = await request(app)
      .get(`${API}/signatures/requests`)
      .query({ documentId: String(doc._id) })
      .set("Authorization", `Bearer ${sessionToken(member)}`);

    const body = JSON.stringify(res.body);
    for (const field of ["signerIp", "signerUserAgent", "documentHash", "tokenId"]) {
      expect(body).not.toContain(field);
    }
  });
});
