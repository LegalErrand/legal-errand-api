import { Request, Response } from "express";
import { FirmClause, FirmMember } from "../../models/firm";
import { firmIdOf, memberIdOf } from "../../utils/tenancy";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";

/**
 * LE-029 — the firm's clause library.
 *
 * The library starts empty on purpose. A clause goes into documents that are
 * filed at court, so the only clauses here are ones the firm wrote itself;
 * there is no seeded list and nothing is generated.
 *
 * Every query is scoped to `firmId` — LE-029's acceptance criterion is that a
 * firm's own material is visible only to that firm.
 */

interface ClauseRow {
  _id: unknown;
  title: string;
  category: string;
  body: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const shapeClause = (c: ClauseRow) => ({
  id: String(c._id),
  title: c.title,
  category: c.category,
  body: c.body,
  createdByName: c.createdByName,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

/** GET /firm/clauses — the whole library, newest category-first ordering. */
export const listClauses = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await FirmClause.find({ firmId: firmIdOf(req) })
      .sort({ category: 1, title: 1 })
      .lean();
    sendSuccess(
      res,
      rows.map((r) => shapeClause(r as unknown as ClauseRow)),
      "Clauses retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve the clause library", error);
  }
};

/** POST /firm/clauses — { title, category, body } */
export const createClause = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, category, body } = req.body as {
      title?: string;
      category?: string;
      body?: string;
    };
    if (!title?.trim()) {
      sendBadRequest(res, "A clause needs a title");
      return;
    }
    if (!body?.trim()) {
      sendBadRequest(res, "A clause needs its text");
      return;
    }

    // The author's name is read from the token's member, never from the body.
    const member = await FirmMember.findOne({
      _id: memberIdOf(req),
      firmId: firmIdOf(req),
    })
      .select("name")
      .lean();

    const clause = await FirmClause.create({
      firmId: firmIdOf(req),
      title: title.trim(),
      category: category?.trim() || "General",
      body: body.trim(),
      createdByName: member?.name ?? "Someone at the firm",
      createdBy: memberIdOf(req),
    });

    sendCreated(res, shapeClause(clause as unknown as ClauseRow), "Clause added");
  } catch (error) {
    sendBadRequest(res, "Failed to add that clause", error);
  }
};

/** PATCH /firm/clauses/:id — { title?, category?, body? } */
export const updateClause = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, category, body } = req.body as {
      title?: string;
      category?: string;
      body?: string;
    };

    const clause = await FirmClause.findOne({
      _id: String(req.params.id),
      firmId: firmIdOf(req),
    });
    if (!clause) {
      sendNotFound(res, "That clause is not in this firm's library");
      return;
    }

    if (typeof title === "string") {
      if (!title.trim()) {
        sendBadRequest(res, "A clause needs a title");
        return;
      }
      clause.title = title.trim();
    }
    if (typeof category === "string" && category.trim()) clause.category = category.trim();
    if (typeof body === "string") {
      if (!body.trim()) {
        sendBadRequest(res, "A clause needs its text");
        return;
      }
      clause.body = body.trim();
    }

    await clause.save();
    sendSuccess(res, shapeClause(clause as unknown as ClauseRow), "Clause updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update that clause", error);
  }
};

/** DELETE /firm/clauses/:id */
export const deleteClause = async (req: Request, res: Response): Promise<void> => {
  try {
    const clause = await FirmClause.findOneAndDelete({
      _id: String(req.params.id),
      firmId: firmIdOf(req),
    }).lean();
    if (!clause) {
      sendNotFound(res, "That clause is not in this firm's library");
      return;
    }
    sendSuccess(res, { id: String(clause._id) }, "Clause removed");
  } catch (error) {
    sendBadRequest(res, "Failed to remove that clause", error);
  }
};
