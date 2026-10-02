import { Request, Response } from "express";
import { Types } from "mongoose";
import { FirmDocument, FirmMember, DocumentVersion, DocumentComment } from "../../models/firm";
import { firmIdOf, memberIdOf } from "../../utils/tenancy";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";

/**
 * LE-026 / LE-027 — the Docs editor.
 *
 * The rule the whole file turns on: **nothing is ever overwritten or deleted.**
 * A new version is added on top, and restoring an old one adds its content as a
 * new version rather than rolling back. A firm has to be able to show what a
 * document said on the day it was filed.
 */

/** Minutes between autosave checkpoints — LE-027 keeps one every ten. */
const CHECKPOINT_MINUTES = 10;

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase();

async function authorOf(req: Request): Promise<{ name: string; initials: string }> {
  const member = await FirmMember.findById(memberIdOf(req)).select("name").lean();
  const name = member?.name ?? "Someone at the firm";
  return { name, initials: initialsOf(name) };
}

/** Loads a document inside the caller's firm, or null. */
async function loadDoc(req: Request, id: string | string[]) {
  return FirmDocument.findOne({ _id: String(id), firmId: firmIdOf(req) });
}

async function nextVersionNumber(documentId: Types.ObjectId): Promise<number> {
  const latest = await DocumentVersion.findOne({ documentId })
    .sort({ number: -1 })
    .select("number")
    .lean();
  return (latest?.number ?? 0) + 1;
}

// ─── The document ────────────────────────────────────────────────────────────

/** GET /firm/documents/:id/editor */
export const getEditorDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await loadDoc(req, String(req.params.id));
    if (!doc) {
      sendNotFound(res, "That document is not in this firm");
      return;
    }

    const latest = await DocumentVersion.findOne({ documentId: doc._id })
      .sort({ number: -1 })
      .select("number")
      .lean();

    sendSuccess(
      res,
      {
        id: String(doc._id as Types.ObjectId),
        name: doc.name,
        status: doc.status,
        matterId: doc.matterId ? String(doc.matterId) : undefined,
        matterName: doc.matterName,
        html: doc.content ?? "",
        updatedAt: doc.updatedAt,
        versionNumber: latest?.number ?? 0,
        fromTemplate: doc.type === "Template",
        letterhead: true,
        pageSize: "A4",
        collaborators: [],
      },
      "Document retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to open that document", error);
  }
};

/**
 * PUT /firm/documents/:id/content — the autosave.
 *
 * Writes the body, and takes a checkpoint version every ten minutes of
 * editing rather than on every keystroke, so the history stays readable.
 * A filed or signed document is read-only: editing it must create a copy
 * rather than quietly changing what was filed.
 */
export const saveEditorContent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { html } = req.body as { html?: string };
    if (typeof html !== "string") {
      sendBadRequest(res, "Nothing to save");
      return;
    }

    const doc = await loadDoc(req, String(req.params.id));
    if (!doc) {
      sendNotFound(res, "That document is not in this firm");
      return;
    }
    if (doc.status === "filed") {
      sendBadRequest(res, "This document is filed. Make an editable copy to change it.");
      return;
    }

    doc.content = html;
    await doc.save();

    const latest = await DocumentVersion.findOne({ documentId: doc._id })
      .sort({ number: -1 })
      .lean();
    const dueForCheckpoint =
      !latest || Date.now() - new Date(latest.createdAt).getTime() > CHECKPOINT_MINUTES * 60_000;

    if (dueForCheckpoint) {
      const author = await authorOf(req);
      await DocumentVersion.create({
        firmId: firmIdOf(req),
        documentId: doc._id,
        number: await nextVersionNumber(doc._id as Types.ObjectId),
        authorName: author.name,
        authorInitials: author.initials,
        note: latest ? "Autosave" : "First draft",
        status: doc.status,
        html,
        size: Buffer.byteLength(html, "utf8"),
      });
    }

    sendSuccess(res, { updatedAt: new Date().toISOString() }, "Saved");
  } catch (error) {
    sendBadRequest(res, "Failed to save", error);
  }
};

/** POST /firm/documents/:id/rename — { name } */
export const renameEditorDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body as { name?: string };
    if (!name?.trim()) {
      sendBadRequest(res, "A document needs a name");
      return;
    }
    const doc = await loadDoc(req, String(req.params.id));
    if (!doc) {
      sendNotFound(res, "That document is not in this firm");
      return;
    }
    doc.name = name.trim();
    await doc.save();
    sendSuccess(res, { id: String(doc._id as Types.ObjectId), name: doc.name }, "Renamed");
  } catch (error) {
    sendBadRequest(res, "Failed to rename", error);
  }
};

/** POST /firm/documents/:id/copy — "Make an editable copy" for a filed document. */
export const copyEditorDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await loadDoc(req, String(req.params.id));
    if (!doc) {
      sendNotFound(res, "That document is not in this firm");
      return;
    }

    const copy = await FirmDocument.create({
      firmId: firmIdOf(req),
      name: `${doc.name} (copy)`,
      type: doc.type,
      matterId: doc.matterId,
      matterName: doc.matterName,
      status: "draft",
      content: doc.content ?? "",
    });

    const author = await authorOf(req);
    await DocumentVersion.create({
      firmId: firmIdOf(req),
      documentId: copy._id,
      number: 1,
      authorName: author.name,
      authorInitials: author.initials,
      note: `Copied from ${doc.name}`,
      status: "draft",
      html: copy.content ?? "",
      size: Buffer.byteLength(copy.content ?? "", "utf8"),
    });

    sendCreated(res, { id: String(copy._id), name: copy.name }, "Copy created");
  } catch (error) {
    sendBadRequest(res, "Failed to copy", error);
  }
};

// ─── Versions ────────────────────────────────────────────────────────────────

/** GET /firm/documents/:id/versions — the list, without bodies. */
export const listVersions = async (req: Request, res: Response): Promise<void> => {
  try {
    const doc = await loadDoc(req, String(req.params.id));
    if (!doc) {
      sendNotFound(res, "That document is not in this firm");
      return;
    }
    const rows = await DocumentVersion.find({ documentId: doc._id, firmId: firmIdOf(req) })
      .sort({ number: -1 })
      .select("-html")
      .lean();

    sendSuccess(
      res,
      rows.map((v) => ({
        id: String(v._id),
        number: v.number,
        authorName: v.authorName,
        authorInitials: v.authorInitials,
        createdAt: v.createdAt,
        note: v.note,
        status: v.status,
        size: v.size,
      })),
      "Versions retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve versions", error);
  }
};

/** GET /firm/documents/:id/versions/:versionId — one version, with its body. */
export const getVersion = async (req: Request, res: Response): Promise<void> => {
  try {
    const version = await DocumentVersion.findOne({
      _id: String(req.params.versionId),
      documentId: String(req.params.id),
      firmId: firmIdOf(req),
    }).lean();

    if (!version) {
      sendNotFound(res, "That version does not exist");
      return;
    }

    sendSuccess(
      res,
      {
        id: String(version._id),
        number: version.number,
        authorName: version.authorName,
        authorInitials: version.authorInitials,
        createdAt: version.createdAt,
        note: version.note,
        status: version.status,
        size: version.size,
        html: version.html,
      },
      "Version retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve that version", error);
  }
};

/** POST /firm/documents/:id/versions — { note } — an explicit "Save draft". */
export const createVersion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { note } = req.body as { note?: string };
    const doc = await loadDoc(req, String(req.params.id));
    if (!doc) {
      sendNotFound(res, "That document is not in this firm");
      return;
    }

    const author = await authorOf(req);
    const html = doc.content ?? "";
    const version = await DocumentVersion.create({
      firmId: firmIdOf(req),
      documentId: doc._id,
      number: await nextVersionNumber(doc._id as Types.ObjectId),
      authorName: author.name,
      authorInitials: author.initials,
      note: note?.trim() || "Saved draft",
      status: doc.status,
      html,
      size: Buffer.byteLength(html, "utf8"),
    });

    sendCreated(
      res,
      {
        id: String(version._id),
        number: version.number,
        authorName: version.authorName,
        authorInitials: version.authorInitials,
        createdAt: version.createdAt,
        note: version.note,
        status: version.status,
        size: version.size,
      },
      "Version saved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to save a version", error);
  }
};

/**
 * POST /firm/documents/:id/versions/:versionId/restore
 *
 * Restoring **adds** the old content as a new version. It never deletes
 * anything — that is an explicit acceptance criterion, and the reason a firm
 * can still show what the document said before someone restored it.
 */
export const restoreVersion = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const doc = await loadDoc(req, String(req.params.id));
    if (!doc) {
      sendNotFound(res, "That document is not in this firm");
      return;
    }

    const source = await DocumentVersion.findOne({
      _id: String(req.params.versionId),
      documentId: doc._id,
      firmId,
    }).lean();

    if (!source) {
      sendNotFound(res, "That version does not exist");
      return;
    }

    doc.content = source.html;
    await doc.save();

    const author = await authorOf(req);
    const created = await DocumentVersion.create({
      firmId,
      documentId: doc._id,
      number: await nextVersionNumber(doc._id as Types.ObjectId),
      authorName: author.name,
      authorInitials: author.initials,
      note: `Restored v${source.number}`,
      status: doc.status,
      html: source.html,
      size: source.size,
    });

    sendCreated(
      res,
      {
        id: String(created._id),
        number: created.number,
        authorName: created.authorName,
        authorInitials: created.authorInitials,
        createdAt: created.createdAt,
        note: created.note,
        status: created.status,
        size: created.size,
      },
      `Restored v${source.number} as v${created.number}`
    );
  } catch (error) {
    sendBadRequest(res, "Failed to restore that version", error);
  }
};

// ─── Comments ────────────────────────────────────────────────────────────────

const shapeComment = (c: IComment) => ({
  id: String(c._id),
  authorName: c.authorName,
  authorInitials: c.authorInitials,
  createdAt: c.createdAt,
  text: c.text,
  quote: c.quote,
  resolved: c.resolved,
  versionNumber: c.versionNumber,
  replies: (c.replies ?? []).map((r) => ({
    id: String(r._id),
    authorName: r.authorName,
    authorInitials: r.authorInitials,
    createdAt: r.createdAt,
    text: r.text,
  })),
});

interface IComment {
  _id: unknown;
  authorName: string;
  authorInitials?: string;
  createdAt: Date;
  text: string;
  quote: string;
  resolved: boolean;
  versionNumber?: number;
  replies: {
    _id?: unknown;
    authorName: string;
    authorInitials?: string;
    createdAt: Date;
    text: string;
  }[];
}

/** GET /firm/documents/:id/comments */
export const listComments = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await DocumentComment.find({
      documentId: String(req.params.id),
      firmId: firmIdOf(req),
    })
      .sort({ createdAt: 1 })
      .lean();
    sendSuccess(
      res,
      rows.map((r) => shapeComment(r as unknown as IComment)),
      "Comments retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve comments", error);
  }
};

/** POST /firm/documents/:id/comments — { text, quote, versionNumber } */
export const createComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, quote, versionNumber } = req.body as {
      text?: string;
      quote?: string;
      versionNumber?: number;
    };
    if (!text?.trim()) {
      sendBadRequest(res, "A comment needs something in it");
      return;
    }

    const doc = await loadDoc(req, String(req.params.id));
    if (!doc) {
      sendNotFound(res, "That document is not in this firm");
      return;
    }

    const author = await authorOf(req);
    const comment = await DocumentComment.create({
      firmId: firmIdOf(req),
      documentId: doc._id,
      authorName: author.name,
      authorInitials: author.initials,
      text: text.trim(),
      quote: quote ?? "",
      versionNumber,
    });

    sendCreated(res, shapeComment(comment as unknown as IComment), "Comment added");
  } catch (error) {
    sendBadRequest(res, "Failed to add that comment", error);
  }
};

/** POST /firm/documents/:id/comments/:commentId/replies — { text } */
export const replyToComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { text } = req.body as { text?: string };
    if (!text?.trim()) {
      sendBadRequest(res, "A reply needs something in it");
      return;
    }

    const comment = await DocumentComment.findOne({
      _id: String(req.params.commentId),
      documentId: String(req.params.id),
      firmId: firmIdOf(req),
    });
    if (!comment) {
      sendNotFound(res, "That comment does not exist");
      return;
    }

    const author = await authorOf(req);
    comment.replies.push({
      authorName: author.name,
      authorInitials: author.initials,
      text: text.trim(),
      createdAt: new Date(),
    });
    await comment.save();

    sendCreated(res, shapeComment(comment as unknown as IComment), "Reply added");
  } catch (error) {
    sendBadRequest(res, "Failed to reply", error);
  }
};

/** POST /firm/documents/:id/comments/:commentId/resolve — { resolved } */
export const resolveComment = async (req: Request, res: Response): Promise<void> => {
  try {
    const { resolved } = req.body as { resolved?: boolean };
    const comment = await DocumentComment.findOne({
      _id: String(req.params.commentId),
      documentId: String(req.params.id),
      firmId: firmIdOf(req),
    });
    if (!comment) {
      sendNotFound(res, "That comment does not exist");
      return;
    }

    comment.resolved = resolved !== false;
    await comment.save();

    sendSuccess(res, shapeComment(comment as unknown as IComment), "Comment updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update that comment", error);
  }
};
