import { Request, Response } from "express";
import { Matter, FirmTask, FirmDocument } from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";

export const getMatters = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stage, type, health, lawyer, search } = req.query;
    const filter: Record<string, unknown> = {};

    if (stage && stage !== "all") filter.stage = stage;
    if (type && type !== "all") filter.type = type;
    if (health && health !== "all") filter.health = health;
    if (lawyer && lawyer !== "all") filter.lawyerName = lawyer;
    if (search) filter.name = { $regex: String(search), $options: "i" };

    const matters = await Matter.find(filter).sort({ updatedAt: -1 });

    const riskCounters = {
      deadlineWithin7Days: await Matter.countDocuments({
        nextDeadline: { $regex: "7 days|6 days|2 days", $options: "i" },
      }),
      noActivity14Days: await Matter.countDocuments({ health: "blocked" }),
      awaitingClientDocs: await Matter.countDocuments({ health: "awaiting_client" }),
    };

    sendSuccess(res, { matters, riskCounters }, "Matters retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve matters", error);
  }
};

export const getMatterById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const matter = await Matter.findById(id);
    if (!matter) {
      sendNotFound(res, "Matter not found");
      return;
    }

    const tasks = await FirmTask.find({ matterId: matter._id });
    const documents = await FirmDocument.find({ matterId: matter._id });

    sendSuccess(res, { matter, tasks, documents }, "Matter details retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve matter details", error);
  }
};

export const createMatter = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firmId, name, clientId, clientName, type, lawyerName, healthNote } = req.body;

    if (!name || !clientName) {
      sendBadRequest(res, "Matter name and client name are required");
      return;
    }

    const matter = await Matter.create({
      firmId,
      name,
      clientId,
      clientName,
      type: type || "Civil litigation",
      stage: "Intake",
      stageProgress: 10,
      lawyerName: lawyerName || "Smith",
      health: "on_track",
      healthNote: healthNote || "New matter opened",
    });

    sendCreated(res, matter, "Matter created successfully");
  } catch (error) {
    sendBadRequest(res, "Failed to create matter", error);
  }
};

export const assignWorkToJunior = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { juniorId, juniorName, tasks, brief, internalDeadline, supervisionLevel } = req.body;

    const matter = await Matter.findById(id);
    if (!matter) {
      sendNotFound(res, "Matter not found");
      return;
    }

    const createdTasks = [];
    if (Array.isArray(tasks)) {
      for (const t of tasks) {
        const newTask = await FirmTask.create({
          firmId: matter.firmId,
          title: t.title || t,
          matterId: matter._id,
          matterName: matter.name,
          dueDate: internalDeadline || "Due Sept 8",
          assignee: juniorName || "",
          assigneeInitials: (juniorName || "KA").slice(0, 2).toUpperCase(),
          assigneeId: juniorId,
          priority: "high",
          status: "in_progress",
          aiPlan: brief,
        });
        createdTasks.push(newTask);
      }
    }

    // Add activity log
    matter.recentActivity.unshift({
      time: "Just now",
      actor: "Partner",
      description: `Assigned ${createdTasks.length} task(s) to ${juniorName || "Junior"} (${supervisionLevel || "standard"} supervision)`,
    });
    await matter.save();

    sendSuccess(res, { matter, tasks: createdTasks }, "Work assigned to junior successfully");
  } catch (error) {
    sendBadRequest(res, "Failed to assign work", error);
  }
};
