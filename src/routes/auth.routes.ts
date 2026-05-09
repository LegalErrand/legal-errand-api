import { Router } from "express";
import {
  register,
  login,
  refreshToken,
  getMe,
  forgotPassword,
  verifyOtp,
  resetPassword,
  verifyEmail,
  resendVerificationOtp,
  logout,
  changePassword,
} from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification-otp", resendVerificationOtp);
router.post("/login", login);
router.post("/refresh", refreshToken);
router.get("/me", authenticate, getMe);
router.post("/logout", authenticate, logout);
router.put("/change-password", authenticate, changePassword);
router.post("/forgot-password", forgotPassword);
router.post("/verify-otp", verifyOtp);
router.post("/reset-password", resetPassword);

export default router;
