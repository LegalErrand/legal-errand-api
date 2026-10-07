import { Request, Response } from "express";
import {
  PaymentGateway,
  PAYMENT_GATEWAYS,
  PAYMENT_MODES,
  PaymentGatewayId,
  IPaymentGateway,
  FirmMember,
} from "../../models/firm";
import { sendSuccess, sendBadRequest, sendNotFound, sendForbidden } from "../../utils/response";
import { firmIdOf, memberIdOf, roleOf } from "../../utils/tenancy";

/**
 * Payment gateway setup (Paystack and Flutterwave).
 *
 * Setup only: no endpoint here charges, refunds, creates a payment link or
 * reads a settlement. See PaymentProvider.ts for why no secret key is stored.
 */

/** Money is a partner's decision, so the same gate as firm-wide integrations. */
const ADMIN_ROLES = ["managing_partner", "admin"];

const canManage = (req: Request): boolean => ADMIN_ROLES.includes(roleOf(req));

const isProvider = (value: string): value is PaymentGatewayId =>
  (PAYMENT_GATEWAYS as readonly string[]).includes(value);

interface ProviderView {
  provider: PaymentGatewayId;
  mode: string;
  publicKey: string;
  currencies: string[];
  isPrimary: boolean;
  enabled: boolean;
  updatedByName: string;
  updatedAt: string;
}

const toView = (row: IPaymentGateway): ProviderView => ({
  provider: row.provider,
  mode: row.mode,
  publicKey: row.publicKey,
  currencies: row.currencies ?? [],
  isPrimary: row.isPrimary,
  enabled: row.enabled,
  updatedByName: row.updatedByName,
  updatedAt: row.updatedAt.toISOString(),
});

/** The caller's name, for the "who last changed this" line on the screen. */
async function nameOf(req: Request): Promise<string> {
  const member = await FirmMember.findById(memberIdOf(req)).select("name").lean();
  return member?.name?.trim() || "Someone";
}

export const getPaymentProviders = async (req: Request, res: Response): Promise<void> => {
  try {
    const rows = await PaymentGateway.find({ firmId: firmIdOf(req) }).sort({ provider: 1 });
    sendSuccess(
      res,
      {
        providers: rows.map(toView),
        // Stated by the server as well as the screen, so an API consumer cannot
        // mistake a configured gateway for a working one.
        liveProcessing: false,
        note: "Gateways can be configured but no payment is taken yet.",
      },
      "Payment providers retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve payment providers", error);
  }
};

export const upsertPaymentProvider = async (req: Request, res: Response): Promise<void> => {
  if (!canManage(req)) {
    sendForbidden(res, "Only a managing partner or admin can change payment settings");
    return;
  }
  try {
    const firmId = firmIdOf(req);
    const provider = String(req.params.provider);
    if (!isProvider(provider)) {
      sendBadRequest(res, "Unknown payment provider");
      return;
    }

    const { mode, publicKey, currencies, enabled, isPrimary } = req.body ?? {};

    if (mode !== undefined && !(PAYMENT_MODES as readonly string[]).includes(mode)) {
      sendBadRequest(res, "Mode must be test or live");
      return;
    }
    if (typeof publicKey !== "string" || !publicKey.trim()) {
      sendBadRequest(res, "A publishable key is required");
      return;
    }
    if (currencies !== undefined) {
      if (!Array.isArray(currencies) || currencies.some((c) => typeof c !== "string")) {
        sendBadRequest(res, "Currencies must be a list of currency codes");
        return;
      }
      if (currencies.length === 0) {
        sendBadRequest(res, "Choose at least one currency");
        return;
      }
    }

    const updatedByName = await nameOf(req);

    const row = await PaymentGateway.findOneAndUpdate(
      { firmId, provider },
      {
        $set: {
          ...(mode !== undefined ? { mode } : {}),
          publicKey: publicKey.trim(),
          ...(currencies !== undefined ? { currencies } : {}),
          ...(typeof enabled === "boolean" ? { enabled } : {}),
          updatedByName,
        },
        $setOnInsert: { firmId, provider },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Primary is exclusive, so it is set after the row exists and the other
    // gateways are cleared in the same request rather than by a second call.
    if (isPrimary === true) {
      await PaymentGateway.updateMany(
        { firmId, _id: { $ne: row._id } },
        { $set: { isPrimary: false } }
      );
      row.isPrimary = true;
      await row.save();
    } else if (isPrimary === false && row.isPrimary) {
      row.isPrimary = false;
      await row.save();
    }

    sendSuccess(res, { provider: toView(row) }, "Payment provider saved");
  } catch (error) {
    sendBadRequest(res, "Failed to save the payment provider", error);
  }
};

export const deletePaymentProvider = async (req: Request, res: Response): Promise<void> => {
  if (!canManage(req)) {
    sendForbidden(res, "Only a managing partner or admin can change payment settings");
    return;
  }
  try {
    const provider = String(req.params.provider);
    if (!isProvider(provider)) {
      sendBadRequest(res, "Unknown payment provider");
      return;
    }
    const removed = await PaymentGateway.findOneAndDelete({ firmId: firmIdOf(req), provider });
    if (!removed) {
      sendNotFound(res, "That gateway is not set up");
      return;
    }
    sendSuccess(res, { provider }, "Payment provider removed");
  } catch (error) {
    sendBadRequest(res, "Failed to remove the payment provider", error);
  }
};
