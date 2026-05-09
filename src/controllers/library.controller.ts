import { Response } from "express";
import { Types } from "mongoose";
import { AuthRequest } from "../types";
import { LibraryDocument } from "../models/Document";
import { s3Service } from "../services/storage/s3.service";
import { redisService } from "../services/cache/redis.service";
import { sendSuccess, sendCreated, sendNotFound, sendBadRequest, sendError } from "../utils/response";
import { CACHE_TTL } from "../utils/constants";

export const getLibrary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { subject, type, page = "1", limit = "20", search } = req.query;

    const filter: Record<string, unknown> = { isLibraryContent: true };
    if (subject) filter.subject = subject;
    if (type) filter.type = type;
    if (search) filter.$text = { $search: search as string };

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const [docs, total] = await Promise.all([
      LibraryDocument.find(filter).skip(skip).limit(parseInt(limit as string)).sort({ createdAt: -1 }),
      LibraryDocument.countDocuments(filter),
    ]);

    sendSuccess(res, docs, "Library retrieved", 200, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve library", 500, (err as Error).message);
  }
};

export const getMyDocuments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20", search } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const filter: Record<string, unknown> = { uploadedBy: req.user!.userId, isLibraryContent: false };
    if (search) filter.$text = { $search: search as string };

    const [docs, total] = await Promise.all([
      LibraryDocument.find(filter).skip(skip).limit(parseInt(limit as string)).sort({ createdAt: -1 }),
      LibraryDocument.countDocuments(filter),
    ]);

    sendSuccess(res, docs, "Documents retrieved", 200, { page: parseInt(page as string), total });
  } catch (err) {
    sendError(res, "Failed to retrieve documents", 500, (err as Error).message);
  }
};

export const getDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id);
    if (!doc) { sendNotFound(res, "Document not found"); return; }

    const isOwner = doc.uploadedBy?.toString() === req.user!.userId;
    if (!doc.isLibraryContent && !isOwner) {
      res.status(403).json({ success: false, message: "Access denied" });
      return;
    }

    sendSuccess(res, doc, "Document retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve document", 500, (err as Error).message);
  }
};

export const updateDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id);
    if (!doc) { sendNotFound(res, "Document not found"); return; }

    if (doc.uploadedBy?.toString() !== req.user!.userId) {
      res.status(403).json({ success: false, message: "You can only edit your own documents" });
      return;
    }

    const { title, subject } = req.body;
    if (title) doc.title = title;
    if (subject) doc.subject = subject;
    await doc.save();

    sendSuccess(res, doc, "Document updated");
  } catch (err) {
    sendError(res, "Failed to update document", 500, (err as Error).message);
  }
};

export const getBookmarks = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const userId = new Types.ObjectId(req.user!.userId);

    const [docs, total] = await Promise.all([
      LibraryDocument.find({ bookmarks: userId }).skip(skip).limit(parseInt(limit as string)).sort({ createdAt: -1 }),
      LibraryDocument.countDocuments({ bookmarks: userId }),
    ]);

    sendSuccess(res, docs, "Bookmarks retrieved", 200, { page: parseInt(page as string), total });
  } catch (err) {
    sendError(res, "Failed to retrieve bookmarks", 500, (err as Error).message);
  }
};

const MAX_BULK_FILES = 20;

export const getBulkPresignedUploadUrls = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { files, folder = "DOCUMENTS" } = req.body;

    if (!Array.isArray(files) || files.length === 0) {
      sendBadRequest(res, "files must be a non-empty array");
      return;
    }
    if (files.length > MAX_BULK_FILES) {
      sendBadRequest(res, `Maximum ${MAX_BULK_FILES} files per bulk request`);
      return;
    }

    const validFolders = ["DOCUMENTS", "LIBRARY", "AVATARS"];
    if (!validFolders.includes(folder)) {
      sendBadRequest(res, `folder must be one of: ${validFolders.join(", ")}`);
      return;
    }

    for (const [i, f] of files.entries()) {
      if (!f.fileName || !f.mimeType) {
        sendBadRequest(res, `files[${i}]: fileName and mimeType are required`);
        return;
      }
    }

    const results = await s3Service.getBulkSignedUploadUrls(
      files,
      folder as "DOCUMENTS" | "LIBRARY" | "AVATARS",
      300
    );

    sendSuccess(res, { files: results, expiresIn: 300 }, "Bulk upload URLs generated");
  } catch (err) {
    sendError(res, "Failed to generate bulk upload URLs", 500, (err as Error).message);
  }
};

export const completeBulkDocumentUpload = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { documents } = req.body;

    if (!Array.isArray(documents) || documents.length === 0) {
      sendBadRequest(res, "documents must be a non-empty array");
      return;
    }
    if (documents.length > MAX_BULK_FILES) {
      sendBadRequest(res, `Maximum ${MAX_BULK_FILES} documents per bulk request`);
      return;
    }

    // Validate every entry before writing anything
    for (const [i, doc] of documents.entries()) {
      if (!doc.title) { sendBadRequest(res, `documents[${i}]: title is required`); return; }
      if (!doc.s3Key) { sendBadRequest(res, `documents[${i}]: s3Key is required`); return; }
      if (!doc.s3Url) { sendBadRequest(res, `documents[${i}]: s3Url is required`); return; }
      const size = Number(doc.fileSize);
      if (!Number.isFinite(size) || size <= 0) {
        sendBadRequest(res, `documents[${i}]: fileSize must be a valid positive number`);
        return;
      }
    }

    const created = await LibraryDocument.insertMany(
      documents.map((doc) => ({
        title: doc.title,
        type: "user_upload",
        subject: doc.subject,
        s3Key: doc.s3Key,
        s3Url: doc.s3Url,
        fileSize: Number(doc.fileSize),
        uploadedBy: req.user!.userId,
        isLibraryContent: false,
      }))
    );

    sendCreated(res, { documents: created, count: created.length }, "Bulk upload completed");
  } catch (err) {
    sendError(res, "Bulk upload failed", 500, (err as Error).message);
  }
};

export const completeDocumentUpload = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, subject, s3Key, s3Url, fileSize } = req.body;
    if (!title) { sendBadRequest(res, "Document title is required"); return; }
    if (!s3Key || !s3Url || !fileSize) {
      sendBadRequest(res, "s3Key, s3Url, and fileSize are required");
      return;
    }

    const parsedFileSize = Number(fileSize);
    if (!Number.isFinite(parsedFileSize) || parsedFileSize <= 0) {
      sendBadRequest(res, "fileSize must be a valid positive number");
      return;
    }

    const doc = await LibraryDocument.create({
      title,
      type: "user_upload",
      subject,
      s3Key,
      s3Url,
      fileSize: parsedFileSize,
      uploadedBy: req.user!.userId,
      isLibraryContent: false,
    });

    sendCreated(res, doc, "Document uploaded successfully");
  } catch (err) {
    sendError(res, "Document upload failed", 500, (err as Error).message);
  }
};

export const getDocumentSignedUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id);
    if (!doc) { sendNotFound(res, "Document not found"); return; }

    const isOwner = doc.uploadedBy?.toString() === req.user!.userId;
    if (!doc.isLibraryContent && !isOwner) {
      res.status(403).json({ success: false, message: "Access denied" });
      return;
    }

    const signedUrl = await s3Service.getSignedDownloadUrl(doc.s3Key, 3600);
    sendSuccess(res, { signedUrl, expiresIn: 3600 }, "Signed URL generated");
  } catch (err) {
    sendError(res, "Failed to generate access URL", 500, (err as Error).message);
  }
};

export const getPresignedUploadUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fileName, mimeType, folder = "DOCUMENTS" } = req.body;
    if (!fileName || !mimeType) {
      sendBadRequest(res, "fileName and mimeType are required");
      return;
    }

    const validFolders = ["DOCUMENTS", "LIBRARY", "AVATARS"];
    if (!validFolders.includes(folder)) {
      sendBadRequest(res, `folder must be one of: ${validFolders.join(", ")}`);
      return;
    }

    const result = await s3Service.getSignedUploadUrl(
      folder as "DOCUMENTS" | "LIBRARY" | "AVATARS",
      fileName,
      mimeType,
      300
    );

    sendSuccess(res, { ...result, expiresIn: 300 }, "Pre-signed upload URL generated");
  } catch (err) {
    sendError(res, "Failed to generate upload URL", 500, (err as Error).message);
  }
};

export const bookmarkDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id);
    if (!doc) { sendNotFound(res, "Document not found"); return; }

    const userId = req.user!.userId;
    const isBookmarked = doc.bookmarks.some((b) => b.toString() === userId);

    if (isBookmarked) {
      doc.bookmarks = doc.bookmarks.filter((b) => b.toString() !== userId);
    } else {
      doc.bookmarks.push(new Types.ObjectId(userId));
    }

    await doc.save();
    sendSuccess(res, { bookmarked: !isBookmarked }, isBookmarked ? "Bookmark removed" : "Bookmarked");
  } catch (err) {
    sendError(res, "Bookmark action failed", 500, (err as Error).message);
  }
};

export const deleteDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const doc = await LibraryDocument.findById(req.params.id);
    if (!doc) { sendNotFound(res, "Document not found"); return; }

    if (doc.uploadedBy?.toString() !== req.user!.userId) {
      res.status(403).json({ success: false, message: "You can only delete your own documents" });
      return;
    }

    await s3Service.deleteFile(doc.s3Key);
    await doc.deleteOne();

    sendSuccess(res, null, "Document deleted");
  } catch (err) {
    sendError(res, "Delete failed", 500, (err as Error).message);
  }
};
