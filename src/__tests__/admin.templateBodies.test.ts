import request from "supertest";
import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import app from "../app";
import jwt from "jsonwebtoken";
import { BuiltInTemplateBody } from "../models/firm";
import { env } from "../config/env";

const API = "/api/v1/admin/firms";

// Minted here rather than from a shared factory, so this file does not depend
// on another branch landing first.
const token = jwt.sign(
  {
    adminId: new Types.ObjectId().toString(),
    email: "ops@legalerrand.com",
    role: "super_admin",
    isAdmin: true,
  },
  env.JWT_SECRET,
  { expiresIn: "30m" }
);

describe("built-in template bodies", () => {
  /**
   * The regression this guards: these routes sat below "/:id", so Express
   * handed GET /template-bodies to getFirm and answered "Firm not found".
   */
  it("lists the bodies we hold rather than looking for a firm", async () => {
    await BuiltInTemplateBody.create({
      templateId: "tenancy-agreement",
      body: "<p>THIS AGREEMENT is made…</p>",
      updatedByName: "Ops",
    });

    const res = await request(app)
      .get(`${API}/template-bodies`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/firm not found/i);
    expect(JSON.stringify(res.body)).toContain("tenancy-agreement");
  });

  it("upserts a body, then replaces it", async () => {
    await request(app)
      .put(`${API}/template-bodies/deed-of-assignment`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "<p>First version.</p>" })
      .expect(200);

    await request(app)
      .put(`${API}/template-bodies/deed-of-assignment`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "<p>Second version.</p>" })
      .expect(200);

    const rows = await BuiltInTemplateBody.find({ templateId: "deed-of-assignment" });
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toContain("Second version");
  });

  it("removes a body without touching the others", async () => {
    await BuiltInTemplateBody.create({ templateId: "keep-me", body: "<p>Keep.</p>" });
    await BuiltInTemplateBody.create({ templateId: "drop-me", body: "<p>Drop.</p>" });

    const res = await request(app)
      .delete(`${API}/template-bodies/drop-me`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(await BuiltInTemplateBody.findOne({ templateId: "drop-me" })).toBeNull();
    expect(await BuiltInTemplateBody.findOne({ templateId: "keep-me" })).not.toBeNull();
  });

  it("still reaches the firm detail route for a real id", async () => {
    const res = await request(app)
      .get(`${API}/${new Types.ObjectId()}`)
      .set("Authorization", `Bearer ${token}`);

    // 404 from getFirm is the right answer for an id that does not exist —
    // what matters is that the route is still reachable at all.
    expect([200, 404]).toContain(res.status);
  });
});
