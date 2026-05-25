import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { env } from "../config/env";
import { sendSuccess, sendBadRequest, sendUnauthorized, sendError } from "../utils/response";
import { AuthRequest } from "../types";
import crypto from "crypto";
import { emailService } from "../services/email/email.service";

const signToken = (userId: string, email: string, tier: string) =>
  jwt.sign({ userId, email, tier }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions);

const signRefreshToken = (userId: string) =>
  jwt.sign({ userId }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
  } as jwt.SignOptions);

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, email, password, accountType, referralCode } = req.body;

    if (!firstName || !lastName || !email || !password || !accountType) {
      sendBadRequest(res, "First name, last name, email, password, and account type are required");
      return;
    }

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (user.isEmailVerified) {
        sendBadRequest(res, "An account with this email already exists");
        return;
      }
      // If unverified, we will overwrite their data and resend OTP
      user.firstName = firstName;
      user.lastName = lastName;
      user.password = password; // Will be hashed by pre-save hook
      user.accountType = accountType;
    } else {
      user = new User({
        firstName,
        lastName,
        email,
        password,
        accountType,
        isEmailVerified: false,
      });

      // If a referral code was provided, link it
      if (referralCode) {
        const referrer = await User.findOne({ referralKey: referralCode.toUpperCase() });
        if (referrer) {
          user.referredBy = referrer._id;
        }
      }
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    user.verificationOtp = hashedOtp;
    user.verificationOtpExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await user.save();
    await emailService.sendVerificationOtp(user.email, otp);

    sendSuccess(res, null, "Account created. Please check your email for the verification OTP.");
  } catch (err) {
    sendError(res, "Registration failed", 500, (err as Error).message);
  }
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      sendBadRequest(res, "Email and OTP are required");
      return;
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      verificationOtpExpires: { $gt: new Date() },
    });

    if (!user || !user.verificationOtp) {
      sendUnauthorized(res, "OTP is invalid or has expired");
      return;
    }

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
    if (hashedOtp !== user.verificationOtp) {
      sendUnauthorized(res, "OTP is incorrect");
      return;
    }

    // Mark as verified
    user.isEmailVerified = true;
    user.verificationOtp = undefined;
    user.verificationOtpExpires = undefined;
    await user.save();

    // Generate tokens for login
    const token = signToken(user._id.toString(), user.email, user.tier);
    const refreshToken = signRefreshToken(user._id.toString());
    const userObj = user.toJSON();

    sendSuccess(res, { token, refreshToken, user: userObj }, "Email verified successfully");
  } catch (err) {
    sendError(res, "Email verification failed", 500, (err as Error).message);
  }
};

export const resendVerificationOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      sendBadRequest(res, "Email is required");
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Return success to prevent enumeration
      sendSuccess(res, null, "If the email exists, a new OTP has been sent");
      return;
    }

    if (user.isEmailVerified) {
      sendBadRequest(res, "Email is already verified");
      return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    user.verificationOtp = hashedOtp;
    user.verificationOtpExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    await emailService.sendVerificationOtp(user.email, otp);

    sendSuccess(res, null, "A new OTP has been sent to your email");
  } catch (err) {
    sendError(res, "Failed to resend OTP", 500, (err as Error).message);
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      sendBadRequest(res, "Email and password are required");
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+password");
    if (!user || !(await user.comparePassword(password))) {
      sendUnauthorized(res, "Invalid email or password");
      return;
    }

    if (user.isBlocked) {
      sendUnauthorized(res, "Your account has been suspended. Please contact support.");
      return;
    }

    user.lastLogin = new Date();
    await user.save();

    const token = signToken(user._id.toString(), user.email, user.tier);
    const refreshToken = signRefreshToken(user._id.toString());

    // Strip password from response
    const userObj = user.toJSON();

    sendSuccess(res, { token, refreshToken, user: userObj }, "Login successful");
  } catch (err) {
    sendError(res, "Login failed", 500, (err as Error).message);
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      sendBadRequest(res, "Refresh token is required");
      return;
    }

    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as { userId: string };
    const user = await User.findById(decoded.userId);

    if (!user) {
      sendUnauthorized(res, "User not found");
      return;
    }

    const newToken = signToken(user._id.toString(), user.email, user.tier);
    sendSuccess(res, { token: newToken }, "Token refreshed");
  } catch {
    sendUnauthorized(res, "Invalid or expired refresh token");
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!.userId);
    if (!user) {
      sendUnauthorized(res, "User not found");
      return;
    }
    sendSuccess(res, user, "Profile retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve profile", 500, (err as Error).message);
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      sendBadRequest(res, "Email is required");
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Return success even if user not found to prevent email enumeration
      sendSuccess(res, null, "If that email exists, an OTP has been sent.");
      return;
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash OTP before saving
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    user.resetPasswordOtp = hashedOtp;
    user.resetPasswordOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    await user.save();

    await emailService.sendPasswordResetOtp(user.email, otp);

    sendSuccess(res, null, "If that email exists, an OTP has been sent.");
  } catch (err) {
    sendError(res, "Failed to process forgot password", 500, (err as Error).message);
  }
};

export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      sendBadRequest(res, "Email and OTP are required");
      return;
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      resetPasswordOtpExpires: { $gt: new Date() },
    });

    if (!user || !user.resetPasswordOtp) {
      sendUnauthorized(res, "OTP is invalid or has expired");
      return;
    }

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
    if (hashedOtp !== user.resetPasswordOtp) {
      sendUnauthorized(res, "OTP is incorrect");
      return;
    }

    // OTP is valid. Clear it and issue a temporary reset token.
    user.resetPasswordOtp = undefined;
    user.resetPasswordOtpExpires = undefined;
    await user.save();

    // Short lived token just for resetting the password
    const resetToken = jwt.sign(
      { userId: user._id.toString(), purpose: "password_reset" },
      env.JWT_SECRET,
      { expiresIn: "15m" } as jwt.SignOptions
    );

    sendSuccess(res, { resetToken }, "OTP verified successfully");
  } catch (err) {
    sendError(res, "Failed to verify OTP", 500, (err as Error).message);
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      sendBadRequest(res, "Reset token and new password are required");
      return;
    }

    if (newPassword.length < 8) {
      sendBadRequest(res, "Password must be at least 8 characters");
      return;
    }

    let decoded: jwt.JwtPayload;
    try {
      const verified = jwt.verify(resetToken, env.JWT_SECRET);
      if (typeof verified === "string") {
        sendUnauthorized(res, "Invalid or expired reset token");
        return;
      }
      decoded = verified;
    } catch {
      sendUnauthorized(res, "Invalid or expired reset token");
      return;
    }

    if (decoded.purpose !== "password_reset") {
      sendUnauthorized(res, "Invalid token purpose");
      return;
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      sendUnauthorized(res, "User not found");
      return;
    }

    user.password = newPassword;
    await user.save();

    sendSuccess(res, null, "Password reset successfully");
  } catch (err) {
    sendError(res, "Failed to reset password", 500, (err as Error).message);
  }
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  // JWT is stateless — logout is handled client-side by discarding tokens.
  // This endpoint exists so clients have a standard place to call and for
  // future refresh-token blocklist support.
  sendSuccess(res, null, "Logged out successfully");
};

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      sendBadRequest(res, "Current password and new password are required");
      return;
    }

    if (newPassword.length < 8) {
      sendBadRequest(res, "New password must be at least 8 characters");
      return;
    }

    const user = await User.findById(req.user!.userId).select("+password");
    if (!user) {
      sendUnauthorized(res, "User not found");
      return;
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      sendUnauthorized(res, "Current password is incorrect");
      return;
    }

    user.password = newPassword;
    await user.save();

    sendSuccess(res, null, "Password changed successfully");
  } catch (err) {
    sendError(res, "Failed to change password", 500, (err as Error).message);
  }
};
