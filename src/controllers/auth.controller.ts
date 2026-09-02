import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { env } from "../config/env";
import { ApiMessage } from "../utils/api-messages";

/** Logs OTP to console only in non-production environments. Never logs in prod. */
const devLogOtp = (context: string, email: string, otp: string, sent: boolean) => {
  if (env.NODE_ENV === "production") return;
  if (sent) {
    console.log(`[${context}] OTP sent to ${email} — code: ${otp}`);
  } else {
    console.error(`[${context}] Email delivery FAILED for ${email} — code: ${otp}`);
  }
};
import {
  sendSuccess,
  sendBadRequest,
  sendUnauthorized,
  sendNotFound,
  sendError,
} from "../utils/response";
import { AuthRequest } from "../types";
import crypto from "crypto";
import { emailService } from "../services/email/email.service";
import { verifyGoogleAccessToken } from "../services/auth/google.service";

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
      sendBadRequest(res, ApiMessage.REGISTRATION_FIELDS_REQUIRED);
      return;
    }

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (user.isEmailVerified) {
        sendBadRequest(res, ApiMessage.ACCOUNT_ALREADY_EXISTS);
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
    const verifyEmailSent = await emailService.sendVerificationOtp(user.email, otp);
    devLogOtp("REGISTER", user.email, otp, verifyEmailSent);

    sendSuccess(res, null, ApiMessage.ACCOUNT_CREATED_CHECK_EMAIL);
  } catch (err) {
    sendError(res, ApiMessage.REGISTRATION_FAILED, 500, err);
  }
};

export const verifyEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      sendBadRequest(res, ApiMessage.EMAIL_AND_OTP_REQUIRED);
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      sendNotFound(res, ApiMessage.USER_NOT_FOUND);
      return;
    }

    if (
      !user.verificationOtp ||
      !user.verificationOtpExpires ||
      user.verificationOtpExpires <= new Date()
    ) {
      sendUnauthorized(res, ApiMessage.OTP_INVALID_OR_EXPIRED);
      return;
    }

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
    if (hashedOtp !== user.verificationOtp) {
      sendUnauthorized(res, ApiMessage.OTP_INCORRECT);
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

    sendSuccess(res, { token, refreshToken, user: userObj }, ApiMessage.EMAIL_VERIFIED);
  } catch (err) {
    sendError(res, ApiMessage.EMAIL_VERIFICATION_FAILED, 500, err);
  }
};

export const resendVerificationOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      sendBadRequest(res, ApiMessage.EMAIL_REQUIRED);
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      sendNotFound(res, ApiMessage.USER_NOT_FOUND);
      return;
    }

    if (user.isEmailVerified) {
      sendBadRequest(res, ApiMessage.EMAIL_ALREADY_VERIFIED);
      return;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    user.verificationOtp = hashedOtp;
    user.verificationOtpExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const resendEmailSent = await emailService.sendVerificationOtp(user.email, otp);
    devLogOtp("RESEND-OTP", user.email, otp, resendEmailSent);

    sendSuccess(res, null, ApiMessage.RESEND_OTP_SUCCESS);
  } catch (err) {
    sendError(res, ApiMessage.RESEND_OTP_FAILED, 500, err);
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      sendBadRequest(res, ApiMessage.EMAIL_AND_PASSWORD_REQUIRED);
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail }).select("+password");

    if (!user) {
      sendNotFound(res, ApiMessage.USER_NOT_FOUND);
      return;
    }

    if (!(await user.comparePassword(password))) {
      if (!user.password) {
        sendUnauthorized(res, ApiMessage.USE_GOOGLE_SIGN_IN);
        return;
      }
      sendUnauthorized(res, ApiMessage.INCORRECT_PASSWORD);
      return;
    }

    if (user.isBlocked) {
      sendUnauthorized(res, ApiMessage.ACCOUNT_SUSPENDED);
      return;
    }

    user.lastLogin = new Date();
    await user.save();

    const token = signToken(user._id.toString(), user.email, user.tier);
    const refreshToken = signRefreshToken(user._id.toString());

    // Strip password from response
    const userObj = user.toJSON();

    sendSuccess(res, { token, refreshToken, user: userObj }, ApiMessage.LOGIN_SUCCESS);
  } catch (err) {
    sendError(res, ApiMessage.LOGIN_FAILED, 500, err);
  }
};

export const googleAuth = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!env.GOOGLE_CLIENT_ID?.trim()) {
      sendError(res, ApiMessage.GOOGLE_NOT_CONFIGURED, 503);
      return;
    }

    const { accessToken, accountType, referralCode } = req.body as {
      accessToken?: string;
      accountType?: string;
      referralCode?: string;
    };

    if (!accessToken || typeof accessToken !== "string") {
      sendBadRequest(res, ApiMessage.GOOGLE_TOKEN_REQUIRED);
      return;
    }

    let profile;
    try {
      profile = await verifyGoogleAccessToken(accessToken);
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "unverified_google_email") {
        sendUnauthorized(res, ApiMessage.GOOGLE_EMAIL_UNVERIFIED);
        return;
      }
      sendUnauthorized(res, ApiMessage.GOOGLE_TOKEN_INVALID);
      return;
    }

    let user = await User.findOne({ googleId: profile.googleId });
    let isNewUser = false;

    if (!user) {
      user = await User.findOne({ email: profile.email });
      if (user) {
        user.googleId = profile.googleId;
        user.isEmailVerified = true;
        if (!user.firstName) user.firstName = profile.firstName;
        if (!user.lastName) user.lastName = profile.lastName;
      } else {
        const resolvedType =
          accountType === "Law School Student" || accountType === "Undergraduate"
            ? accountType
            : "Undergraduate";

        user = new User({
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
          googleId: profile.googleId,
          accountType: resolvedType,
          isEmailVerified: true,
        });

        if (referralCode) {
          const referrer = await User.findOne({ referralKey: String(referralCode).toUpperCase() });
          if (referrer) user.referredBy = referrer._id;
        }
        isNewUser = true;
      }
    }

    if (user.isBlocked) {
      sendUnauthorized(res, ApiMessage.ACCOUNT_SUSPENDED);
      return;
    }

    user.lastLogin = new Date();
    await user.save();

    const token = signToken(user._id.toString(), user.email, user.tier);
    const refreshToken = signRefreshToken(user._id.toString());
    sendSuccess(
      res,
      { token, refreshToken, user: user.toJSON(), isNewUser },
      ApiMessage.LOGIN_SUCCESS
    );
  } catch (err) {
    sendError(res, ApiMessage.GOOGLE_AUTH_FAILED, 500, err);
  }
};

export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      sendBadRequest(res, ApiMessage.REFRESH_TOKEN_REQUIRED);
      return;
    }

    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as { userId: string };
    const user = await User.findById(decoded.userId);

    if (!user) {
      sendNotFound(res, ApiMessage.USER_NOT_FOUND);
      return;
    }

    const newToken = signToken(user._id.toString(), user.email, user.tier);
    sendSuccess(res, { token: newToken }, ApiMessage.TOKEN_REFRESHED);
  } catch {
    sendUnauthorized(res, ApiMessage.INVALID_OR_EXPIRED_REFRESH_TOKEN);
  }
};

export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.user!.userId);
    if (!user) {
      sendNotFound(res, ApiMessage.USER_NOT_FOUND);
      return;
    }
    sendSuccess(res, user, ApiMessage.PROFILE_RETRIEVED);
  } catch (err) {
    sendError(res, ApiMessage.PROFILE_RETRIEVE_FAILED, 500, err);
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) {
      sendBadRequest(res, ApiMessage.EMAIL_REQUIRED);
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      sendNotFound(res, ApiMessage.USER_NOT_FOUND);
      return;
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash OTP before saving
    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");

    user.resetPasswordOtp = hashedOtp;
    user.resetPasswordOtpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
    await user.save();

    const emailSent = await emailService.sendPasswordResetOtp(user.email, otp);
    devLogOtp("FORGOT-PASSWORD", user.email, otp, emailSent);

    sendSuccess(res, null, ApiMessage.FORGOT_PASSWORD_OTP_SENT);
  } catch (err) {
    sendError(res, ApiMessage.FORGOT_PASSWORD_FAILED, 500, err);
  }
};

export const verifyOtp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      sendBadRequest(res, ApiMessage.EMAIL_AND_OTP_REQUIRED);
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      sendNotFound(res, ApiMessage.USER_NOT_FOUND);
      return;
    }

    if (
      !user.resetPasswordOtp ||
      !user.resetPasswordOtpExpires ||
      user.resetPasswordOtpExpires <= new Date()
    ) {
      sendUnauthorized(res, ApiMessage.OTP_INVALID_OR_EXPIRED);
      return;
    }

    const hashedOtp = crypto.createHash("sha256").update(otp).digest("hex");
    if (hashedOtp !== user.resetPasswordOtp) {
      sendUnauthorized(res, ApiMessage.OTP_INCORRECT);
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

    sendSuccess(res, { resetToken }, ApiMessage.OTP_VERIFIED);
  } catch (err) {
    sendError(res, ApiMessage.OTP_VERIFY_FAILED, 500, err);
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      sendBadRequest(res, ApiMessage.RESET_TOKEN_AND_PASSWORD_REQUIRED);
      return;
    }

    if (newPassword.length < 8) {
      sendBadRequest(res, ApiMessage.PASSWORD_MIN_8);
      return;
    }

    let decoded: jwt.JwtPayload;
    try {
      const verified = jwt.verify(resetToken, env.JWT_SECRET);
      if (typeof verified === "string") {
        sendUnauthorized(res, ApiMessage.INVALID_OR_EXPIRED_RESET_TOKEN);
        return;
      }
      decoded = verified;
    } catch {
      sendUnauthorized(res, ApiMessage.INVALID_OR_EXPIRED_RESET_TOKEN);
      return;
    }

    if (decoded.purpose !== "password_reset") {
      sendUnauthorized(res, ApiMessage.INVALID_TOKEN_PURPOSE);
      return;
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      sendNotFound(res, ApiMessage.USER_NOT_FOUND);
      return;
    }

    user.password = newPassword;
    await user.save();

    sendSuccess(res, null, ApiMessage.PASSWORD_RESET_SUCCESS);
  } catch (err) {
    sendError(res, ApiMessage.PASSWORD_RESET_FAILED, 500, err);
  }
};

export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  // JWT is stateless — logout is handled client-side by discarding tokens.
  // This endpoint exists so clients have a standard place to call and for
  // future refresh-token blocklist support.
  sendSuccess(res, null, ApiMessage.LOGOUT_SUCCESS);
};

export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      sendBadRequest(res, ApiMessage.CURRENT_AND_NEW_PASSWORD_REQUIRED);
      return;
    }

    if (newPassword.length < 8) {
      sendBadRequest(res, ApiMessage.NEW_PASSWORD_MIN_8);
      return;
    }

    const user = await User.findById(req.user!.userId).select("+password");
    if (!user) {
      sendNotFound(res, ApiMessage.USER_NOT_FOUND);
      return;
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      sendUnauthorized(res, ApiMessage.CURRENT_PASSWORD_INCORRECT);
      return;
    }

    user.password = newPassword;
    await user.save();

    sendSuccess(res, null, ApiMessage.PASSWORD_CHANGED);
  } catch (err) {
    sendError(res, ApiMessage.PASSWORD_CHANGE_FAILED, 500, err);
  }
};
