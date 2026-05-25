import { Response } from "express";
import { AdminRequest } from "../../types";
import { LibraryDocument } from "../../models/Document";
import { s3Service } from "../../services/storage/s3.service";
import { DOCUMENT_TYPES, LAW_SUBJECTS } from "../../utils/constants";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound, sendError } from "../../utils/response";

export const listAllDocuments = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20", subject, type, isLibraryContent, uploadedBy, search } = req.query;
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
    const doc = await LibraryDocument.findById(req.params.id).populate("uploadedBy", "firstName lastName email");
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

    const doc = await LibraryDocument.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
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

    await s3Service.deleteFile(doc.s3Key);
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

    const signedUrl = await s3Service.getSignedDownloadUrl(doc.s3Key, 3600);
    sendSuccess(res, { signedUrl, expiresIn: 3600 }, "Signed URL generated");
  } catch (err) {
    sendError(res, "Failed to generate access URL", 500, (err as Error).message);
  }
};
