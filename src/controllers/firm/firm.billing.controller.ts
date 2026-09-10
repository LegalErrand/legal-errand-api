import { Request, Response } from "express";
import { FirmTimeEntry, Matter } from "../../models/firm";
import { sendSuccess, sendCreated, sendBadRequest, sendNotFound } from "../../utils/response";

export const getTimeEntries = async (req: Request, res: Response): Promise<void> => {
  try {
    const { matterId, billable, approved } = req.query;
    const filter: Record<string, unknown> = {};

    if (matterId) filter.matterId = matterId;
    if (billable !== undefined) filter.billable = billable === "true";
    if (approved !== undefined) filter.approved = approved === "true";

    const entries = await FirmTimeEntry.find(filter).sort({ createdAt: -1 });

    const totalBillableHours = entries
      .filter((e) => e.billable)
      .reduce((sum, e) => sum + e.duration, 0);

    const unapprovedCount = entries.filter((e) => !e.approved).length;

    sendSuccess(
      res,
      {
        entries,
        summary: {
          totalBillableHours,
          unapprovedCount,
          estimatedUnbilledNaira: Math.round(totalBillableHours * 50000),
        },
      },
      "Time entries retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve time entries", error);
  }
};

export const approveTimeEntry = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { billable, duration } = req.body;

    const entry = await FirmTimeEntry.findById(id);
    if (!entry) {
      sendNotFound(res, "Time entry not found");
      return;
    }

    entry.approved = true;
    if (billable !== undefined) entry.billable = billable;
    if (duration !== undefined) entry.duration = Number(duration);
    await entry.save();

    sendSuccess(res, entry, "Time entry approved");
  } catch (error) {
    sendBadRequest(res, "Failed to approve time entry", error);
  }
};

export const generateInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { matterId, clientName, discount } = req.body;

    const matter = matterId ? await Matter.findById(matterId) : null;
    const entries = matterId
      ? await FirmTimeEntry.find({ matterId, billable: true })
      : await FirmTimeEntry.find({ billable: true }).limit(5);

    const subtotal = entries.reduce((sum, e) => sum + e.duration * (e.rate || 50000), 0);
    const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;

    const invoice = {
      invoiceNumber,
      clientName: clientName || matter?.clientName || "Client",
      matterName: matter?.name || "General Legal Counsel",
      date: new Date().toISOString().split("T")[0],
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0],
      lineItems: entries.map((e) => ({
        activity: e.activity,
        hours: e.duration,
        rate: e.rate || 50000,
        amount: e.duration * (e.rate || 50000),
      })),
      subtotal,
      discount: discount || 0,
      total: Math.max(0, subtotal - (discount || 0)),
      status: "draft",
    };

    sendCreated(res, invoice, "Matter invoice drafted successfully");
  } catch (error) {
    sendBadRequest(res, "Failed to generate invoice", error);
  }
};
