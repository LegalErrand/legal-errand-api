import { Response } from "express";
import { Admin, ADMIN_ROLES, AdminRole } from "../../models/Admin";
import { User } from "../../models/User";
import { AdminRequest } from "../../types";
import { logger } from "../../utils/logger";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError,
} from "../../utils/response";

// ─── Admin Management ──────────────────────────────────────────────────────────

export const createAdmin = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !lastName || !email || !password) {
      sendBadRequest(res, "firstName, lastName, email, and password are required");
      return;
    }

    if (role && !ADMIN_ROLES.includes(role as AdminRole)) {
      sendBadRequest(res, `role must be one of: ${ADMIN_ROLES.join(", ")}`);
      return;
    }

    if (password.length < 8) {
      sendBadRequest(res, "Password must be at least 8 characters");
      return;
    }

    const existing = await Admin.findOne({ email: email.toLowerCase() });
    if (existing) {
      sendBadRequest(res, "An admin with this email already exists");
      return;
    }

    const admin = await Admin.create({
      firstName,
      lastName,
      email,
      password,
      role: role || "support_admin",
      createdBy: req.admin!.adminId,
    });

    logger.warn("Admin audit", {
      action: "admin.create",
      actorAdminId: req.admin!.adminId,
      targetAdminId: admin._id?.toString?.() ?? String(admin._id),
      targetEmail: admin.email,
      role: admin.role,
    });

    sendCreated(res, admin, "Admin created successfully");
  } catch (err) {
    sendError(res, "Failed to create admin", 500, (err as Error).message);
  }
};

export const listAdmins = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20", role, isBlocked } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const filter: Record<string, unknown> = {};
    if (role) filter.role = role;
    if (isBlocked !== undefined) filter.isBlocked = isBlocked === "true";

    const [admins, total] = await Promise.all([
      Admin.find(filter)
        .populate("createdBy", "firstName lastName email")
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      Admin.countDocuments(filter),
    ]);

    sendSuccess(res, admins, "Admins retrieved", 200, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (err) {
    sendError(res, "Failed to list admins", 500, (err as Error).message);
  }
};

export const getAdmin = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const admin = await Admin.findById(req.params.id).populate(
      "createdBy",
      "firstName lastName email"
    );
    if (!admin) {
      sendNotFound(res, "Admin not found");
      return;
    }
    sendSuccess(res, admin, "Admin retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve admin", 500, (err as Error).message);
  }
};

export const updateAdminRole = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { role } = req.body;

    if (!role || !ADMIN_ROLES.includes(role as AdminRole)) {
      sendBadRequest(res, `role must be one of: ${ADMIN_ROLES.join(", ")}`);
      return;
    }

    // Prevent a super_admin from demoting themselves
    if (req.params.id === req.admin!.adminId) {
      sendBadRequest(res, "You cannot change your own role");
      return;
    }

    const admin = await Admin.findByIdAndUpdate(req.params.id, { role }, { new: true });

    if (!admin) {
      sendNotFound(res, "Admin not found");
      return;
    }

    logger.warn("Admin audit", {
      action: "admin.updateRole",
      actorAdminId: req.admin!.adminId,
      targetAdminId: admin._id?.toString?.() ?? String(admin._id),
      newRole: role,
    });

    sendSuccess(res, admin, "Admin role updated");
  } catch (err) {
    sendError(res, "Failed to update admin role", 500, (err as Error).message);
  }
};

export const blockAdmin = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { reason } = req.body;

    if (req.params.id === req.admin!.adminId) {
      sendBadRequest(res, "You cannot block yourself");
      return;
    }

    const admin = await Admin.findById(req.params.id);
    if (!admin) {
      sendNotFound(res, "Admin not found");
      return;
    }

    const nowBlocking = !admin.isBlocked;

    admin.isBlocked = nowBlocking;
    if (nowBlocking) {
      admin.blockedAt = new Date();
      admin.blockedReason = reason || "Blocked by super admin";
    } else {
      admin.blockedAt = undefined;
      admin.blockedReason = undefined;
    }

    await admin.save();

    logger.warn("Admin audit", {
      action: nowBlocking ? "admin.block" : "admin.unblock",
      actorAdminId: req.admin!.adminId,
      targetAdminId: admin._id?.toString?.() ?? String(admin._id),
      reason: nowBlocking ? admin.blockedReason : undefined,
    });

    sendSuccess(res, admin, nowBlocking ? "Admin blocked" : "Admin unblocked");
  } catch (err) {
    sendError(res, "Failed to update admin block status", 500, (err as Error).message);
  }
};

export const resetAdminPassword = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      sendBadRequest(res, "newPassword must be at least 8 characters");
      return;
    }

    const admin = await Admin.findById(req.params.id);
    if (!admin) {
      sendNotFound(res, "Admin not found");
      return;
    }

    admin.password = newPassword;
    await admin.save(); // pre-save hook hashes it

    logger.warn("Admin audit", {
      action: "admin.resetPassword",
      actorAdminId: req.admin!.adminId,
      targetAdminId: admin._id?.toString?.() ?? String(admin._id),
    });

    sendSuccess(res, null, "Admin password reset successfully");
  } catch (err) {
    sendError(res, "Failed to reset admin password", 500, (err as Error).message);
  }
};

export const deleteAdmin = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    if (req.params.id === req.admin!.adminId) {
      sendBadRequest(res, "You cannot delete yourself");
      return;
    }

    const admin = await Admin.findByIdAndDelete(req.params.id);
    if (!admin) {
      sendNotFound(res, "Admin not found");
      return;
    }

    logger.warn("Admin audit", {
      action: "admin.delete",
      actorAdminId: req.admin!.adminId,
      targetAdminId: admin._id?.toString?.() ?? String(admin._id),
      targetEmail: admin.email,
    });

    sendSuccess(res, null, "Admin deleted successfully");
  } catch (err) {
    sendError(res, "Failed to delete admin", 500, (err as Error).message);
  }
};

// ─── User Management ───────────────────────────────────────────────────────────

export const listUsers = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20", search, isBlocked, tier, accountType } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const filter: Record<string, unknown> = {};
    if (isBlocked !== undefined) filter.isBlocked = isBlocked === "true";
    if (tier) filter.tier = tier;
    if (accountType) filter.accountType = accountType;
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .skip(skip)
        .limit(parseInt(limit as string))
        .sort({ createdAt: -1 }),
      User.countDocuments(filter),
    ]);

    sendSuccess(res, users, "Users retrieved", 200, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (err) {
    sendError(res, "Failed to list users", 500, (err as Error).message);
  }
};

export const getUser = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      sendNotFound(res, "User not found");
      return;
    }
    sendSuccess(res, user, "User retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve user", 500, (err as Error).message);
  }
};

export const updateUser = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const ALLOWED_FIELDS = [
      "firstName",
      "lastName",
      "email",
      "accountType",
      "username",
      "country",
      "city",
      "schoolName",
      "levelYear",
      "matricNumber",
      "phoneNumber",
      "tier",
      "isEmailVerified",
    ];

    const updates: Record<string, unknown> = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      sendBadRequest(res, "No valid fields provided for update");
      return;
    }

    const user = await User.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!user) {
      sendNotFound(res, "User not found");
      return;
    }

    logger.warn("Admin audit", {
      action: "user.update",
      actorAdminId: req.admin!.adminId,
      targetUserId: user._id?.toString?.() ?? String(user._id),
      updatedFields: Object.keys(updates),
    });

    sendSuccess(res, user, "User updated successfully");
  } catch (err) {
    sendError(res, "Failed to update user", 500, (err as Error).message);
  }
};

export const blockUser = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { reason } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      sendNotFound(res, "User not found");
      return;
    }

    const nowBlocking = !user.isBlocked;

    user.isBlocked = nowBlocking;
    if (nowBlocking) {
      user.blockedAt = new Date();
      user.blockedReason = reason || "Blocked by admin";
    } else {
      user.blockedAt = undefined;
      user.blockedReason = undefined;
    }

    await user.save();

    logger.warn("Admin audit", {
      action: nowBlocking ? "user.block" : "user.unblock",
      actorAdminId: req.admin!.adminId,
      targetUserId: user._id?.toString?.() ?? String(user._id),
      reason: nowBlocking ? user.blockedReason : undefined,
    });

    sendSuccess(res, user, nowBlocking ? "User blocked" : "User unblocked");
  } catch (err) {
    sendError(res, "Failed to update user block status", 500, (err as Error).message);
  }
};

export const deleteUser = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      sendNotFound(res, "User not found");
      return;
    }

    logger.warn("Admin audit", {
      action: "user.delete",
      actorAdminId: req.admin!.adminId,
      targetUserId: user._id?.toString?.() ?? String(user._id),
      targetEmail: user.email,
    });

    sendSuccess(res, null, "User deleted successfully");
  } catch (err) {
    sendError(res, "Failed to delete user", 500, (err as Error).message);
  }
};
