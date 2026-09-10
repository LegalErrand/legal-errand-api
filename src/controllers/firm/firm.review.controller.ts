import { Request, Response } from "express";
import { ReviewQueueItem, FirmTimeEntry } from "../../models/firm";
import { sendSuccess, sendBadRequest, sendNotFound } from "../../utils/response";

export const getReviewQueue = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, status } = req.query;
    const filter: Record<string, unknown> = {};

    if (type && type !== "all") filter.type = type;
    if (status && status !== "all") filter.status = status;

    const items = await ReviewQueueItem.find(filter).sort({ createdAt: -1 });
    sendSuccess(res, items, "Review queue retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve review queue", error);
  }
};

export const getReviewItemById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const item = await ReviewQueueItem.findById(id);
    if (!item) {
      sendNotFound(res, "Review item not found");
      return;
    }
    sendSuccess(res, item, "Review item details retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve review item", error);
  }
};

export const actionReviewItem = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { action, feedback, logHours } = req.body; // action: 'approve' | 'request_changes' | 'sign_off'

    const item = await ReviewQueueItem.findById(id);
    if (!item) {
      sendNotFound(res, "Review item not found");
      return;
    }

    if (action === "request_changes") {
      item.status = "changes_requested";
      item.feedback = feedback || "Changes requested by reviewer";
      item.nextStep = item.preparedBy;
    } else {
      item.status = "approved";
      item.feedback = feedback || "Approved";
      item.nextStep = item.type === "filing" ? "Court e-portal" : "Client / E-sign";
    }

    await item.save();

    // Passively log review time if specified
    if (logHours && Number(logHours) > 0) {
      await FirmTimeEntry.create({
        firmId: item.firmId,
        activity: `Partner review & sign-off: ${item.title}`,
        matterId: item.matterId,
        matterName: item.matter,
        duration: Number(logHours),
        billable: true,
        source: "manual",
        approved: true,
      });
    }

    sendSuccess(res, item, `Review action '${action}' recorded`);
  } catch (error) {
    sendBadRequest(res, "Failed to process review action", error);
  }
};
