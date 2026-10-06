import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  FirmMember,
  FirmRole,
  InternPlacement,
  PLACEMENT_TYPES,
  PlacementType,
} from "../../models/firm";
import {
  sendSuccess,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
  sendServerError,
} from "../../utils/response";
import { firmIdOf, memberIdOf, roleOf } from "../../utils/tenancy";
import { rankOf, isFirmRole, canSupervise } from "../../config/firmRanks";

/** Who may change another member at all. */
const canEditMembers = (role: string) =>
  role === "managing_partner" || role === "partner" || role === "admin";

const SUPERVISION = ["light", "standard", "close"];

/**
 * PATCH /firm/team/members/:id
 *
 * The Team page's Edit button (LE-042). Role, supervision level and whether the
 * account is active.
 *
 * Nobody grants a right they do not hold: the rank check refuses to set someone
 * to a role above the editor's own, which is the same rule the invitation
 * endpoint enforces. Everything is scoped by firmIdOf, so a member of one firm
 * can never reach another firm's people.
 */
export const updateMember = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const editorRole = roleOf(req);

    if (!canEditMembers(editorRole)) {
      sendForbidden(res, "Only a partner or an admin can change someone's role or access");
      return;
    }

    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      sendNotFound(res, "That person is not in your firm");
      return;
    }

    const member = await FirmMember.findOne({ _id: id, firmId });
    if (!member) {
      sendNotFound(res, "That person is not in your firm");
      return;
    }

    const { role, supervision, isActive } = req.body as {
      role?: string;
      supervision?: string;
      isActive?: boolean;
    };

    if (role !== undefined) {
      if (!isFirmRole(role)) {
        sendBadRequest(res, "Unknown role");
        return;
      }
      // Admin sits outside the fee-earning ladder, so rank comparison does not
      // apply to it; a partner may still set it.
      const editorRank = rankOf(editorRole);
      if (role !== "admin" && editorRank >= 0 && rankOf(role) < editorRank) {
        sendForbidden(res, "You cannot put someone above your own role");
        return;
      }
      // A firm must keep at least one managing partner, or nobody can undo it.
      if (member.role === "managing_partner" && role !== "managing_partner") {
        const others = await FirmMember.countDocuments({
          firmId,
          role: "managing_partner",
          isActive: true,
          _id: { $ne: member._id },
        });
        if (others === 0) {
          sendBadRequest(res, "A firm needs at least one managing partner");
          return;
        }
      }
      member.role = role as FirmRole;
    }

    if (supervision !== undefined) {
      if (!SUPERVISION.includes(supervision)) {
        sendBadRequest(res, "Supervision must be light, standard or close");
        return;
      }
      member.supervision = supervision as (typeof SUPERVISION)[number] as never;
    }

    if (isActive !== undefined) {
      // Suspending yourself locks you out with no way back in.
      if (!isActive && String(member._id) === memberIdOf(req)) {
        sendBadRequest(res, "You cannot suspend your own account");
        return;
      }
      member.isActive = Boolean(isActive);
    }

    await member.save();
    sendSuccess(
      res,
      {
        id: String(member._id),
        name: member.name,
        role: member.role,
        supervision: member.supervision,
        isActive: member.isActive,
      },
      "Saved"
    );
  } catch (error) {
    sendServerError(res, "Could not save that person", error);
  }
};

/**
 * PUT /firm/team/members/:id/placement
 *
 * The partner side of LE-046. An intern's own screens read their placement but
 * cannot create one, so without this `/my-placement` shows its empty state for
 * ever.
 *
 * Upsert rather than create: a firm sets a placement up once and then corrects
 * the dates or the hours target, and a second live placement for the same
 * person would make the logbook ambiguous.
 */
export const upsertPlacement = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    if (!canEditMembers(roleOf(req))) {
      sendForbidden(res, "Only a partner or an admin can set up a placement");
      return;
    }

    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      sendNotFound(res, "That person is not in your firm");
      return;
    }

    const intern = await FirmMember.findOne({ _id: id, firmId });
    if (!intern) {
      sendNotFound(res, "That person is not in your firm");
      return;
    }
    if (intern.role !== "intern") {
      sendBadRequest(res, "Only an intern has a placement");
      return;
    }

    const {
      type,
      practiceArea,
      startDate,
      endDate,
      hoursTarget,
      weeklyHoursTarget,
      sittingsTarget,
      supervisorId,
    } = req.body as Record<string, unknown>;

    if (!PLACEMENT_TYPES.includes(type as PlacementType)) {
      sendBadRequest(res, "Pick a placement type");
      return;
    }
    const start = String(startDate ?? "");
    const end = String(endDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
      sendBadRequest(res, "Give a start and end date");
      return;
    }
    if (end <= start) {
      sendBadRequest(res, "The placement must end after it starts");
      return;
    }

    // The supervisor has to be someone in this firm who is senior enough to
    // sign a logbook — an intern cannot supervise an intern.
    if (!Types.ObjectId.isValid(String(supervisorId))) {
      sendBadRequest(res, "Pick a supervisor");
      return;
    }
    const supervisor = await FirmMember.findOne({ _id: String(supervisorId), firmId });
    if (!supervisor) {
      sendBadRequest(res, "That supervisor is not in your firm");
      return;
    }
    if (!canSupervise(supervisor.role)) {
      sendBadRequest(res, "A supervisor must be an associate or above");
      return;
    }

    const hours = Number(hoursTarget);
    const weekly = Number(weeklyHoursTarget);
    const sittings = Number(sittingsTarget);
    if (!Number.isFinite(hours) || hours <= 0) {
      sendBadRequest(res, "Set an hours target");
      return;
    }

    const placement = await InternPlacement.findOneAndUpdate(
      { firmId, internId: intern._id },
      {
        $set: {
          firmId,
          internId: intern._id,
          type,
          practiceArea: practiceArea ? String(practiceArea) : undefined,
          startDate: start,
          endDate: end,
          hoursTarget: hours,
          weeklyHoursTarget: Number.isFinite(weekly) && weekly > 0 ? weekly : 20,
          sittingsTarget: Number.isFinite(sittings) && sittings >= 0 ? sittings : 3,
          supervisorId: supervisor._id,
          supervisorName: supervisor.name,
          supervisorRole: supervisor.role,
          isActive: true,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    sendSuccess(res, placement, "Placement saved");
  } catch (error) {
    sendServerError(res, "Could not save the placement", error);
  }
};

/** GET /firm/team/members/:id/placement — what the setup screen opens with. */
export const getMemberPlacement = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const id = String(req.params.id);
    if (!Types.ObjectId.isValid(id)) {
      sendNotFound(res, "That person is not in your firm");
      return;
    }
    const placement = await InternPlacement.findOne({ firmId, internId: id });
    sendSuccess(res, placement, placement ? "Placement" : "No placement yet");
  } catch (error) {
    sendServerError(res, "Could not load the placement", error);
  }
};
