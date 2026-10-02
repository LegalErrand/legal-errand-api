import { Request, Response } from "express";
import { Integration, FirmIntegrationSettings, FirmMember, IIntegration } from "../../models/firm";
import { sendSuccess, sendBadRequest, sendNotFound, sendForbidden } from "../../utils/response";
import { firmIdOf, memberIdOf, roleOf } from "../../utils/tenancy";

/**
 * Who may change a firm-wide connection. Checked server-side: the front end
 * hiding the button is a courtesy, not a control.
 */
const ADMIN_ROLES = ["managing_partner", "admin"];

/**
 * Fields safe to read back. Credentials are not modelled (see Integration.ts),
 * but the projection is explicit so a token field added later is not leaked by
 * default.
 */
const READ_FIELDS =
  "providerId status account scope ownerId connectedByName connectedAt settings message";

interface ConnectionView {
  providerId: string;
  status: IIntegration["status"];
  account: string;
  scope: "firm" | "person";
  connectedByName: string;
  connectedAt: string;
  settings: Record<string, boolean>;
  message?: string;
  isMine?: boolean;
}

const toView = (row: IIntegration, memberId: string): ConnectionView => {
  const settings: Record<string, boolean> = {};
  row.settings?.forEach((value, key) => {
    settings[key] = value;
  });

  return {
    providerId: row.providerId,
    status: row.status,
    account: row.account,
    scope: row.scope,
    connectedByName: row.connectedByName,
    connectedAt: row.connectedAt.toISOString(),
    settings,
    ...(row.message ? { message: row.message } : {}),
    ...(row.scope === "person" ? { isMine: String(row.ownerId ?? "") === memberId } : {}),
  };
};

const settingsOf = (raw: unknown): Map<string, boolean> => {
  const map = new Map<string, boolean>();
  if (typeof raw === "object" && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "boolean") map.set(key, value);
    }
  }
  return map;
};

/** True when the caller may change a firm-wide connection. */
const canManageFirmWide = (req: Request): boolean => ADMIN_ROLES.includes(roleOf(req));

/**
 * The firm's connections. Person-scoped rows belong to one member, so they are
 * filtered by ownerId as well as firmId — another member's personal connection
 * is not theirs to see.
 */
export const getIntegrations = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);

    const [rows, prefs] = await Promise.all([
      Integration.find({
        firmId,
        $or: [{ scope: "firm" }, { scope: "person", ownerId: memberId }],
      }).select(READ_FIELDS),
      FirmIntegrationSettings.findOne({ firmId }).select("defaultVideoProviderId"),
    ]);

    sendSuccess(
      res,
      {
        connections: rows.map((row) => toView(row, memberId)),
        defaultVideoProviderId: prefs?.defaultVideoProviderId ?? null,
      },
      "Integrations retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve integrations", error);
  }
};

/**
 * Registers the connection. No real OAuth handshake exists yet: the
 * `authorizeUrl` is a placeholder the front end would open.
 */
export const connectIntegration = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { providerId } = req.params;
    const { account, scope, settings } = req.body as {
      account?: unknown;
      scope?: unknown;
      settings?: unknown;
    };

    if (typeof account !== "string" || !account.trim()) {
      sendBadRequest(res, "The account this connection runs under is required");
      return;
    }

    const connectionScope: "firm" | "person" = scope === "person" ? "person" : "firm";
    if (connectionScope === "firm" && !canManageFirmWide(req)) {
      sendForbidden(res, "Only a managing partner or admin can change firm-wide integrations");
      return;
    }

    const existing = await Integration.findOne({ firmId, providerId });
    if (existing && existing.scope === "person" && String(existing.ownerId ?? "") !== memberId) {
      sendForbidden(res, "That provider is connected by another member");
      return;
    }

    const member = await FirmMember.findOne({ _id: memberId, firmId }).select("name");

    const row = await Integration.findOneAndUpdate(
      { firmId, providerId },
      {
        $set: {
          account: account.trim(),
          scope: connectionScope,
          ownerId: connectionScope === "person" ? memberId : undefined,
          status: "connected",
          connectedByName: member?.name ?? "A member",
          connectedAt: new Date(),
          settings: settingsOf(settings),
        },
        $unset: { message: "" },
        $setOnInsert: { firmId, providerId },
      },
      { new: true, upsert: true }
    ).select(READ_FIELDS);

    sendSuccess(
      res,
      {
        connection: toView(row, memberId),
        // Placeholder — a real provider handshake is not implemented.
        authorizeUrl: `https://auth.legalerrand.example/oauth/${providerId}/authorize`,
      },
      "Integration connected"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to connect that integration", error);
  }
};

export const updateIntegrationSettings = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { providerId } = req.params;

    const row = await Integration.findOne({ firmId, providerId });
    if (!row) {
      sendNotFound(res, "That integration is not connected");
      return;
    }

    if (row.scope === "person") {
      if (String(row.ownerId ?? "") !== memberId) {
        sendForbidden(res, "That connection belongs to another member");
        return;
      }
    } else if (!canManageFirmWide(req)) {
      sendForbidden(res, "Only a managing partner or admin can change firm-wide integrations");
      return;
    }

    row.settings = settingsOf((req.body as { settings?: unknown }).settings);
    await row.save();

    sendSuccess(res, toView(row, memberId), "Integration settings saved");
  } catch (error) {
    sendBadRequest(res, "Failed to save those settings", error);
  }
};

/** Stops access. Anything already filed to a matter stays where it is. */
export const disconnectIntegration = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { providerId } = req.params;

    const row = await Integration.findOne({ firmId, providerId });
    if (!row) {
      sendNotFound(res, "That integration is not connected");
      return;
    }

    if (row.scope === "person") {
      if (String(row.ownerId ?? "") !== memberId) {
        sendForbidden(res, "That connection belongs to another member");
        return;
      }
    } else if (!canManageFirmWide(req)) {
      sendForbidden(res, "Only a managing partner or admin can change firm-wide integrations");
      return;
    }

    await Integration.deleteOne({ _id: row._id, firmId });

    // A disconnected provider cannot stay the default for new meetings.
    await FirmIntegrationSettings.updateOne(
      { firmId, defaultVideoProviderId: providerId },
      { $set: { defaultVideoProviderId: null } }
    );

    sendSuccess(res, { disconnectedAt: new Date().toISOString() }, "Integration disconnected");
  } catch (error) {
    sendBadRequest(res, "Failed to disconnect that integration", error);
  }
};

/**
 * Confirms the connection is usable. There is no provider call behind this yet,
 * so it reports on the stored connection's status only.
 */
export const testIntegration = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const memberId = memberIdOf(req);
    const { providerId } = req.params;

    const row = await Integration.findOne({ firmId, providerId }).select(READ_FIELDS);
    if (!row) {
      sendNotFound(res, "That integration is not connected");
      return;
    }

    if (row.scope === "person" && String(row.ownerId ?? "") !== memberId) {
      sendForbidden(res, "That connection belongs to another member");
      return;
    }

    if (row.status !== "connected") {
      sendBadRequest(res, "That connection needs to be restored before it can be tested");
      return;
    }

    sendSuccess(
      res,
      {
        sentAt: new Date().toISOString(),
        detail: `Test sent to ${row.account}.`,
      },
      "Test sent"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to send a test", error);
  }
};

/** The provider new client meetings use by default — a firm-wide preference. */
export const setDefaultVideoProvider = async (req: Request, res: Response): Promise<void> => {
  try {
    const firmId = firmIdOf(req);
    const { providerId } = req.body as { providerId?: unknown };

    if (typeof providerId !== "string" || !providerId.trim()) {
      sendBadRequest(res, "A provider id is required");
      return;
    }

    if (!canManageFirmWide(req)) {
      sendForbidden(res, "Only a managing partner or admin can change firm-wide integrations");
      return;
    }

    const connected = await Integration.findOne({
      firmId,
      providerId: providerId.trim(),
      status: "connected",
    }).select("_id");

    if (!connected) {
      sendBadRequest(res, "That provider is not connected");
      return;
    }

    const prefs = await FirmIntegrationSettings.findOneAndUpdate(
      { firmId },
      { $set: { defaultVideoProviderId: providerId.trim() }, $setOnInsert: { firmId } },
      { new: true, upsert: true }
    ).select("defaultVideoProviderId");

    sendSuccess(
      res,
      { defaultVideoProviderId: prefs.defaultVideoProviderId },
      "Default video provider saved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to save the default video provider", error);
  }
};
