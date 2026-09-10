import { Request, Response } from "express";
import { CalendarEvent } from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";

export const getCalendarEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, month, lawyer } = req.query;
    const filter: Record<string, unknown> = {};

    if (type && type !== "all") filter.type = type;
    if (lawyer && lawyer !== "all") filter.lawyer = lawyer;
    if (month) filter.date = { $regex: `^${month}` };

    const events = await CalendarEvent.find(filter).sort({ date: 1, time: 1 });
    sendSuccess(res, events, "Calendar events retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve calendar events", error);
  }
};

export const createCalendarEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firmId, title, date, time, type, matter, lawyer, location, relatedTasks, documents } =
      req.body;

    if (!title || !date) {
      sendBadRequest(res, "Event title and date are required");
      return;
    }

    const event = await CalendarEvent.create({
      firmId,
      title,
      date,
      time,
      type: type || "meeting",
      matter,
      lawyer,
      location,
      relatedTasks: relatedTasks || [],
      documents: documents || [],
    });

    sendCreated(res, event, "Calendar event created");
  } catch (error) {
    sendBadRequest(res, "Failed to create calendar event", error);
  }
};

export const startHearingPrep = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const event = await CalendarEvent.findById(id);
    if (!event) {
      sendNotFound(res, "Court hearing event not found");
      return;
    }

    const prepBundle = {
      hearing: event.title,
      date: event.date,
      time: event.time,
      courtroom: event.location,
      matter: event.matter,
      keyIssues: [
        "Opposing counsel's preliminary objection on jurisdiction",
        "Admissibility of electronic mail backups without certificate of identification",
      ],
      suggestedAuthorities: [
        {
          caseName: "Kubor v Dickson (2013) 4 NWLR",
          principle: "Section 84 Evidence Act compliance for electronic printouts",
        },
        {
          caseName: "Madukolu v Nkemdilim (1962) 2 SCNLR",
          principle: "Locus classicus on competence of court jurisdiction",
        },
      ],
      checklist: [
        { item: "Witness proof of evidence ready", done: true },
        { item: "Original certified true copies bundled", done: false },
        { item: "Client attendance confirmed", done: true },
      ],
    };

    sendSuccess(res, prepBundle, "AI hearing prep bundle assembled");
  } catch (error) {
    sendBadRequest(res, "Failed to assemble hearing prep", error);
  }
};
