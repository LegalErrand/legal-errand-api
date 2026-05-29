import { Router } from "express";
import { authenticateAdmin } from "../../middleware/adminAuth.middleware";
import { extractFromUrl } from "../../controllers/admin/scraper.controller";

const router = Router();

router.use(authenticateAdmin);

router.post("/extract", extractFromUrl);

export default router;
