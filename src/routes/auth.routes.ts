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
import { authIpRateLimit } from "../middleware/rateLimit.middleware";

const router = Router();

router.post("/register", authIpRateLimit, register);
router.post("/verify-email", authIpRateLimit, verifyEmail);
router.post("/resend-verification-otp", authIpRateLimit, resendVerificationOtp);
router.post("/login", authIpRateLimit, login);
router.post("/refresh", authIpRateLimit, refreshToken);
router.get("/me", authenticate, getMe);
router.post("/logout", authenticate, logout);
router.put("/change-password", authenticate, changePassword);
router.post("/forgot-password", authIpRateLimit, forgotPassword);
router.post("/verify-otp", authIpRateLimit, verifyOtp);
router.post("/reset-password", authIpRateLimit, resetPassword);

export default router;
