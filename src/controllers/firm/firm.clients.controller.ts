import { Request, Response } from "express";
import { Client, Matter, FirmDocument } from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";

export const getClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, practiceArea, search } = req.query;
    const filter: Record<string, unknown> = {};

    if (status && status !== "all") filter.status = status;
    if (practiceArea && practiceArea !== "all") filter.practiceArea = practiceArea;
    if (search) filter.name = { $regex: String(search), $options: "i" };

    const clients = await Client.find(filter).sort({ updatedAt: -1 });
    const counts = {
      all: await Client.countDocuments(),
      leads: await Client.countDocuments({ status: "lead" }),
      active: await Client.countDocuments({ status: "active" }),
      at_risk: await Client.countDocuments({ status: "at_risk" }),
      archived: await Client.countDocuments({ status: "archived" }),
    };

    sendSuccess(res, { clients, counts }, "Clients retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve clients", error);
  }
};

export const getClientById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);
    if (!client) {
      sendNotFound(res, "Client not found");
      return;
    }
    const matters = await Matter.find({ clientId: client._id });
    sendSuccess(res, { client, matters }, "Client details retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve client details", error);
  }
};

export const getClientIntake = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);
    if (!client) {
      sendNotFound(res, "Client not found");
      return;
    }

    sendSuccess(
      res,
      {
        client,
        intake: client.intakeDetails || {
          channel: "",
          aiConfidence: 0,
          conflictCheckPassed: false,
          conflictCheckNote: "",
          extractedFacts: [],
          documents: [],
        },
      },
      "Intake details retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve intake details", error);
  }
};

export const acceptClientIntake = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { matterName, practiceArea, assignedLawyer } = req.body;

    const client = await Client.findById(id);
    if (!client) {
      sendNotFound(res, "Client not found");
      return;
    }

    client.status = "active";
    client.mattersCount += 1;
    await client.save();

    // Create new active matter
    const matter = await Matter.create({
      firmId: client.firmId,
      name: matterName || `${client.name} estate administration`,
      clientId: client._id,
      clientName: client.name,
      type: practiceArea || client.practiceArea || "Probate",
      stage: "Intake",
      stageProgress: 15,
      lawyerName: assignedLawyer || "",
      health: "on_track",
      urgentItems: ["Sign Retainer Agreement", "Publish Statutory Gazette notice"],
      nextActions: [
        { label: "Client signature on retainer", date: "Sept 12" },
        { label: "File petition at Probate Registry", date: "Sept 18" },
      ],
      aiSummary: `New matter opened from WhatsApp intake. Retainer agreement dispatched to ${client.name}.`,
      recentActivity: [
        { time: "Just now", actor: "Partner", description: "Accepted intake and created matter" },
        { time: "Just now", actor: "AI", isAI: true, description: "Drafted Retainer Agreement" },
      ],
    });

    // Create preliminary retainer doc draft
    await FirmDocument.create({
      firmId: client.firmId,
      name: `Retainer agreement — ${client.name}.docx`,
      type: "Retainer",
      matterId: matter._id,
      matterName: matter.name,
      status: "awaiting_approval",
      modifiedText: "Just now",
      source: "ai_draft",
    });

    sendCreated(res, { client, matter }, "Intake accepted and matter initialized");
  } catch (error) {
    sendBadRequest(res, "Failed to accept intake", error);
  }
};
