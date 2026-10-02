import { Request, Response } from "express";
import { Firm, FirmMember, EscalationRule } from "../../models/firm";
import { sendSuccess, sendBadRequest, sendNotFound } from "../../utils/response";
import { firmIdOf } from "../../utils/tenancy";

export const getFirmSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);

    // findOne() returned whichever firm happened to be first in the
    // collection, which is every other firm's settings.
    const firm = await Firm.findById(firmId);

    const members = await FirmMember.find({ firmId });
    const escalationRules = await EscalationRule.find({ firmId });

    const accessMatrix = [
      {
        action: "View matter pleadings & case documents",
        mp: "Full",
        p: "Full",
        sa: "Full",
        a: "Full",
        j: "Full",
        para: "Full",
        adm: "Full",
      },
      {
        action: "Edit draft documents & research notes",
        mp: "Full",
        p: "Full",
        sa: "Full",
        a: "Full",
        j: "Full",
        para: "Restricted",
        adm: "None",
      },
      {
        action: "Direct client communication (WhatsApp/Email)",
        mp: "Full",
        p: "Full",
        sa: "Full",
        a: "Restricted",
        j: "Restricted",
        para: "None",
        adm: "None",
      },
      {
        action: "Approve & sign off filings to Court",
        mp: "Full",
        p: "Full",
        sa: "Restricted",
        a: "None",
        j: "None",
        para: "None",
        adm: "None",
      },
      {
        action: "View matter financial ledger & billing rates",
        mp: "Full",
        p: "Full",
        sa: "Restricted",
        a: "None",
        j: "None",
        para: "None",
        adm: "Full",
      },
      {
        action: "Issue invoices & write off unbilled time",
        mp: "Full",
        p: "Full",
        sa: "None",
        a: "None",
        j: "None",
        para: "None",
        adm: "Restricted",
      },
      {
        action: "Modify AI autonomy policies & escalation rules",
        mp: "Full",
        p: "Full",
        sa: "None",
        a: "None",
        j: "None",
        para: "None",
        adm: "None",
      },
    ];

    sendSuccess(res, { firm, members, escalationRules, accessMatrix }, "Firm settings retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve settings", error);
  }
};

export const updateAIAutonomy = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { aiAutonomy } = req.body;

    // Only ever the caller's own firm. Creating one here would have made a
    // second firm record out of a settings edit.
    const firm = await Firm.findById(firmId);
    if (!firm) {
      sendNotFound(res, "Firm not found");
      return;
    }

    firm.aiAutonomy = { ...firm.aiAutonomy, ...aiAutonomy };
    await firm.save();

    sendSuccess(res, firm.aiAutonomy, "AI autonomy policy updated");
  } catch (error) {
    sendBadRequest(res, "Failed to update autonomy", error);
  }
};

export const getEscalationRules = async (req: Request, res: Response): Promise<void> => {
  try {
    const rules = await EscalationRule.find({ firmId: firmIdOf(req) });
    sendSuccess(res, rules, "Escalation rules retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve escalation rules", error);
  }
};
