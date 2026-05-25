import { Router } from "express";
import {
  updateAvatar,
  updateBioData,
  getAvatarUrl,
  getReferral,
} from "../controllers/user.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.put("/bio-data", authenticate, updateBioData); // Update profile info
router.put("/avatar", authenticate, updateAvatar); // Update avatar
router.get("/avatar-url", authenticate, getAvatarUrl); // Get signed avatar URL
router.get("/referral", authenticate, getReferral); // Get referral key + stats

export default router;
