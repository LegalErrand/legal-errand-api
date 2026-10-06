import { Request, Response } from "express";
import { FirmAuthRequest } from "../../types/firm";
import { Client, FirmMember, Matter, FirmDocument } from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";
import { firmIdOf, memberIdOf } from "../../utils/tenancy";

export const getClients = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { status, practiceArea, search } = req.query;
    const filter: Record<string, unknown> = { firmId };

    if (status && status !== "all") filter.status = status;
    if (practiceArea && practiceArea !== "all") filter.practiceArea = practiceArea;
    if (search) filter.name = { $regex: String(search), $options: "i" };

    const clients = await Client.find(filter).sort({ updatedAt: -1 });
    const counts = {
      all: await Client.countDocuments({ firmId }),
      leads: await Client.countDocuments({ firmId, status: "lead" }),
      active: await Client.countDocuments({ firmId, status: "active" }),
      at_risk: await Client.countDocuments({ firmId, status: "at_risk" }),
      archived: await Client.countDocuments({ firmId, status: "archived" }),
    };

    sendSuccess(res, { clients, counts }, "Clients retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve clients", error);
  }
};

export const getClientById = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { id } = req.params;
    const client = await Client.findOne({ _id: id, firmId });
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
    const firmId = firmIdOf(req);
    const { id } = req.params;
    const client = await Client.findOne({ _id: id, firmId });
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
    const firmId = firmIdOf(req);
    const { id } = req.params;
    const { matterName, practiceArea, assignedLawyer } = req.body;

    const client = await Client.findOne({ _id: id, firmId });
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

/**
 * Creates a client directly (as opposed to accepting an intake).
 *
 * `firmId` comes from the token so a caller cannot write into another firm.
 */
export const createClient = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { name, type, practiceArea, lawyerName, phone } = req.body as Record<string, string>;

    if (!name?.trim()) {
      sendBadRequest(res, "Client name is required");
      return;
    }

    const client = await Client.create({
      firmId,
      name: name.trim(),
      type: type === "Company" ? "Company" : "Individual",
      practiceArea: practiceArea?.trim() || "General",
      lawyerName: lawyerName?.trim() || "",
      phone: phone?.trim() || "",
      status: "active",
      lastContactText: "Just now",
    });

    sendCreated(res, client, "Client created");
  } catch (error) {
    sendBadRequest(res, "Failed to create client", error);
  }
};

/**
 * PATCH /firm/clients/:id — LE-014.
 *
 * Fields are taken from an allow-list rather than spread from the body, so a
 * caller cannot reach firmId, status history or anything else that is not
 * theirs to set. Records who changed it and when, since a client record is
 * evidence of the relationship.
 */
export const updateClient = async (req: FirmAuthRequest, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const client = await Client.findOne({ _id: String(req.params.id), firmId });
    if (!client) {
      sendNotFound(res, "That client is not in this firm");
      return;
    }

    const body = req.body as Record<string, unknown>;
    const TEXT_FIELDS = [
      "name",
      "type",
      "status",
      "rcNumber",
      "occupation",
      "contactPerson",
      "contactRole",
      "email",
      "phone",
      "address",
      "practiceArea",
      "lawyer",
      "preferredChannel",
      "howFound",
      "notes",
      "timeZone",
      "clientSince",
    ] as const;

    for (const field of TEXT_FIELDS) {
      if (typeof body[field] === "string") client.set(field, body[field]);
    }
    if (Array.isArray(body.tags)) {
      client.tags = (body.tags as unknown[]).filter((t): t is string => typeof t === "string");
    }

    const member = await FirmMember.findById(memberIdOf(req)).select("name").lean();
    client.set("lastChangedBy", member?.name ?? "Someone at the firm");
    client.set("lastChangedAt", new Date());
    await client.save();

    sendSuccess(res, { client }, "Client updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update that client", error);
  }
};
