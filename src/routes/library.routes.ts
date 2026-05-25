import { Router } from "express";
import {
  getLibrary,
  getMyDocuments,
  getDocument,
  updateDocument,
  getBookmarks,
  getPresignedUploadUrl,
  getBulkPresignedUploadUrls,
  completeDocumentUpload,
  completeBulkDocumentUpload,
  getDocumentSignedUrl,
  bookmarkDocument,
  deleteDocument,
} from "../controllers/library.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getLibrary);                          // Browse platform library
router.get("/bookmarks", getBookmarks);               // User's bookmarked documents
router.get("/my-documents", getMyDocuments);          // User's own uploads
router.post("/upload-url", getPresignedUploadUrl);             // Single presigned upload URL
router.post("/upload-urls/bulk", getBulkPresignedUploadUrls);  // Bulk presigned upload URLs (max 20)
router.post("/upload/complete", completeDocumentUpload);        // Save single upload metadata
router.post("/upload/complete/bulk", completeBulkDocumentUpload); // Save bulk upload metadata
router.get("/:id", getDocument);                      // Single document details
router.patch("/:id", updateDocument);                 // Update user's own document
router.get("/:id/access", getDocumentSignedUrl);      // Signed download URL
router.post("/:id/bookmark", bookmarkDocument);       // Toggle bookmark
router.delete("/:id", deleteDocument);                // Delete user's document

export default router;
