import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";
import { env } from "../config/env";
import { sendSuccess, sendCreated, sendBadRequest, sendUnauthorized, sendError } from "../utils/response";
import { AuthRequest } from "../types";

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
    const { name, email, password, university, yearOfStudy } = req.body;

    if (!name || !email || !password) {
      sendBadRequest(res, "Name, email, and password are required");
      return;
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      sendBadRequest(res, "An account with this email already exists");
      return;
    }

    const user = await User.create({ name, email, password, university, yearOfStudy });

    const token = signToken(user._id.toString(), user.email, user.tier);
    const refreshToken = signRefreshToken(user._id.toString());

    sendCreated(res, { token, refreshToken, user }, "Account created successfully");
  } catch (err) {
    sendError(res, "Registration failed", 500, (err as Error).message);
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
