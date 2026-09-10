import { Request, Response } from "express";
import { FirmTask } from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";

export const getTasks = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, priority, assignee, search } = req.query;
    const filter: Record<string, unknown> = {};

    if (status && status !== "all") filter.status = status;
    if (priority && priority !== "all") filter.priority = priority;
    if (assignee && assignee !== "all") filter.assignee = assignee;
    if (search) filter.title = { $regex: String(search), $options: "i" };

    const tasks = await FirmTask.find(filter).sort({ dueDate: 1 });
    const counts = {
      total: await FirmTask.countDocuments(),
      overdue: await FirmTask.countDocuments({ status: "overdue" }),
      inProgress: await FirmTask.countDocuments({ status: "in_progress" }),
      aiTasks: await FirmTask.countDocuments({ aiCreated: true }),
    };

    sendSuccess(res, { tasks, counts }, "Tasks retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve tasks", error);
  }
};

export const createTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firmId, title, matterId, matterName, dueDate, assignee, priority } = req.body;

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
    const { id } = req.params;
    const { status, priority, assignee } = req.body;

    const task = await FirmTask.findById(id);
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
