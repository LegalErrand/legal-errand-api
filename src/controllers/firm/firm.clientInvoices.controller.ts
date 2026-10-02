import { Request, Response } from "express";
import { Types } from "mongoose";
import {
  Client,
  ClientInvoice,
  FirmMember,
  FirmTimeEntry,
  Matter,
  recalculateInvoice,
} from "../../models/firm";
import { firmIdOf, memberIdOf, roleOf } from "../../utils/tenancy";
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
} from "../../utils/response";

/** LE-023 — what a firm bills its own clients. */

const PARTNER_ROLES = ["managing_partner", "partner"];

/** LE-003: only a partner writes off, and the managing partner has no cap. */
const WRITE_OFF_CAP_NAIRA = 500_000;

const shape = (inv: {
  _id: unknown;
  reference: string;
  clientId: unknown;
  clientName: string;
  matterId?: unknown;
  matterName?: string;
  lines: { activity: string; hours: number; rateNaira: number; amountNaira: number }[];
  subtotalNaira: number;
  vatNaira: number;
  discountNaira: number;
  totalNaira: number;
  paidNaira: number;
  status: string;
  issuedOn?: Date;
  dueOn?: Date;
  payLink?: string;
  writtenOffNaira?: number;
  writeOffReason?: string;
}) => ({
  id: String(inv._id),
  reference: inv.reference,
  clientId: String(inv.clientId),
  clientName: inv.clientName,
  matterId: inv.matterId ? String(inv.matterId) : undefined,
  matterName: inv.matterName,
  lines: inv.lines,
  subtotalNaira: inv.subtotalNaira,
  vatNaira: inv.vatNaira,
  discountNaira: inv.discountNaira,
  totalNaira: inv.totalNaira,
  paidNaira: inv.paidNaira,
  outstandingNaira: Math.max(0, inv.totalNaira - inv.paidNaira),
  status: inv.status,
  issuedOn: inv.issuedOn,
  dueOn: inv.dueOn,
  payLink: inv.payLink,
  writtenOffNaira: inv.writtenOffNaira,
  writeOffReason: inv.writeOffReason,
});

/** Per-firm sequence, so two firms both numbering from 1 never collide. */
async function nextReference(firmId: string): Promise<string> {
  const count = await ClientInvoice.countDocuments({ firmId });
  return `INV-${String(count + 1).padStart(6, "0")}`;
}

/** GET /firm/billing/client-invoices?status&clientId&matterId */
export const listClientInvoices = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { status, clientId, matterId } = req.query;
    const filter: Record<string, unknown> = { firmId };
    if (status && status !== "all") filter.status = status;
    if (clientId) filter.clientId = String(clientId);
    if (matterId) filter.matterId = String(matterId);

    const rows = await ClientInvoice.find(filter).sort({ createdAt: -1 }).lean();
    const outstanding = rows
      .filter((r) => r.status !== "paid" && r.status !== "draft")
      .reduce((sum, r) => sum + Math.max(0, r.totalNaira - r.paidNaira), 0);

    sendSuccess(
      res,
      {
        invoices: rows.map(shape),
        summary: {
          outstandingNaira: outstanding,
          unpaidCount: rows.filter(
            (r) => r.status === "sent" || r.status === "part_paid" || r.status === "overdue"
          ).length,
          paidThisPeriodNaira: rows
            .filter((r) => r.status === "paid")
            .reduce((sum, r) => sum + r.paidNaira, 0),
        },
      },
      "Invoices retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve invoices", error);
  }
};

/**
 * POST /firm/billing/client-invoices — { matterId, discountNaira?, dueOn? }
 *
 * Built from **approved, billable, unbilled** time on that matter. Time
 * already on an invoice is not billed twice: each entry is stamped with the
 * invoice it went on.
 */
export const createClientInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { matterId, discountNaira, dueOn } = req.body as {
      matterId?: string;
      discountNaira?: number;
      dueOn?: string;
    };

    if (!matterId) {
      sendBadRequest(res, "An invoice is raised against a matter");
      return;
    }

    const matter = await Matter.findOne({ _id: matterId, firmId });
    if (!matter) {
      sendNotFound(res, "That matter is not in this firm");
      return;
    }

    const entries = await FirmTimeEntry.find({
      firmId,
      matterId: matter._id,
      billable: true,
      approved: true,
      invoiceId: { $exists: false },
    });

    if (entries.length === 0) {
      sendBadRequest(res, "There is no approved, unbilled time on that matter yet");
      return;
    }

    const client = matter.clientId ? await Client.findOne({ _id: matter.clientId, firmId }) : null;

    const invoice = new ClientInvoice({
      firmId,
      clientId: client?._id ?? matter.clientId,
      clientName: client?.name ?? matter.clientName ?? "Client",
      matterId: matter._id,
      matterName: matter.name,
      reference: await nextReference(firmId),
      discountNaira: discountNaira ?? 0,
      dueOn: dueOn ? new Date(dueOn) : new Date(Date.now() + 14 * 86_400_000),
      lines: entries.map((e) => ({
        activity: e.activity,
        hours: e.duration,
        rateNaira: e.rate ?? 50_000,
        amountNaira: Math.round(e.duration * (e.rate ?? 50_000)),
        timeEntryIds: [e._id as Types.ObjectId],
      })),
    });

    recalculateInvoice(invoice);
    await invoice.save();

    // Stamp the entries so the same hours cannot be billed onto a second
    // invoice. This is the whole reason the invoice is saved first.
    await FirmTimeEntry.updateMany(
      { _id: { $in: entries.map((e) => e._id) }, firmId },
      { $set: { invoiceId: invoice._id } }
    );

    sendCreated(res, shape(invoice), "Invoice drafted");
  } catch (error) {
    sendBadRequest(res, "Failed to create that invoice", error);
  }
};

/** POST /firm/billing/client-invoices/:id/send — issues it and attaches a pay link. */
export const sendClientInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const invoice = await ClientInvoice.findOne({ _id: String(req.params.id), firmId });
    if (!invoice) {
      sendNotFound(res, "That invoice is not in this firm");
      return;
    }
    if (invoice.status !== "draft") {
      sendBadRequest(res, "That invoice has already been sent");
      return;
    }

    invoice.status = "sent";
    invoice.issuedOn = new Date();
    // Paystack is not wired yet (LE-044). The link is recorded so the portal
    // has something to show, and is replaced by a real one when it is.
    invoice.payLink = `https://pay.legalerrand.example/i/${invoice.reference}`;
    recalculateInvoice(invoice);
    await invoice.save();

    sendSuccess(res, shape(invoice), "Invoice sent to the client");
  } catch (error) {
    sendBadRequest(res, "Failed to send that invoice", error);
  }
};

/**
 * POST /firm/billing/client-invoices/:id/write-off — { amountNaira, reason }
 *
 * LE-003's matrix: only partners write off, and a partner is capped at ₦500k
 * while the managing partner is not. Enforced here, not only on screen.
 */
export const writeOffClientInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const role = roleOf(req);
    const { amountNaira, reason } = req.body as { amountNaira?: number; reason?: string };

    if (!PARTNER_ROLES.includes(role)) {
      sendForbidden(res, "Only a partner can write off a fee");
      return;
    }
    if (!reason?.trim()) {
      sendBadRequest(res, "A write-off needs a reason");
      return;
    }
    if (!amountNaira || amountNaira <= 0) {
      sendBadRequest(res, "A write-off needs an amount");
      return;
    }
    if (role === "partner" && amountNaira > WRITE_OFF_CAP_NAIRA) {
      sendForbidden(res, "A partner can write off up to ₦500,000. Ask the managing partner.");
      return;
    }

    const invoice = await ClientInvoice.findOne({ _id: String(req.params.id), firmId });
    if (!invoice) {
      sendNotFound(res, "That invoice is not in this firm");
      return;
    }

    const member = await FirmMember.findById(memberIdOf(req)).select("name").lean();
    invoice.writtenOffNaira = (invoice.writtenOffNaira ?? 0) + amountNaira;
    invoice.writeOffReason = reason.trim();
    invoice.writtenOffByName = member?.name ?? "A partner";
    recalculateInvoice(invoice);
    await invoice.save();

    sendSuccess(res, shape(invoice), "Written off");
  } catch (error) {
    sendBadRequest(res, "Failed to write that off", error);
  }
};

/**
 * POST /firm/billing/client-invoices/:id/payments — { amountNaira, reference?, method? }
 *
 * Recording a payment re-derives the status, so an invoice becomes part paid
 * or paid without anyone setting it by hand.
 */
export const recordPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { amountNaira, reference, method } = req.body as {
      amountNaira?: number;
      reference?: string;
      method?: string;
    };

    if (!amountNaira || amountNaira <= 0) {
      sendBadRequest(res, "A payment needs an amount");
      return;
    }

    const invoice = await ClientInvoice.findOne({ _id: String(req.params.id), firmId });
    if (!invoice) {
      sendNotFound(res, "That invoice is not in this firm");
      return;
    }
    if (invoice.status === "draft") {
      sendBadRequest(res, "That invoice has not been sent yet");
      return;
    }

    invoice.payments.push({ amountNaira, reference, method, paidAt: new Date() });
    recalculateInvoice(invoice);
    await invoice.save();

    sendCreated(res, shape(invoice), "Payment recorded");
  } catch (error) {
    sendBadRequest(res, "Failed to record that payment", error);
  }
};

/** GET /firm/billing/payments — every payment received, newest first. */
export const listPayments = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const rows = await ClientInvoice.find({ firmId, "payments.0": { $exists: true } })
      .select("reference clientName matterName payments")
      .lean();

    const payments = rows
      .flatMap((inv) =>
        inv.payments.map((p) => ({
          id: String(p._id),
          invoiceId: String(inv._id),
          reference: inv.reference,
          clientName: inv.clientName,
          matterName: inv.matterName,
          amountNaira: p.amountNaira,
          method: p.method ?? "—",
          paymentReference: p.reference,
          paidAt: p.paidAt,
        }))
      )
      .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime());

    sendSuccess(res, payments, "Payments retrieved");
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve payments", error);
  }
};
