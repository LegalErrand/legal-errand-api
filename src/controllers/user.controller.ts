import { Response } from "express";
import { User } from "../models/User";
import { sendSuccess, sendBadRequest, sendError, sendUnauthorized } from "../utils/response";
import { AuthRequest } from "../types";
import { logger } from "../utils/logger";
import { s3Service } from "../services/storage/s3.service";

export const updateBioData = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendUnauthorized(res, "Not authenticated");
      return;
    }

    if (!req.body || Object.keys(req.body).length === 0) {
      sendBadRequest(res, "Request body is required");
      return;
    }

    const {
      username,
      firstName,
      lastName,
      country,
      city,
      schoolName,
      levelYear,
      matricNumber,
      phoneNumber,
    } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      sendUnauthorized(res, "User not found");
      return;
    }

    // Optional: Validate if username is unique if it's being updated
    if (username && username !== user.username) {
      const existingUsername = await User.findOne({ username });
      if (existingUsername) {
        sendBadRequest(res, "Username is already taken");
        return;
      }
    }

    // Update fields
    if (username !== undefined) user.username = username;
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (country !== undefined) user.country = country;
    if (city !== undefined) user.city = city;
    if (schoolName !== undefined) user.schoolName = schoolName;
    if (levelYear !== undefined) user.levelYear = levelYear;
    if (matricNumber !== undefined) user.matricNumber = matricNumber;
    if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;

    await user.save();

    sendSuccess(res, user, "Bio data updated successfully");
  } catch (err) {
    logger.error("Failed to update bio data", err);
    sendError(res, "Failed to update bio data", 500, (err as Error).message);
  }
};

export const updateAvatar = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendUnauthorized(res, "Not authenticated");
      return;
    }

    const { avatar, s3Key } = req.body;
    if (!avatar || !s3Key) {
      sendBadRequest(res, "avatar and s3Key are required");
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      sendUnauthorized(res, "User not found");
      return;
    }

    user.avatar = avatar;
    await user.save();

    sendSuccess(res, { avatar: user.avatar, s3Key }, "Avatar updated successfully");
  } catch (err) {
    logger.error("Failed to update avatar", err);
    sendError(res, "Failed to update avatar", 500, (err as Error).message);
  }
};

export const getAvatarUrl = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendUnauthorized(res, "Not authenticated");
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      sendUnauthorized(res, "User not found");
      return;
    }

    if (!user.avatar) {
      sendBadRequest(res, "User has no avatar");
      return;
    }

    const avatarUrl = await s3Service.getSignedDownloadUrl(user.avatar, 3600);
    sendSuccess(res, { avatarUrl }, "Avatar URL generated");
  } catch (err) {
    logger.error("Failed to get avatar URL", err);
    sendError(res, "Failed to get avatar URL", 500, (err as Error).message);
  }
};

export const getReferral = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendUnauthorized(res, "Not authenticated");
      return;
    }

    const [user, referredUsers] = await Promise.all([
      User.findById(userId).select("referralKey referredBy firstName"),
      // referredBy is indexed — this is fast
      User.find({ referredBy: userId })
        .select("firstName lastName email createdAt")
        .sort({ createdAt: -1 }),
    ]);

    if (!user) {
      sendUnauthorized(res, "User not found");
      return;
    }

    sendSuccess(
      res,
      {
        referralKey: user.referralKey,
        referralLink: `https://legalerrand.com/join?ref=${user.referralKey}`,
        referredCount: referredUsers.length,
        referredUsers,
      },
      "Referral info retrieved"
    );
  } catch (err) {
    logger.error("Failed to get referral info", err);
    sendError(res, "Failed to get referral info", 500, (err as Error).message);
  }
};
