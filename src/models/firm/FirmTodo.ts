import { Schema, model, Document, Types } from "mongoose";

export type TodoRepeat =
  | "none"
  | "day"
  | "weekday"
  | "week"
  | "two_weeks"
  | "month"
  | "three_months"
  | "year";

export type TodoReminder = "none" | "at_start" | "15m" | "1h" | "1d" | "2d";

export const TODO_REPEATS: TodoRepeat[] = [
  "none",
  "day",
  "weekday",
  "week",
  "two_weeks",
  "month",
  "three_months",
  "year",
];

export const TODO_REMINDERS: TodoReminder[] = ["none", "at_start", "15m", "1h", "1d", "2d"];

/**
 * A personal to-do. Private to its owner: every query must filter by both
 * `firmId` and `ownerId`, and no endpoint returns another member's to-dos.
 */
export interface IFirmTodo extends Document {
  firmId: Types.ObjectId;
  ownerId: Types.ObjectId;
  text: string;
  done: boolean;
  /** YYYY-MM-DD */
  date?: string;
  /** HH:MM */
  startTime?: string;
  endTime?: string;
  repeat: TodoRepeat;
  /** YYYY-MM-DD — the recurrence stops after this date. */
  repeatUntil?: string;
  priority: "low" | "medium" | "high";
  matterId?: Types.ObjectId;
  matterName?: string;
  reminder: TodoReminder;
  notes?: string;
  hardDeadline: boolean;
  /** Set once the to-do has been turned into a real firm task. */
  delegatedTaskId?: Types.ObjectId;
  delegatedToName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FirmTodoSchema = new Schema<IFirmTodo>(
  {
    firmId: { type: Schema.Types.ObjectId, ref: "Firm", required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "FirmMember", required: true, index: true },
    text: { type: String, required: true, trim: true },
    done: { type: Boolean, default: false },
    date: { type: String },
    startTime: { type: String },
    endTime: { type: String },
    repeat: { type: String, enum: TODO_REPEATS, default: "none" },
    repeatUntil: { type: String },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    matterId: { type: Schema.Types.ObjectId, ref: "Matter" },
    matterName: { type: String },
    reminder: { type: String, enum: TODO_REMINDERS, default: "none" },
    notes: { type: String },
    hardDeadline: { type: Boolean, default: false },
    delegatedTaskId: { type: Schema.Types.ObjectId, ref: "FirmTask" },
    delegatedToName: { type: String },
  },
  {
    timestamps: true,
    // The client reads `id`; without virtuals in toJSON only `_id` is sent,
    // which breaks every detail link and lookup that keys on id.
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Every read is "this person's to-dos, by date".
FirmTodoSchema.index({ firmId: 1, ownerId: 1, date: 1 });

export const FirmTodo = model<IFirmTodo>("FirmTodo", FirmTodoSchema);
