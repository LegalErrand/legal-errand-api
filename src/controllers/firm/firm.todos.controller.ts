import { Request, Response } from "express";
import { Types } from "mongoose";
import { FirmTodo, FirmTask, FirmMember, IFirmTodo, TodoRepeat } from "../../models/firm";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
} from "../../utils/response";
import { firmIdOf, memberIdOf } from "../../utils/tenancy";

// ─── Recurrence ──────────────────────────────────────────────────────────────
// The server owns recurrence: the next occurrence is computed here so every
// client agrees on it, and so a device that never opens the app cannot drop one.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Parses YYYY-MM-DD as a UTC day, or null when it is not a real date. */
function parseDay(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

function formatDay(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

/** Adds months, clamping to the end of the target month (31 Jan + 1m = 28 Feb). */
function addMonths(dt: Date, months: number): Date {
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + months;
  const day = dt.getUTCDate();
  const lastOfTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastOfTarget)));
}

/**
 * The date of the occurrence after `date`, or null when the to-do does not
 * repeat, the date is unusable, or the series has run past `repeatUntil`.
 */
export function nextOccurrence(
  date: string,
  repeat: TodoRepeat,
  repeatUntil?: string
): string | null {
  if (repeat === "none") return null;
  const start = parseDay(date);
  if (!start) return null;

  let next: Date;
  switch (repeat) {
    case "day":
      next = new Date(start.getTime() + 86_400_000);
      break;
    case "weekday": {
      next = new Date(start.getTime() + 86_400_000);
      // 0 = Sunday, 6 = Saturday. Weekday series skip the weekend entirely.
      while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
        next = new Date(next.getTime() + 86_400_000);
      }
      break;
    }
    case "week":
      next = new Date(start.getTime() + 7 * 86_400_000);
      break;
    case "two_weeks":
      next = new Date(start.getTime() + 14 * 86_400_000);
      break;
    case "month":
      next = addMonths(start, 1);
      break;
    case "three_months":
      next = addMonths(start, 3);
      break;
    case "year":
      next = addMonths(start, 12);
      break;
    default:
      return null;
  }

  const formatted = formatDay(next);
  if (repeatUntil && DATE_RE.test(repeatUntil) && formatted > repeatUntil) return null;
  return formatted;
}

// ─── Payload handling ────────────────────────────────────────────────────────

interface TodoPayload {
  text?: unknown;
  done?: unknown;
  date?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  repeat?: unknown;
  repeatUntil?: unknown;
  priority?: unknown;
  matterId?: unknown;
  matterName?: unknown;
  reminder?: unknown;
  notes?: unknown;
  hardDeadline?: unknown;
}

const REPEATS = [
  "none",
  "day",
  "weekday",
  "week",
  "two_weeks",
  "month",
  "three_months",
  "year",
] as const;
const REMINDERS = ["none", "at_start", "15m", "1h", "1d", "2d"] as const;
const PRIORITIES = ["low", "medium", "high"] as const;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

function asEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/**
 * Whitelists the editable fields. `firmId` and `ownerId` are never taken from
 * the body — they come from the token — so a caller cannot write a to-do into
 * someone else's name.
 */
function readFields(body: TodoPayload): { fields: Record<string, unknown>; error?: string } {
  const fields: Record<string, unknown> = {};

  const text = asString(body.text);
  if (text !== undefined) {
    if (!text) return { fields, error: "To-do text cannot be empty" };
    fields.text = text;
  }

  const date = asString(body.date);
  if (date !== undefined) {
    if (!parseDay(date)) return { fields, error: "date must be a real date in YYYY-MM-DD form" };
    fields.date = date;
  }

  for (const key of ["startTime", "endTime"] as const) {
    const time = asString(body[key]);
    if (time !== undefined) {
      if (time && !TIME_RE.test(time)) return { fields, error: `${key} must be HH:MM` };
      fields[key] = time || undefined;
    }
  }

  if (body.repeat !== undefined) {
    const repeat = asEnum(body.repeat, REPEATS);
    if (!repeat) return { fields, error: "repeat is not one of the allowed values" };
    fields.repeat = repeat;
  }

  const repeatUntil = asString(body.repeatUntil);
  if (repeatUntil !== undefined) {
    if (repeatUntil && !parseDay(repeatUntil)) {
      return { fields, error: "repeatUntil must be a real date in YYYY-MM-DD form" };
    }
    fields.repeatUntil = repeatUntil || undefined;
  }

  if (body.priority !== undefined) {
    const priority = asEnum(body.priority, PRIORITIES);
    if (!priority) return { fields, error: "priority must be low, medium or high" };
    fields.priority = priority;
  }

  if (body.reminder !== undefined) {
    const reminder = asEnum(body.reminder, REMINDERS);
    if (!reminder) return { fields, error: "reminder is not one of the allowed values" };
    fields.reminder = reminder;
  }

  const matterId = asString(body.matterId);
  if (matterId !== undefined) {
    if (matterId && !Types.ObjectId.isValid(matterId)) {
      return { fields, error: "matterId is not a valid id" };
    }
    fields.matterId = matterId || undefined;
  }

  const matterName = asString(body.matterName);
  if (matterName !== undefined) fields.matterName = matterName || undefined;

  const notes = asString(body.notes);
  if (notes !== undefined) fields.notes = notes || undefined;

  if (typeof body.done === "boolean") fields.done = body.done;
  if (typeof body.hardDeadline === "boolean") fields.hardDeadline = body.hardDeadline;

  return { fields };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * This person's to-dos. A to-do is private to its owner, so the filter carries
 * both the firm and the member — there is no endpoint that returns anyone
 * else's to-dos.
 */
export const getTodos = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);

    const includeDone = String(req.query.includeDone) === "true";
    const filter: Record<string, unknown> = { firmId, ownerId };
    if (!includeDone) filter.done = false;

    const todos = await FirmTodo.find(filter).sort({ date: 1, startTime: 1, createdAt: 1 });
    sendSuccess(res, todos, "To-dos retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve to-dos", error);
  }
};

export const createTodo = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);

    const { fields, error } = readFields(req.body as TodoPayload);
    if (error) {
      sendBadRequest(res, error);
      return;
    }
    if (!fields.text) {
      sendBadRequest(res, "To-do text is required");
      return;
    }
    if (!fields.date) {
      sendBadRequest(res, "date is required (YYYY-MM-DD)");
      return;
    }

    const todo = await FirmTodo.create({ ...fields, firmId, ownerId });
    sendCreated(res, todo, "To-do created");
  } catch (error) {
    sendBadRequest(res, "Failed to create to-do", error);
  }
};

export const updateTodo = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const { id } = req.params;

    const { fields, error } = readFields(req.body as TodoPayload);
    if (error) {
      sendBadRequest(res, error);
      return;
    }

    // Scoped lookup: by id alone this would edit another member's to-do.
    const todo = await FirmTodo.findOneAndUpdate(
      { _id: id, firmId, ownerId },
      { $set: fields },
      { new: true, runValidators: true }
    );
    if (!todo) {
      sendNotFound(res, "To-do not found");
      return;
    }

    sendSuccess(res, todo, "To-do updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update to-do", error);
  }
};

export const deleteTodo = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const { id } = req.params;

    const todo = await FirmTodo.findOneAndDelete({ _id: req.params.id, firmId, ownerId });
    if (!todo) {
      sendNotFound(res, "To-do not found");
      return;
    }

    sendSuccess(res, { id }, "To-do deleted");
  } catch (error) {
    sendBadRequest(res, "Failed to delete to-do", error);
  }
};

/**
 * Ticks a to-do done or undone.
 *
 * When a repeating to-do is ticked done the server creates the next occurrence
 * and returns it as `next`, so recurrence does not depend on the client.
 */
export const completeTodo = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const { id } = req.params;
    const { done } = req.body as { done?: unknown };

    if (typeof done !== "boolean") {
      sendBadRequest(res, "done must be true or false");
      return;
    }

    const todo = await FirmTodo.findOne({ _id: id, firmId, ownerId });
    if (!todo) {
      sendNotFound(res, "To-do not found");
      return;
    }

    const wasDone = todo.done;
    todo.done = done;
    await todo.save();

    let next: IFirmTodo | null = null;

    // Only on the transition into done, so ticking an already-done to-do again
    // cannot spawn a second copy of the same occurrence.
    if (done && !wasDone && todo.repeat !== "none") {
      const nextDate = nextOccurrence(todo.date, todo.repeat, todo.repeatUntil);
      if (nextDate) {
        next = await FirmTodo.create({
          firmId,
          ownerId,
          text: todo.text,
          done: false,
          date: nextDate,
          startTime: todo.startTime,
          endTime: todo.endTime,
          repeat: todo.repeat,
          repeatUntil: todo.repeatUntil,
          priority: todo.priority,
          matterId: todo.matterId,
          matterName: todo.matterName,
          reminder: todo.reminder,
          notes: todo.notes,
          hardDeadline: todo.hardDeadline,
          // Delegation belongs to the occurrence that was delegated, not the
          // next one, so it is deliberately not carried across.
        });
      }
    }

    sendSuccess(res, next ? { todo, next } : { todo }, "To-do updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update to-do", error);
  }
};

/**
 * Hands a personal to-do to someone else as a real firm task.
 *
 * The assignee must be a member of the caller's own firm — otherwise this would
 * be a way to create work inside another firm.
 */
export const delegateTodo = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const ownerId = memberIdOf(req);
    const { id } = req.params;
    const { assigneeId, matterId, reviewerId } = req.body as {
      assigneeId?: unknown;
      matterId?: unknown;
      reviewerId?: unknown;
    };

    if (typeof assigneeId !== "string" || !Types.ObjectId.isValid(assigneeId)) {
      sendBadRequest(res, "A valid assigneeId is required");
      return;
    }

    const todo = await FirmTodo.findOne({ _id: id, firmId, ownerId });
    if (!todo) {
      sendNotFound(res, "To-do not found");
      return;
    }
    if (todo.delegatedTaskId) {
      sendBadRequest(res, "This to-do has already been delegated");
      return;
    }

    const assignee = await FirmMember.findOne({ _id: assigneeId, firmId }).select("name initials");
    if (!assignee) {
      sendForbidden(res, "That person is not a member of this firm");
      return;
    }

    const taskMatterId =
      typeof matterId === "string" && Types.ObjectId.isValid(matterId)
        ? matterId
        : todo.matterId?.toString();
    if (!taskMatterId) {
      sendBadRequest(res, "A matterId is required — a firm task always belongs to a matter");
      return;
    }

    let reviewerName: string | undefined;
    if (typeof reviewerId === "string" && Types.ObjectId.isValid(reviewerId)) {
      const reviewer = await FirmMember.findOne({ _id: reviewerId, firmId }).select("name");
      if (!reviewer) {
        sendForbidden(res, "That reviewer is not a member of this firm");
        return;
      }
      reviewerName = reviewer.name;
    }

    const task = await FirmTask.create({
      firmId,
      title: todo.text,
      matterId: taskMatterId,
      matterName: todo.matterName || "Unassigned matter",
      dueDate: todo.date,
      assigneeId: assignee._id,
      assignee: assignee.name,
      assigneeInitials: assignee.initials,
      priority: todo.priority,
      status: "not_started",
      ...(reviewerName ? { escalatedTo: reviewerName } : {}),
      ...(todo.notes ? { aiPlan: todo.notes } : {}),
    });

    todo.delegatedTaskId = task._id as Types.ObjectId;
    todo.delegatedToName = assignee.name;
    await todo.save();

    sendCreated(res, { todo, taskId: String(task._id) }, "To-do delegated");
  } catch (error) {
    sendBadRequest(res, "Failed to delegate to-do", error);
  }
};
