import { Request, Response } from "express";
import { FirmTask } from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";
import { firmIdOf } from "../../utils/tenancy";

export const getTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { status, priority, assignee, search } = req.query;

    // firmId is set first and never overwritten by a query parameter.
    const filter: Record<string, unknown> = { firmId };

    if (status && status !== "all") filter.status = status;
    if (priority && priority !== "all") filter.priority = priority;
    if (assignee && assignee !== "all") filter.assignee = assignee;
    if (search) filter.title = { $regex: String(search), $options: "i" };

    const tasks = await FirmTask.find(filter).sort({ dueDate: 1 });

    // Counts describe this firm, so they carry the same scope as the list.
    const [total, overdue, inProgress, aiTasks] = await Promise.all([
      FirmTask.countDocuments({ firmId }),
      FirmTask.countDocuments({ firmId, status: "overdue" }),
      FirmTask.countDocuments({ firmId, status: "in_progress" }),
      FirmTask.countDocuments({ firmId, aiCreated: true }),
    ]);

    sendSuccess(res, { tasks, counts: { total, overdue, inProgress, aiTasks } }, "Tasks retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve tasks", error);
  }
};

export const createTask = async (req: Request, res: Response): Promise<void> => {
  try {
    // The firm comes from the verified token, never from the body — a caller
    // must not be able to create a task inside someone else's firm.
    const firmId = firmIdOf(req);
    const { title, matterId, matterName, dueDate, assignee, priority } = req.body;

    if (!title || !matterName) {
      sendBadRequest(res, "Task title and matter name are required");
      return;
    }

    const task = await FirmTask.create({
      firmId,
      title,
      matterId,
      matterName,
      dueDate: dueDate || "Due in 3 days",
      assignee: assignee || "",
      assigneeInitials: (assignee || "AS").slice(0, 2).toUpperCase(),
      priority: priority || "medium",
      status: "not_started",
    });

    sendCreated(res, task, "Task created successfully");
  } catch (error) {
    sendBadRequest(res, "Failed to create task", error);
  }
};

export const updateTaskStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { id } = req.params;
    const { status, priority, assignee } = req.body;

    // Scoped lookup: finding by id alone would let one firm edit another's work.
    const task = await FirmTask.findOne({ _id: id, firmId });
    if (!task) {
      sendNotFound(res, "Task not found");
      return;
    }

    if (status) task.status = status;
    if (priority) task.priority = priority;
    if (assignee) {
      task.assignee = assignee;
      task.assigneeInitials = assignee.slice(0, 2).toUpperCase();
    }
    await task.save();

    sendSuccess(res, task, "Task updated successfully");
  } catch (error) {
    sendBadRequest(res, "Failed to update task", error);
  }
};
