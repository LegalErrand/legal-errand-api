import { Router } from "express";
import {
  getLibrary,
  getMyDocuments,
  uploadDocument,
  getDocumentSignedUrl,
  bookmarkDocument,
  deleteDocument,
} from "../controllers/library.controller";
import { authenticate } from "../middleware/auth.middleware";
import { uploadPDF } from "../middleware/upload.middleware";

const router = Router();

router.use(authenticate);

router.get("/", getLibrary);                          // GET /library — browse platform library
router.get("/my-documents", getMyDocuments);          // GET /library/my-documents
router.post("/upload", uploadPDF, uploadDocument);    // POST /library/upload
router.get("/:id/access", getDocumentSignedUrl);      // GET /library/:id/access — signed URL
router.post("/:id/bookmark", bookmarkDocument);       // POST /library/:id/bookmark
router.delete("/:id", deleteDocument);                // DELETE /library/:id

export default router;
