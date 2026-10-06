import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  InternPlacement,
  InternLogbookEntry,
  InternLearningGoal,
  InternSitting,
  InternFeedback,
  IInternPlacement,
  IInternLogbookEntry,
  CalendarEvent,
  FirmMember,
  FirmTask,
  FirmMessage,
} from "../../models/firm";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
} from "../../utils/response";
import { firmIdOf, memberIdOf, roleOf } from "../../utils/tenancy";
import { INTERNAL_CHANNEL, EXTERNAL_SEND_REFUSAL } from "../../utils/internalOnly";

/**
 * LE-046 — My placement.
 *
 * Two rules shape every handler here:
 *
 * 1. Tenancy. `firmId` and `ownerId` come from the verified token and are added
 *    to every query. A logbook belongs to one intern, so there is no endpoint
 *    that reads or writes anyone else's.
 * 2. Nothing leaves the firm. The only outbound route is "message supervisor",
 *    which writes an internal message to one member of the caller's own firm —
 *    there is no recipient field a caller could point at a client.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseDay(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Monday of the week containing `iso`, as YYYY-MM-DD. */
function weekStart(iso: string): string {
  const dt = parseDay(iso) ?? new Date();
  const day = dt.getUTCDay(); // 0 = Sunday
  const back = day === 0 ? 6 : day - 1;
  return new Date(dt.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(100, Math.round(value));
}

// ─── Shared lookup ───────────────────────────────────────────────────────────

/**
 * The caller's own live placement. Scoped to the firm and the caller: an intern
 * cannot ask for a placement by id, so there is nothing to tamper with.
 */
async function activePlacement(req: Request): Promise<IInternPlacement | null> {
  return InternPlacement.findOne({
    firmId: firmIdOf(req),
    internId: memberIdOf(req),
    isActive: true,
  }).sort({ createdAt: -1 });
}

/** Loads the placement or answers 404 once, so each handler stays flat. */
async function requirePlacement(req: Request, res: Response): Promise<IInternPlacement | null> {
  const placement = await activePlacement(req);
  if (!placement) {
    sendNotFound(res, "No placement has been set up for you yet — ask a partner to create one");
    return null;
  }
  return placement;
}

// ─── The screen ──────────────────────────────────────────────────────────────

/**
 * Everything My placement renders, in one round trip.
 *
 * Nothing here is firm-wide: assignments are the caller's own tasks, and the
 * court sittings offered are only those on matters the caller is assigned to.
 */
export const getPlacement = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const placement = await activePlacement(req);

    if (!placement) {
      sendSuccess(
        res,
        {
          placement: null,
          supervisor: null,
          logbook: [],
          goals: [],
          assignments: [],
          sittings: [],
          feedback: [],
          totals: null,
        },
        "No placement set up yet"
      );
      return;
    }

    const placementId = placement._id as Types.ObjectId;
    const scope = { firmId, ownerId, placementId };

    const [logbook, goals, sittings, feedback, supervisor, tasks] = await Promise.all([
      InternLogbookEntry.find(scope).sort({ date: -1, createdAt: -1 }),
      InternLearningGoal.find(scope).sort({ order: 1, createdAt: 1 }),
      InternSitting.find(scope).sort({ date: 1 }),
      InternFeedback.find(scope).sort({ createdAt: -1 }).limit(20),
      FirmMember.findOne({ _id: placement.supervisorId, firmId }).select(
        "name role email initials"
      ),
      FirmTask.find({ firmId, assigneeId: ownerId }).sort({ createdAt: -1 }),
    ]);

    // Court sittings the intern may attend: future court dates on the matters
    // they are actually working on. A matter is "theirs" when they hold a task
    // on it — `Matter` carries no team list to read instead. A sitting on
    // someone else's matter is never offered.
    const matterIds = [...new Set(tasks.map((t) => String(t.matterId)))];
    const upcoming = await CalendarEvent.find({
      firmId,
      type: "court",
      date: { $gte: today() },
      ...(matterIds.length ? { matterId: { $in: matterIds } } : {}),
    })
      .sort({ date: 1 })
      .limit(25);

    const attendingIds = new Set(sittings.map((s) => String(s.eventId)));
    const offered = upcoming.map((event) => ({
      eventId: String(event._id),
      title: event.title,
      date: event.date,
      time: event.time,
      court: event.location,
      matterName: event.matter,
      attending: attendingIds.has(String(event._id)),
    }));

    // ── Totals. Every figure below is derived from the lists returned above,
    // so the cards cannot disagree with what the intern can open.
    const hoursTotal = round1(logbook.reduce((sum, e) => sum + e.hours, 0));
    const thisWeekStart = weekStart(today());
    const hoursThisWeek = round1(
      logbook.filter((e) => e.date >= thisWeekStart).reduce((sum, e) => sum + e.hours, 0)
    );

    const start = parseDay(placement.startDate);
    const end = parseDay(placement.endDate);
    const now = Date.now();
    const weeksTotal =
      start && end ? Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (7 * DAY_MS))) : 0;
    const weekIndex = start
      ? Math.min(
          weeksTotal || 1,
          Math.max(1, Math.floor((now - start.getTime()) / (7 * DAY_MS)) + 1)
        )
      : 0;

    const goalsDone = goals.filter((g) => g.done).length;
    const countersigned = logbook.filter((e) => e.countersignedAt).length;

    // Placement progress is the average of time elapsed and hours logged, so a
    // long placement with nothing logged does not read as nearly finished.
    const elapsedPct = weeksTotal ? (weekIndex / weeksTotal) * 100 : 0;
    const hoursPct = placement.hoursTarget ? (hoursTotal / placement.hoursTarget) * 100 : 0;

    sendSuccess(
      res,
      {
        placement,
        supervisor: supervisor
          ? {
              id: String(supervisor._id),
              name: supervisor.name,
              role: supervisor.role,
              initials: supervisor.initials,
            }
          : { id: String(placement.supervisorId), name: placement.supervisorName },
        logbook,
        goals,
        assignments: tasks,
        sittings: offered,
        feedback,
        totals: {
          hoursTotal,
          hoursTarget: placement.hoursTarget,
          hoursThisWeek,
          hoursExpectedThisWeek: placement.weeklyHoursTarget,
          entries: logbook.length,
          countersigned,
          goalsDone,
          goalsTotal: goals.length,
          sittingsAttended: sittings.length,
          sittingsTarget: placement.sittingsTarget,
          weekIndex,
          weeksTotal,
          dueToday: tasks.filter((t) => t.status !== "done" && t.dueDate === today()).length,
          withSupervisor: tasks.filter((t) => t.status === "escalated").length,
          progressPct: clampPct((elapsedPct + hoursPct) / 2),
        },
      },
      "Placement retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve your placement", error);
  }
};

// ─── Logbook ─────────────────────────────────────────────────────────────────

interface LogbookPayload {
  date?: unknown;
  hours?: unknown;
  activity?: unknown;
  matterId?: unknown;
  matterName?: unknown;
}

function readLogbookFields(
  body: LogbookPayload,
  placement: IInternPlacement
): { fields: Record<string, unknown>; error?: string } {
  const fields: Record<string, unknown> = {};

  if (body.date !== undefined) {
    const date = typeof body.date === "string" ? body.date.trim() : "";
    if (!parseDay(date)) return { fields, error: "date must be a real date in YYYY-MM-DD form" };
    // A logbook line outside the placement is not a logbook line.
    if (date < placement.startDate || date > placement.endDate) {
      return {
        fields,
        error: `date must fall inside the placement (${placement.startDate} to ${placement.endDate})`,
      };
    }
    fields.date = date;
  }

  if (body.hours !== undefined) {
    const hours = typeof body.hours === "number" ? body.hours : Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return { fields, error: "hours must be a number greater than 0 and no more than 24" };
    }
    fields.hours = round1(hours);
  }

  if (body.activity !== undefined) {
    const activity = typeof body.activity === "string" ? body.activity.trim() : "";
    if (!activity) return { fields, error: "Describe what you did" };
    fields.activity = activity;
  }

  if (body.matterId !== undefined) {
    const matterId = typeof body.matterId === "string" ? body.matterId.trim() : "";
    if (matterId && !Types.ObjectId.isValid(matterId)) {
      return { fields, error: "matterId is not a valid id" };
    }
    fields.matterId = matterId || undefined;
  }

  if (body.matterName !== undefined) {
    const matterName = typeof body.matterName === "string" ? body.matterName.trim() : "";
    fields.matterName = matterName || undefined;
  }

  return { fields };
}

export const createLogbookEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const placement = await requirePlacement(req, res);
    if (!placement) return;

    const { fields, error } = readLogbookFields(req.body as LogbookPayload, placement);
    if (error) {
      sendBadRequest(res, error);
      return;
    }
    if (!fields.date || !fields.hours || !fields.activity) {
      sendBadRequest(res, "date, hours and activity are all required");
      return;
    }

    // A day cannot exceed 24 hours across every line for that day.
    const sameDay = await InternLogbookEntry.find({ firmId, ownerId, date: fields.date }).select(
      "hours"
    );
    const dayTotal = sameDay.reduce((sum, e) => sum + e.hours, 0) + Number(fields.hours);
    if (dayTotal > 24) {
      sendBadRequest(res, "That day would come to more than 24 hours");
      return;
    }

    const entry = await InternLogbookEntry.create({
      ...fields,
      firmId,
      ownerId,
      placementId: placement._id,
      source: "manual",
    });

    sendCreated(res, entry, "Logbook entry added");
  } catch (error) {
    sendBadRequest(res, "Failed to add the logbook entry", error);
  }
};

export const updateLogbookEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const placement = await requirePlacement(req, res);
    if (!placement) return;

    const entry = await InternLogbookEntry.findOne({ _id: req.params.id, firmId, ownerId });
    if (!entry) {
      sendNotFound(res, "Logbook entry not found");
      return;
    }
    // A countersigned line is the supervisor's statement as much as the
    // intern's — reopening it would rewrite something already signed.
    if (entry.countersignedAt) {
      sendForbidden(res, "That entry has been countersigned and can no longer be changed");
      return;
    }

    const { fields, error } = readLogbookFields(req.body as LogbookPayload, placement);
    if (error) {
      sendBadRequest(res, error);
      return;
    }

    Object.assign(entry, fields);
    await entry.save();
    sendSuccess(res, entry, "Logbook entry updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update the logbook entry", error);
  }
};

export const deleteLogbookEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const { id } = req.params;

    const entry = await InternLogbookEntry.findOne({ _id: id, firmId, ownerId });
    if (!entry) {
      sendNotFound(res, "Logbook entry not found");
      return;
    }
    if (entry.countersignedAt) {
      sendForbidden(res, "That entry has been countersigned and can no longer be removed");
      return;
    }

    // Attending a sitting created this line; clear the link so the sitting can
    // be re-attended rather than left pointing at a deleted entry.
    await InternSitting.updateMany(
      { firmId, ownerId, logbookEntryId: entry._id },
      { $unset: { logbookEntryId: "" } }
    );
    await entry.deleteOne();

    sendSuccess(res, { id }, "Logbook entry removed");
  } catch (error) {
    sendBadRequest(res, "Failed to remove the logbook entry", error);
  }
};

/**
 * Asks the supervisor to countersign the entries that are not yet signed.
 *
 * The intern never signs their own book: this writes an internal message to the
 * supervisor named on the placement and nothing else.
 */
export const requestCountersign = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const placement = await requirePlacement(req, res);
    if (!placement) return;

    const pending = await InternLogbookEntry.find({
      firmId,
      ownerId,
      placementId: placement._id,
      countersignedAt: { $exists: false },
    }).select("date hours");

    if (!pending.length) {
      sendBadRequest(res, "Every entry in your logbook has already been countersigned");
      return;
    }

    const me = await FirmMember.findOne({ _id: ownerId, firmId }).select("name");
    const hours = round1(pending.reduce((sum, e) => sum + e.hours, 0));
    const text = `${me?.name ?? "Your intern"} has asked you to countersign ${pending.length} logbook ${
      pending.length === 1 ? "entry" : "entries"
    } totalling ${hours} hours.`;

    await FirmMessage.create({
      firmId,
      sender: me?.name ?? "Intern",
      senderId: ownerId,
      recipient: placement.supervisorName,
      channel: INTERNAL_CHANNEL,
      snippet: text.slice(0, 60),
      fullText: text,
      unread: true,
    });

    sendSuccess(
      res,
      { pending: pending.length, hours, supervisorName: placement.supervisorName },
      "Countersignature requested"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to request a countersignature", error);
  }
};

// ─── Learning goals ──────────────────────────────────────────────────────────

/**
 * Ticks one learning goal. `done` is the only field an intern may change —
 * the wording and the order belong to whoever set the placement.
 */
export const updateLearningGoal = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const { done } = req.body as { done?: unknown };

    if (typeof done !== "boolean") {
      sendBadRequest(res, "done must be true or false");
      return;
    }

    const goal = await InternLearningGoal.findOne({ _id: req.params.id, firmId, ownerId });
    if (!goal) {
      sendNotFound(res, "Learning goal not found");
      return;
    }
    if (goal.kind === "sittings") {
      sendForbidden(res, "This goal is met by attending court sittings, not by ticking it");
      return;
    }

    goal.done = done;
    goal.doneAt = done ? new Date() : undefined;
    await goal.save();

    sendSuccess(res, goal, "Learning goal updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update the learning goal", error);
  }
};

// ─── Court sittings ──────────────────────────────────────────────────────────

/**
 * "I'll attend" — records the attendance and adds the logbook entry for it, so
 * attendance always has an hours line behind it and counts toward the goal.
 */
export const attendSitting = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const placement = await requirePlacement(req, res);
    if (!placement) return;

    const eventId = String(req.params.eventId ?? "");
    if (!Types.ObjectId.isValid(eventId)) {
      sendBadRequest(res, "A valid sitting id is required");
      return;
    }

    const event = await CalendarEvent.findOne({ _id: eventId, firmId, type: "court" });
    if (!event) {
      sendNotFound(res, "Court sitting not found");
      return;
    }

    const existing = await InternSitting.findOne({ firmId, ownerId, eventId: event._id });
    if (existing) {
      sendBadRequest(res, "You are already down to attend that sitting");
      return;
    }

    const { hours } = req.body as { hours?: unknown };
    const asked = typeof hours === "number" ? hours : Number(hours);
    const logged = Number.isFinite(asked) && asked > 0 && asked <= 24 ? round1(asked) : 3;

    // The sitting may fall outside the placement window; the logbook line is
    // only created when the date is one the logbook accepts.
    const insideWindow = event.date >= placement.startDate && event.date <= placement.endDate;

    let entry: IInternLogbookEntry | null = null;
    if (insideWindow) {
      entry = await InternLogbookEntry.create({
        firmId,
        ownerId,
        placementId: placement._id,
        date: event.date,
        hours: logged,
        activity: `Attended court sitting — ${event.title}`,
        matterId: event.matterId,
        matterName: event.matter,
        source: "court_sitting",
        sittingEventId: event._id,
      });
    }

    const sitting = await InternSitting.create({
      firmId,
      ownerId,
      placementId: placement._id,
      eventId: event._id,
      title: event.title,
      date: event.date,
      court: event.location,
      matterName: event.matter,
      logbookEntryId: entry?._id,
    });

    const attended = await InternSitting.countDocuments({
      firmId,
      ownerId,
      placementId: placement._id,
    });

    sendCreated(
      res,
      {
        sitting,
        logbookEntry: entry,
        attended,
        sittingsTarget: placement.sittingsTarget,
      },
      "You are down to attend that sitting"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to record your attendance", error);
  }
};

// ─── Assignments ─────────────────────────────────────────────────────────────

const INTERN_TASK_STEPS = ["in_progress", "submitted"] as const;
type InternTaskStep = (typeof INTERN_TASK_STEPS)[number];

/**
 * Start → In progress → Submit for review → "With supervisor".
 *
 * Submitting does not close the task: it escalates it to the named supervisor,
 * which is what "With supervisor" means everywhere else in the product. An
 * intern cannot mark their own work done, because nothing of theirs is finished
 * until a supervisor says so.
 */
export const updateAssignmentStep = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const placement = await requirePlacement(req, res);
    if (!placement) return;

    const { step } = req.body as { step?: unknown };
    if (typeof step !== "string" || !(INTERN_TASK_STEPS as readonly string[]).includes(step)) {
      sendBadRequest(res, "step must be in_progress or submitted");
      return;
    }

    // Scoped to the caller: an intern may only move their own assignments.
    const task = await FirmTask.findOne({ _id: req.params.taskId, firmId, assigneeId: ownerId });
    if (!task) {
      sendNotFound(res, "Assignment not found");
      return;
    }

    const next = step as InternTaskStep;
    if (next === "in_progress") {
      task.status = "in_progress";
    } else {
      task.status = "escalated";
      task.escalatedTo = placement.supervisorName;
    }
    await task.save();

    sendSuccess(
      res,
      { task, withSupervisor: next === "submitted" ? placement.supervisorName : undefined },
      next === "submitted" ? "Submitted to your supervisor" : "Assignment started"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to update the assignment", error);
  }
};

// ─── Message supervisor ──────────────────────────────────────────────────────

/**
 * The only way an intern sends anything from this screen.
 *
 * The recipient is not a parameter: it is the supervisor named on the caller's
 * own placement, resolved from the database and confirmed to be a member of the
 * caller's firm. The channel is forced to internal. There is therefore no
 * value a caller can supply that puts this message in front of a client.
 */
export const messageSupervisor = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const placement = await requirePlacement(req, res);
    if (!placement) return;

    const { text, matterId, matterName } = req.body as {
      text?: unknown;
      matterId?: unknown;
      matterName?: unknown;
    };
    const body = typeof text === "string" ? text.trim() : "";
    if (!body) {
      sendBadRequest(res, "Write a message first");
      return;
    }

    const supervisor = await FirmMember.findOne({
      _id: placement.supervisorId,
      firmId,
      isActive: true,
    }).select("name");
    if (!supervisor) {
      // Not a 404 on the message: the supervisor is the only permitted
      // recipient, so without them there is nowhere inside the firm to send it.
      sendForbidden(res, `${EXTERNAL_SEND_REFUSAL} Your supervisor is no longer at this firm.`);
      return;
    }

    const me = await FirmMember.findOne({ _id: ownerId, firmId }).select("name");

    const message = await FirmMessage.create({
      firmId,
      sender: me?.name ?? "Intern",
      senderId: ownerId,
      recipient: supervisor.name,
      channel: INTERNAL_CHANNEL,
      snippet: body.slice(0, 60),
      fullText: body,
      matterId:
        typeof matterId === "string" && Types.ObjectId.isValid(matterId) ? matterId : undefined,
      matterName: typeof matterName === "string" && matterName ? matterName : undefined,
      unread: true,
    });

    sendCreated(res, message, "Sent to your supervisor");
  } catch (error) {
    sendBadRequest(res, "Failed to message your supervisor", error);
  }
};

/**
 * What this role may not do, stated plainly so the UI can explain itself rather
 * than silently hiding controls. Read-only; it grants nothing.
 */
export const getPlacementLimits = async (req: Request, res: Response): Promise<void> => {
  try {
    sendSuccess(
      res,
      {
        role: roleOf(req),
        canMessageClients: false,
        canSendOutsideFirm: false,
        note: EXTERNAL_SEND_REFUSAL,
      },
      "Limits retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve limits", error);
  }
};
