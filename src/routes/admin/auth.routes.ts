import { Router } from "express";
import { adminLogin, getAdminMe, adminLogout } from "../../controllers/admin/auth.controller";
import { authenticateAdmin } from "../../middleware/adminAuth.middleware";

const router = Router();

router.post("/login", adminLogin);
router.get("/me", authenticateAdmin, getAdminMe);
router.post("/logout", authenticateAdmin, adminLogout);

export default router;
