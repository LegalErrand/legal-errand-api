import { Request, Response } from "express";
import { deepseekService } from "../../services/ai/deepseek.service";
import { ConversationMessage } from "../../types";
import { sendSuccess, sendBadRequest } from "../../utils/response";

/**
 * Context layered on top of the shared Nigerian-law system prompt so the
 * assistant answers as a colleague to fee earners rather than to a student.
 */
const FIRM_ASSISTANT_CONTEXT = [
  "You are assisting a qualified fee earner at a Nigerian law firm — not a student.",
  "Write for a practitioner: cite the specific rule, section or authority where one applies,",
  "and state the practical next step (the filing, the form, the deadline).",
  "Keep responses concise and conversational — 2 to 5 short paragraphs.",
  "Write in plain prose only: no markdown, no asterisks for emphasis, no headings,",
  "no bullet or numbered lists. The client renders raw text.",
  "Never present a draft as final: all output requires partner review before external",
  "submission or court filing. If you are unsure of a fact, say so rather than inventing it.",
].join(" ");

/** Suggested follow-up actions offered under each reply in the UI. */
const DEFAULT_CHIPS = [
  "Draft legal memorandum",
  "Assign task to Junior",
  "Save to Matter Workspace",
];

interface IncomingMessage {
  role?: string;
  content?: string;
}

export const askAssistant = async (req: Request, res: Response): Promise<void> => {
  try {
    const { message, matterContext, history } = req.body as {
      message?: string;
      matterContext?: string;
      history?: IncomingMessage[];
    };

    if (!message || !message.trim()) {
      sendBadRequest(res, "Message is required");
      return;
    }

    const priorTurns: ConversationMessage[] = Array.isArray(history)
      ? history
          .filter((m) => typeof m?.content === "string" && m.content.trim())
          .slice(-10) // cap the window sent upstream
          .map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content),
            timestamp: new Date(),
          }))
      : [];

    const systemContext = matterContext
      ? `${FIRM_ASSISTANT_CONTEXT} The active matter is: ${matterContext}. Answer in that context unless told otherwise.`
      : FIRM_ASSISTANT_CONTEXT;

    const reply = await deepseekService.chatWithHistory(
      [...priorTurns, { role: "user", content: message, timestamp: new Date() }],
      systemContext
    );

    sendSuccess(res, { reply, chips: DEFAULT_CHIPS }, "Assistant reply generated");
  } catch (error) {
    sendBadRequest(res, "Failed to generate assistant reply", error);
  }
};
