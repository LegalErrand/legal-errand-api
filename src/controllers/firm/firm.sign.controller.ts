import { Request, Response } from "express";
import crypto from "crypto";
import {
  SignatureRequest,
  AppliedSignature,
  FirmDocument,
  Firm,
  FirmMember,
  SIGNATURE_KINDS,
  SignatureKind,
} from "../../models/firm";
import { sendSuccess, sendBadRequest, sendNotFound } from "../../utils/response";
import { firmIdOf } from "../../utils/tenancy";
import { SigningAuthRequest } from "../../types/signing";

/**
 * LE-028, delivery half — a signer who is not a user.
 *
 * The firm sends a document out for signature; the signer opens a one-time
 * link, sees the document, signs or declines; and what happened is recorded as
 * an audit certificate. The signer holds no account, so the link is the whole
 * credential and `authenticateSigner` is the only thing that establishes who
 * they are. Nothing here reads anything the link was not minted for.
 */

/** SHA-256 of what was on screen. Lowercase hex, so it is quotable. */
const hashOf = (content: string): string =>
  crypto.createHash("sha256").update(content, "utf8").digest("hex");

/**
 * The address the request came from, preferring the proxy's first hop.
 *
 * Recorded as evidence of where a signature came from, not as a control: it is
 * supplied by the client's network and is not verified, which is exactly why
 * the certificate labels it as reported rather than confirmed.
 */
const ipOf = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (first ?? req.ip ?? "").trim() || "unknown";
};

/** LE-xxxx/<short id> — short enough to read out, unique enough to find. */
const certificateRefFor = (requestId: string): string => `LES-${requestId.slice(-8).toUpperCase()}`;

// ─── The signer's own view ───────────────────────────────────────────────────

/**
 * What the signer sees before signing.
 *
 * Only this document, and only the fields needed to read and sign it. The
 * matter's other documents, its notes, its messages and the firm's other
 * clients are all unreachable from a signing link.
 */
export const getSigningPacket = async (req: SigningAuthRequest, res: Response): Promise<void> => {
  try {
    const row = req.signatureRequest!;

    const [document, firm, requester] = await Promise.all([
      FirmDocument.findOne({ _id: row.documentId, firmId: row.firmId }).select("name content"),
      Firm.findById(row.firmId).select("name"),
      FirmMember.findById(row.requestedBy).select("name"),
    ]);

    if (!document) {
      sendNotFound(res, "The document behind this link no longer exists");
      return;
    }

    sendSuccess(
      res,
      {
        signer: { name: row.name, capacity: row.capacity, email: row.email },
        document: { title: document.name, content: document.content ?? "" },
        firmName: firm?.name ?? "The firm",
        requestedByName: requester?.name ?? "The firm",
        requestedAt: row.requestedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      },
      "Signing packet retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to open the signing link", error);
  }
};

// ─── Signing ────────────────────────────────────────────────────────────────

export const submitSignature = async (req: SigningAuthRequest, res: Response): Promise<void> => {
  try {
    const row = req.signatureRequest!;
    const { kind, dataUrl, name } = req.body as {
      kind?: string;
      dataUrl?: string;
      name?: string;
    };

    if (!kind || !(SIGNATURE_KINDS as readonly string[]).includes(kind)) {
      sendBadRequest(res, "Choose how you want to sign");
      return;
    }
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      sendBadRequest(res, "A signature image is required");
      return;
    }

    const document = await FirmDocument.findOne({
      _id: row.documentId,
      firmId: row.firmId,
    }).select("name content");
    if (!document) {
      sendNotFound(res, "The document behind this link no longer exists");
      return;
    }

    // Claim the request before writing the signature. A second click on the
    // same link loses the race and is told the link is spent, rather than
    // producing a second signature on the same document.
    const claimed = await SignatureRequest.findOneAndUpdate(
      { _id: row._id, status: "pending", expiresAt: { $gt: new Date() } },
      {
        $set: {
          status: "signed",
          signedAt: new Date(),
          signerIp: ipOf(req),
          signerUserAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
          documentHash: hashOf(document.content ?? ""),
          documentTitleAtSigning: document.name,
          certificateRef: certificateRefFor(String(row._id)),
        },
      },
      { new: true }
    );

    if (!claimed) {
      sendBadRequest(res, "This signing link has already been used");
      return;
    }

    await AppliedSignature.create({
      firmId: row.firmId,
      documentId: row.documentId,
      // The signer is not a member, so the request stands in for them: it
      // carries their name, capacity and email, and the certificate is the
      // record of who actually signed.
      signedBy: row.requestedBy,
      kind: kind as SignatureKind,
      dataUrl,
      name: (name ?? row.name).trim() || row.name,
      capacity: row.capacity,
      dateSigned: new Date().toISOString().slice(0, 10),
      locked: true,
    });

    sendSuccess(
      res,
      {
        signedAt: claimed.signedAt?.toISOString(),
        certificateRef: claimed.certificateRef,
        documentTitle: claimed.documentTitleAtSigning,
      },
      "Signed"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to record the signature", error);
  }
};

export const declineSignature = async (req: SigningAuthRequest, res: Response): Promise<void> => {
  try {
    const row = req.signatureRequest!;
    const { reason } = req.body as { reason?: string };

    const claimed = await SignatureRequest.findOneAndUpdate(
      { _id: row._id, status: "pending", expiresAt: { $gt: new Date() } },
      {
        $set: {
          status: "declined",
          declinedAt: new Date(),
          declineReason: (reason ?? "").trim().slice(0, 500) || undefined,
          signerIp: ipOf(req),
          signerUserAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
          certificateRef: certificateRefFor(String(row._id)),
        },
      },
      { new: true }
    );

    if (!claimed) {
      sendBadRequest(res, "This signing link has already been used");
      return;
    }

    sendSuccess(res, { declinedAt: claimed.declinedAt?.toISOString() }, "Declined");
  } catch (error) {
    sendBadRequest(res, "Failed to record the decline", error);
  }
};

// ─── The certificate, read by the firm ──────────────────────────────────────

/**
 * The audit certificate: who signed, when, from where, and of what.
 *
 * Firm-authenticated and scoped to the firm, so one firm cannot read another's
 * certificate. Whether the document still matches `documentHash` is computed
 * here rather than stored, so the answer is always about the document as it is
 * now.
 */
export const getSignatureCertificate = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const row = await SignatureRequest.findOne({ _id: req.params.id, firmId });
    if (!row) {
      sendNotFound(res, "Signature request not found");
      return;
    }

    const [document, firm, requester] = await Promise.all([
      FirmDocument.findOne({ _id: row.documentId, firmId }).select("name content"),
      Firm.findById(firmId).select("name"),
      FirmMember.findById(row.requestedBy).select("name"),
    ]);

    const currentHash = document ? hashOf(document.content ?? "") : null;

    sendSuccess(
      res,
      {
        certificateRef: row.certificateRef ?? null,
        status: row.status,
        signer: { name: row.name, capacity: row.capacity, email: row.email },
        firmName: firm?.name ?? "The firm",
        requestedByName: requester?.name ?? "The firm",
        requestedAt: row.requestedAt.toISOString(),
        signedAt: row.signedAt?.toISOString() ?? null,
        declinedAt: row.declinedAt?.toISOString() ?? null,
        declineReason: row.declineReason ?? null,
        // Reported by the signer's network and not verified. The screen says so.
        signerIp: row.signerIp ?? null,
        signerUserAgent: row.signerUserAgent ?? null,
        documentTitleAtSigning: row.documentTitleAtSigning ?? null,
        documentHash: row.documentHash ?? null,
        currentDocumentHash: currentHash,
        /**
         * Null when nothing was signed or the document is gone; otherwise
         * whether the text now matches what was signed.
         */
        documentUnchanged:
          row.documentHash && currentHash ? row.documentHash === currentHash : null,
        expiresAt: row.expiresAt.toISOString(),
      },
      "Certificate retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve the certificate", error);
  }
};

/**
 * GET /firm/signatures/requests?documentId= — who this document went to.
 *
 * The list the firm needs to know what is outstanding and what came back. It
 * carries status and the certificate reference, but not the certificate's
 * detail: the IP, user agent and hashes are a separate read, so a list view
 * does not casually hand around evidence it is not showing.
 */
export const listSignatureRequests = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const documentId = String(req.query.documentId ?? "");

    const rows = await SignatureRequest.find({
      firmId,
      ...(documentId ? { documentId } : {}),
    })
      .sort({ requestedAt: -1 })
      .limit(100);

    const requesterIds = [...new Set(rows.map((r) => String(r.requestedBy)))];
    const requesters = await FirmMember.find({ _id: { $in: requesterIds } }).select("name");
    const nameById = new Map(requesters.map((m) => [String(m._id), m.name]));

    sendSuccess(
      res,
      {
        requests: rows.map((r) => ({
          id: String(r._id),
          documentId: String(r.documentId),
          name: r.name,
          capacity: r.capacity,
          email: r.email,
          status: r.status,
          requestedByName: nameById.get(String(r.requestedBy)) ?? "Someone",
          requestedAt: r.requestedAt.toISOString(),
          signedAt: r.signedAt?.toISOString() ?? null,
          declinedAt: r.declinedAt?.toISOString() ?? null,
          expiresAt: r.expiresAt.toISOString(),
          certificateRef: r.certificateRef ?? null,
          /** True once the link can no longer be used, for whatever reason. */
          spent: r.status !== "pending" || r.expiresAt.getTime() <= Date.now(),
        })),
      },
      "Signature requests retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to list the signature requests", error);
  }
};
