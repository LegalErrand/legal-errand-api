import { Response } from "express";
import { AdminRequest } from "../../types";
import { LibraryDocument } from "../../models/Document";
import { s3Service } from "../../services/storage/s3.service";
import { DOCUMENT_TYPES, LAW_SUBJECTS, DocumentType } from "../../utils/constants";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError,
} from "../../utils/response";

export const listAllDocuments = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const {
      page = "1",
      limit = "20",
      subject,
      type,
      isLibraryContent,
      uploadedBy,
      search,
    } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const filter: Record<string, unknown> = {};
    if (subject) filter.subject = subject;
    if (type) filter.type = type;
    if (isLibraryContent !== undefined) filter.isLibraryContent = isLibraryContent === "true";
    if (uploadedBy) filter.uploadedBy = uploadedBy;
    if (search) filter.$text = { $search: search as string };

    const [docs, total] = await Promise.all([
      LibraryDocument.find(filter)
        .populate("uploadedBy", "firstName lastName email")
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      LibraryDocument.countDocuments(filter),
    ]);

    sendSuccess(res, docs, "Documents retrieved", 200, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (err) {
    sendError(res, "Failed to list documents", 500, (err as Error).message);
  }
};

export const getAnyDocument = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id).populate(
      "uploadedBy",
      "firstName lastName email"
    );
    if (!doc) {
      sendNotFound(res, "Document not found");
      return;
    }
    sendSuccess(res, doc, "Document retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve document", 500, (err as Error).message);
  }
};

export const updateAnyDocument = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const ALLOWED = ["title", "subject", "type", "isLibraryContent", "metadata"];
    const updates: Record<string, unknown> = {};

    for (const field of ALLOWED) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (updates.type && !DOCUMENT_TYPES.includes(updates.type as never)) {
      sendBadRequest(res, `type must be one of: ${DOCUMENT_TYPES.join(", ")}`);
      return;
    }
    if (updates.subject && !LAW_SUBJECTS.includes(updates.subject as never)) {
      sendBadRequest(res, `subject must be one of: ${LAW_SUBJECTS.join(", ")}`);
      return;
    }

    if (Object.keys(updates).length === 0) {
      sendBadRequest(res, "No valid fields provided");
      return;
    }

    const doc = await LibraryDocument.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!doc) {
      sendNotFound(res, "Document not found");
      return;
    }

    sendSuccess(res, doc, "Document updated");
  } catch (err) {
    sendError(res, "Failed to update document", 500, (err as Error).message);
  }
};

export const promoteToLibrary = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id);
    if (!doc) {
      sendNotFound(res, "Document not found");
      return;
    }

    if (doc.isLibraryContent) {
      sendBadRequest(res, "Document is already in the platform library");
      return;
    }

    doc.isLibraryContent = true;
    // Optionally update metadata from request body
    if (req.body.subject) doc.subject = req.body.subject;
    if (req.body.type) doc.type = req.body.type;
    if (req.body.title) doc.title = req.body.title;
    if (req.body.metadata) doc.metadata = { ...doc.metadata, ...req.body.metadata };

    await doc.save();

    sendSuccess(res, doc, "Document promoted to platform library");
  } catch (err) {
    sendError(res, "Failed to promote document", 500, (err as Error).message);
  }
};

export const demoteFromLibrary = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id);
    if (!doc) {
      sendNotFound(res, "Document not found");
      return;
    }

    if (!doc.isLibraryContent) {
      sendBadRequest(res, "Document is not in the platform library");
      return;
    }

    doc.isLibraryContent = false;
    await doc.save();

    sendSuccess(res, doc, "Document removed from platform library");
  } catch (err) {
    sendError(res, "Failed to demote document", 500, (err as Error).message);
  }
};

export const deleteAnyDocument = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id);
    if (!doc) {
      sendNotFound(res, "Document not found");
      return;
    }

    if (doc.s3Key) await s3Service.deleteFile(doc.s3Key);
    await doc.deleteOne();

    sendSuccess(res, null, "Document deleted");
  } catch (err) {
    sendError(res, "Failed to delete document", 500, (err as Error).message);
  }
};

export const getLibraryUploadUrl = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { fileName, mimeType } = req.body;

    if (!fileName || !mimeType) {
      sendBadRequest(res, "fileName and mimeType are required");
      return;
    }

    const result = await s3Service.getSignedUploadUrl("LIBRARY", fileName, mimeType, 300);

    sendSuccess(res, { ...result, expiresIn: 300 }, "Library upload URL generated");
  } catch (err) {
    sendError(res, "Failed to generate upload URL", 500, (err as Error).message);
  }
};

export const completeLibraryUpload = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { title, type, subject, s3Key, s3Url, fileSize, metadata } = req.body;

    if (!title || !type || !s3Key || !s3Url || !fileSize) {
      sendBadRequest(res, "title, type, s3Key, s3Url, and fileSize are required");
      return;
    }

    if (!DOCUMENT_TYPES.includes(type)) {
      sendBadRequest(res, `type must be one of: ${DOCUMENT_TYPES.join(", ")}`);
      return;
    }

    const parsedSize = Number(fileSize);
    if (!Number.isFinite(parsedSize) || parsedSize <= 0) {
      sendBadRequest(res, "fileSize must be a valid positive number");
      return;
    }

    const doc = await LibraryDocument.create({
      title,
      type,
      subject,
      s3Key,
      s3Url,
      fileSize: parsedSize,
      isLibraryContent: true,
      metadata: metadata || {},
    });

    sendCreated(res, doc, "Library document added successfully");
  } catch (err) {
    sendError(res, "Failed to complete library upload", 500, (err as Error).message);
  }
};

export const getDocumentSignedUrl = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id);
    if (!doc) {
      sendNotFound(res, "Document not found");
      return;
    }

    if (!doc.s3Key) {
      sendBadRequest(res, "This document has no associated file stored in S3");
      return;
    }

    const signedUrl = await s3Service.getSignedDownloadUrl(doc.s3Key, 3600);
    sendSuccess(res, { signedUrl, expiresIn: 3600 }, "Signed URL generated");
  } catch (err) {
    sendError(res, "Failed to generate access URL", 500, (err as Error).message);
  }
};

/**
 * POST /admin/library/bulk-upload
 * Accepts up to 20 files via multipart/form-data (field: "files").
 * Optional body fields per file (as JSON arrays): titles[], types[], subjects[]
 * Falls back to filename-derived title and "statute" type when not provided.
 */
export const bulkUploadLibraryFiles = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      sendBadRequest(res, "At least one file is required");
      return;
    }

    const titles: string[] = Array.isArray(req.body.titles)
      ? req.body.titles
      : req.body.titles
        ? [req.body.titles]
        : [];
    const types: string[] = Array.isArray(req.body.types)
      ? req.body.types
      : req.body.types
        ? [req.body.types]
        : [];
    const subjects: string[] = Array.isArray(req.body.subjects)
      ? req.body.subjects
      : req.body.subjects
        ? [req.body.subjects]
        : [];

    const results: { fileName: string; status: "success" | "error"; error?: string; docId?: string }[] = [];

    await Promise.all(
      files.map(async (file, i) => {
        const derivedTitle = titles[i] ?? file.originalname.replace(/\.[^.]+$/, "");
        const rawType = types[i] ?? "statute";
        const subject = subjects[i];

        if (!DOCUMENT_TYPES.includes(rawType as DocumentType)) {
          results[i] = {
            fileName: file.originalname,
            status: "error",
            error: `Invalid type "${rawType}". Must be one of: ${DOCUMENT_TYPES.join(", ")}`,
          };
          return;
        }

        if (subject && !LAW_SUBJECTS.includes(subject as never)) {
          results[i] = {
            fileName: file.originalname,
            status: "error",
            error: `Invalid subject "${subject}".`,
          };
          return;
        }

        try {
          const { s3Key, s3Url } = await s3Service.uploadFile(
            file.buffer,
            file.originalname,
            file.mimetype,
            "LIBRARY"
          );

          const docData: Record<string, unknown> = {
            title: derivedTitle,
            type: rawType as DocumentType,
            s3Key,
            s3Url,
            fileSize: file.size,
            isLibraryContent: true,
            metadata: { jurisdiction: "Nigeria" },
          };
          if (subject) docData.subject = subject;

          const doc = await LibraryDocument.create(docData);

          results[i] = { fileName: file.originalname, status: "success", docId: (doc._id as { toString(): string }).toString() };
        } catch (uploadErr) {
          results[i] = {
            fileName: file.originalname,
            status: "error",
            error: (uploadErr as Error).message,
          };
        }
      })
    );

    const succeeded = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status === "error").length;

    sendCreated(
      res,
      { results, summary: { total: files.length, succeeded, failed } },
      `Bulk upload complete: ${succeeded} succeeded, ${failed} failed`
    );
  } catch (err) {
    sendError(res, "Bulk upload failed", 500, (err as Error).message);
  }
};
