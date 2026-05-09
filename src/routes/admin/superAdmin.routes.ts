import { Router } from "express";
import {
  createAdmin,
  listAdmins,
  getAdmin,
  updateAdminRole,
  blockAdmin,
  resetAdminPassword,
  deleteAdmin,
  listUsers,
  getUser,
  updateUser,
  blockUser,
  deleteUser,
} from "../../controllers/admin/superAdmin.controller";
import { authenticateAdmin, requireSuperAdmin } from "../../middleware/adminAuth.middleware";

const router = Router();

router.use(authenticateAdmin, requireSuperAdmin);

// ─── Admin Management ─────────────────────────────────────────────────────────
router.post("/admins", createAdmin);                          // Create new admin
router.get("/admins", listAdmins);                            // List all admins
router.get("/admins/:id", getAdmin);                         // Get single admin
router.patch("/admins/:id/role", updateAdminRole);           // Change role
router.patch("/admins/:id/block", blockAdmin);               // Toggle block/unblock
router.patch("/admins/:id/reset-password", resetAdminPassword); // Reset password
router.delete("/admins/:id", deleteAdmin);                   // Delete admin

// ─── User Management ─────────────────────────────────────────────────────────
router.get("/users", listUsers);                              // List all users
router.get("/users/:id", getUser);                           // Get single user
router.patch("/users/:id", updateUser);                      // Update user details
router.patch("/users/:id/block", blockUser);                 // Toggle block/unblock
router.delete("/users/:id", deleteUser);                     // Delete user

export default router;
