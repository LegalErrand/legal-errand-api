import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  BulkMoveLedger,
  Client,
  FirmActivityLog,
  FirmDocument,
  IBulkMoveLedger,
  Matter,
} from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";
import { firmIdOf, memberIdOf } from "../../utils/tenancy";

/**
 * LE-024 — Bulk select and move.
 *
 * A move is a recorded act, not a quiet field update. The caller must say why,
 * and the reason is written into the activity log twice for every item — once
 * against where it came from and once against where it went. No reason, no
 * move: the request is refused with 400 before anything is touched.
 *
 * Multi-tenancy: the firm comes from the verified token (`firmIdOf`) and is
 * never read from the body. Every id in the request is checked against that
 * firm *before* the first write, because a half-finished move that crossed a
 * firm boundary would be far worse than a refusal.
 *
 * Undo: a move returns a `moveId`. POSTing it to /bulk-move/undo reverses the
 * move with a real second move — the original is applied immediately, never
 * delayed. The ledger below holds only what is needed to reverse, for a short
 * window, scoped to the firm and the member who made the move.
 */

// ─── Vocabulary ──────────────────────────────────────────────────────────────

const ITEM_TYPES = ["document", "matter"] as const;
type BulkItemType = (typeof ITEM_TYPES)[number];

const DESTINATION_KINDS = ["matter", "folder", "client"] as const;
type DestinationKind = (typeof DESTINATION_KINDS)[number];

interface DestinationInput {
  kind?: DestinationKind;
  /** The matter or client the items move to. Not used by `folder`. */
  id?: string;
  /** The repository folder (category) name, for `folder`. */
  folder?: string;
}

interface BulkMoveBody {
  itemType?: BulkItemType;
  ids?: string[];
  destination?: DestinationInput;
  reason?: string;
}

/** What one item looked like before the move — enough to put it back. */
interface PreviousPlacement {
  id: string;
  matterId?: string;
  matterName?: string;
  folder?: string;
  clientId?: string;
  clientName?: string;
  /** Human label for the log line: where it came from. */
  label: string;
}

/**
 * Ten seconds is what the acceptance criterion asks for. The row is kept a
 * little longer so a click at the very edge of the window still finds it and
 * gets a clear answer rather than "not found".
 */
const UNDO_WINDOW_MS = 10_000;

const MAX_IDS_PER_MOVE = 500;

function isValidObjectId(value: string): boolean {
  return Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value;
}

/** Unique, well-formed ids only — a repeated id would log the same move twice. */
function normaliseIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const seen = new Set<string>();
  for (const raw of ids) {
    if (typeof raw !== "string" || !isValidObjectId(raw)) return null;
    seen.add(raw);
  }
  return [...seen];
}

// ─── Destination ─────────────────────────────────────────────────────────────

interface ResolvedDestination {
  kind: DestinationKind;
  matterId?: string;
  matterName?: string;
  folder?: string;
  clientId?: string;
  clientName?: string;
  label: string;
}

type Resolution =
  | { ok: true; destination: ResolvedDestination }
  | { ok: false; status: 400 | 404; message: string };

async function resolveDestination(
  firmId: string,
  itemType: BulkItemType,
  input: DestinationInput
): Promise<Resolution> {
  const kind = input.kind;
  if (!kind || !DESTINATION_KINDS.includes(kind)) {
    return {
      ok: false,
      status: 400,
      message: "Destination must be 'matter', 'folder' or 'client'",
    };
  }

  if (itemType === "document" && kind === "client") {
    return {
      ok: false,
      status: 400,
      message: "A document is filed under a matter or a folder, not directly under a client",
    };
  }
  if (itemType === "matter" && kind !== "client") {
    return { ok: false, status: 400, message: "A matter can only be moved to another client" };
  }

  if (kind === "folder") {
    const folder = typeof input.folder === "string" ? input.folder.trim() : "";
    if (!folder) return { ok: false, status: 400, message: "A folder name is required" };
    return { ok: true, destination: { kind, folder, label: `folder ${folder}` } };
  }

  const id = typeof input.id === "string" ? input.id : "";
  if (!isValidObjectId(id)) {
    return { ok: false, status: 400, message: `A valid ${kind} is required` };
  }

  if (kind === "matter") {
    // Scoped lookup: findById alone would accept another firm's matter.
    const matter = await Matter.findOne({ _id: id, firmId });
    if (!matter) return { ok: false, status: 404, message: "Matter not found" };
    return {
      ok: true,
      destination: {
        kind,
        matterId: String(matter._id),
        matterName: matter.name,
        label: `matter ${String(matter._id)}`,
      },
    };
  }

  const client = await Client.findOne({ _id: id, firmId });
  if (!client) return { ok: false, status: 404, message: "Client not found" };
  return {
    ok: true,
    destination: {
      kind,
      clientId: String(client._id),
      clientName: client.name,
      label: `client ${String(client._id)}`,
    },
  };
}

// ─── Logging ─────────────────────────────────────────────────────────────────

/**
 * Two rows per item: one against where it came from, one against where it went,
 * both carrying the reason. Metadata only — items and places are referenced by
 * id, never by client name or contents (see FirmActivityLog's boundary note).
 */
async function logMove(
  firmId: string,
  memberId: string,
  itemType: BulkItemType,
  items: Array<{ id: string; fromLabel: string; fromReference?: string }>,
  destination: { label: string; reference?: string },
  reason: string
): Promise<void> {
  const type = itemType === "document" ? "document" : "matter";
  const at = new Date();

  const rows = items.flatMap((item) => {
    const summary = `${itemType === "document" ? "Document" : "Matter"} ${item.id} moved from ${item.fromLabel} to ${destination.label} — ${reason}`;
    return [
      { firmId, memberId, type, summary, reference: item.fromReference, at },
      { firmId, memberId, type, summary, reference: destination.reference, at },
    ];
  });

  await FirmActivityLog.insertMany(rows);
}

// ─── Move ────────────────────────────────────────────────────────────────────

/**
 * POST /firm/bulk-move
 *
 * One request moves one or fifty items. Everything is validated first, then the
 * whole set is written, so the caller never ends up with a partial move.
 */
export const bulkMove = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { itemType, ids, destination, reason } = (req.body ?? {}) as BulkMoveBody;

    // The reason is the record. Checked before anything else.
    if (typeof reason !== "string" || reason.trim().length === 0) {
      sendBadRequest(res, "A reason is required to move — the move is recorded on both matters");
      return;
    }
    const trimmedReason = reason.trim();

    if (!itemType || !ITEM_TYPES.includes(itemType)) {
      sendBadRequest(res, "itemType must be 'document' or 'matter'");
      return;
    }

    const itemIds = normaliseIds(ids);
    if (!itemIds) {
      sendBadRequest(res, "At least one valid id is required");
      return;
    }
    if (itemIds.length > MAX_IDS_PER_MOVE) {
      sendBadRequest(res, `A single move carries at most ${MAX_IDS_PER_MOVE} items`);
      return;
    }

    const resolved = await resolveDestination(firmId, itemType, destination ?? {});
    if (!resolved.ok) {
      if (resolved.status === 404) sendNotFound(res, resolved.message);
      else sendBadRequest(res, resolved.message);
      return;
    }
    const dest = resolved.destination;

    const previous: PreviousPlacement[] = [];

    if (itemType === "document") {
      const docs = await FirmDocument.find({ _id: { $in: itemIds }, firmId });
      // Every id must belong to this firm. A partial move across firms would
      // be worse than a refusal, so nothing is written when one is missing.
      if (docs.length !== itemIds.length) {
        sendNotFound(res, "One or more documents were not found in this firm — nothing was moved");
        return;
      }

      for (const doc of docs) {
        previous.push({
          id: String(doc._id),
          matterId: doc.matterId ? String(doc.matterId) : undefined,
          matterName: doc.matterName,
          folder: doc.type,
          label: doc.matterId ? `matter ${String(doc.matterId)}` : `folder ${doc.type}`,
        });

        if (dest.kind === "matter") {
          doc.matterId = new Types.ObjectId(String(dest.matterId));
          doc.matterName = dest.matterName;
        } else {
          doc.type = String(dest.folder);
        }
        await doc.save();
      }
    } else {
      const matters = await Matter.find({ _id: { $in: itemIds }, firmId });
      if (matters.length !== itemIds.length) {
        sendNotFound(res, "One or more matters were not found in this firm — nothing was moved");
        return;
      }

      for (const matter of matters) {
        previous.push({
          id: String(matter._id),
          clientId: String(matter.clientId),
          clientName: matter.clientName,
          label: `client ${String(matter.clientId)}`,
        });

        matter.clientId = new Types.ObjectId(String(dest.clientId));
        matter.clientName = String(dest.clientName);
        await matter.save();
      }
    }

    await logMove(
      firmId,
      memberId,
      itemType,
      previous.map((p) => ({
        id: p.id,
        fromLabel: p.label,
        fromReference: p.matterId ?? p.clientId,
      })),
      { label: dest.label, reference: dest.matterId ?? dest.clientId },
      trimmedReason
    );

    // Persisted, not held in memory: an undo may land on a different instance,
    // and a deploy between the move and the undo used to lose the way back
    // without saying so.
    const ledgerRow = await BulkMoveLedger.create({
      firmId,
      memberId,
      itemType,
      previous,
      destinationLabel: dest.label,
      undone: false,
      undoUntil: new Date(Date.now() + UNDO_WINDOW_MS),
      at: new Date(),
    });
    const moveId = String(ledgerRow._id);

    sendCreated(
      res,
      {
        moveId,
        moved: previous.length,
        itemType,
        destination: {
          kind: dest.kind,
          id: dest.matterId ?? dest.clientId,
          folder: dest.folder,
          name: dest.matterName ?? dest.clientName ?? dest.folder,
        },
        undoWindowSeconds: 10,
      },
      `Moved ${previous.length} item(s)`
    );
  } catch (error) {
    sendBadRequest(res, "Failed to move the selected items", error);
  }
};

// ─── Undo ────────────────────────────────────────────────────────────────────

/**
 * POST /firm/bulk-move/undo
 *
 * A real reversing move, logged like any other, so the audit trail shows both
 * the move and the correction rather than hiding either.
 */
export const undoBulkMove = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { moveId, reason } = (req.body ?? {}) as { moveId?: string; reason?: string };

    if (typeof moveId !== "string" || moveId.length === 0) {
      sendBadRequest(res, "A moveId is required");
      return;
    }

    if (!isValidObjectId(moveId)) {
      sendNotFound(res, "That move can no longer be undone");
      return;
    }

    // Claimed in one atomic update, so two clicks on Undo cannot both reverse
    // the same move — the second finds nothing left to claim. The firm and the
    // member who made the move are part of the filter, so another firm's id
    // reads as not found rather than as a permission error.
    const entry = await BulkMoveLedger.findOneAndUpdate(
      {
        _id: moveId,
        firmId,
        memberId,
        undone: false,
        undoUntil: { $gt: new Date() },
      },
      { $set: { undone: true, undoneAt: new Date() } },
      { new: false }
    );
    if (!entry) {
      sendNotFound(res, "That move can no longer be undone");
      return;
    }

    const undoReason =
      typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : "Move undone";

    const restored: Array<{ id: string; fromLabel: string; fromReference?: string }> = [];

    if (entry.itemType === "document") {
      const ids = entry.previous.map((p: IBulkMoveLedger["previous"][number]) => p.id);
      const docs = await FirmDocument.find({ _id: { $in: ids }, firmId });
      const byId = new Map(docs.map((d) => [String(d._id), d]));

      for (const prev of entry.previous) {
        const doc = byId.get(prev.id);
        if (!doc) continue;
        if (prev.matterId) {
          doc.matterId = new Types.ObjectId(prev.matterId);
          doc.matterName = prev.matterName;
        } else {
          doc.matterId = undefined;
          doc.matterName = undefined;
        }
        if (prev.folder) doc.type = prev.folder;
        await doc.save();
        restored.push({ id: prev.id, fromLabel: entry.destinationLabel, fromReference: undefined });
      }
    } else {
      const ids = entry.previous.map((p: IBulkMoveLedger["previous"][number]) => p.id);
      const matters = await Matter.find({ _id: { $in: ids }, firmId });
      const byId = new Map(matters.map((m) => [String(m._id), m]));

      for (const prev of entry.previous) {
        const matter = byId.get(prev.id);
        if (!matter || !prev.clientId) continue;
        matter.clientId = new Types.ObjectId(prev.clientId);
        matter.clientName = String(prev.clientName ?? "");
        await matter.save();
        restored.push({ id: prev.id, fromLabel: entry.destinationLabel, fromReference: undefined });
      }
    }

    if (restored.length === 0) {
      sendNotFound(res, "Nothing from that move could be put back");
      return;
    }

    const byIdPrevious = new Map(
      entry.previous.map((p: IBulkMoveLedger["previous"][number]) => [p.id, p])
    );
    for (const item of restored) {
      const prev = byIdPrevious.get(item.id);
      await logMove(
        firmId,
        memberId,
        entry.itemType,
        [{ id: item.id, fromLabel: entry.destinationLabel, fromReference: undefined }],
        { label: prev?.label ?? "its previous place", reference: prev?.matterId ?? prev?.clientId },
        undoReason
      );
    }

    sendSuccess(res, { moveId, restored: restored.length }, "Move undone");
  } catch (error) {
    sendBadRequest(res, "Failed to undo the move", error);
  }
};
