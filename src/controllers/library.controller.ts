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
    const { page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const [docs, total] = await Promise.all([
      LibraryDocument.find({ uploadedBy: req.user!.userId, isLibraryContent: false })
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      LibraryDocument.countDocuments({ uploadedBy: req.user!.userId, isLibraryContent: false }),
    ]);

    sendSuccess(res, docs, "Documents retrieved", 200, {
      page: parseInt(page as string),
      total,
    });
  } catch (err) {
    sendError(res, "Failed to retrieve documents", 500, (err as Error).message);
  }
};

export const uploadDocument = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { sendBadRequest(res, "No file uploaded"); return; }

    const { title, subject } = req.body;
    if (!title) { sendBadRequest(res, "Document title is required"); return; }

    const { s3Key, s3Url } = await s3Service.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      "DOCUMENTS"
    );

    const doc = await LibraryDocument.create({
      title,
      type: "user_upload",
      subject,
      s3Key,
      s3Url,
      fileSize: req.file.size,
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

    // Check access: library content is public, user docs are private
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
      300 // 5 min to complete upload
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
