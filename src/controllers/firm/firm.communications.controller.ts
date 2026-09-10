import { Request, Response } from "express";
import { FirmMessage } from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest } from "../../utils/response";

export const getMessages = async (req: Request, res: Response): Promise<void> => {
  try {
    const { channel, matterId } = req.query;
    const filter: Record<string, unknown> = {};

    if (channel && channel !== "all") filter.channel = channel;
    if (matterId) filter.matterId = matterId;

    const messages = await FirmMessage.find(filter).sort({ createdAt: -1 });
    sendSuccess(res, messages, "Messages retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve messages", error);
  }
};

export const sendMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firmId, matterId, matterName, recipient, channel, text, sender } = req.body;

    if (!text || !recipient) {
      sendBadRequest(res, "Recipient and message text are required");
      return;
    }

    const message = await FirmMessage.create({
      firmId,
      // Sender comes from the acting member once auth lands; blank until then.
      sender: sender || "",
      recipient,
      channel: channel || "whatsapp",
      snippet: text.slice(0, 60),
      fullText: text,
      matterId,
      matterName,
      timeText: "Just now",
      unread: false,
    });

    sendCreated(res, message, "Message sent successfully");
  } catch (error) {
    sendBadRequest(res, "Failed to send message", error);
  }
};
