import { Router } from "express";
import {
  listAllDocuments,
  getAnyDocument,
  updateAnyDocument,
  promoteToLibrary,
  demoteFromLibrary,
  deleteAnyDocument,
  getLibraryUploadUrl,
  completeLibraryUpload,
  getDocumentSignedUrl,
} from "../../controllers/admin/library.controller";
import { authenticateAdmin, requireContentAdmin } from "../../middleware/adminAuth.middleware";

const router = Router();

router.use(authenticateAdmin, requireContentAdmin);

router.get("/", listAllDocuments);
router.post("/upload-url", getLibraryUploadUrl);
router.post("/upload/complete", completeLibraryUpload);
router.get("/:id", getAnyDocument);
router.patch("/:id", updateAnyDocument);
router.patch("/:id/promote", promoteToLibrary);
router.patch("/:id/demote", demoteFromLibrary);
router.get("/:id/access", getDocumentSignedUrl);
router.delete("/:id", deleteAnyDocument);

export default router;
