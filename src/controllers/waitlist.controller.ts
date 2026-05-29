import { Request, Response } from "express";
import { Waitlist } from "../models/Waitlist";
import { sendWaitlistConfirmationEmail } from "../services/email/zoho-mail.service";
import { ApiMessage } from "../utils/api-messages";
import { sendBadRequest, sendCreated, sendError } from "../utils/response";

export const joinWaitlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firstName, email, universityName, phone, level, country } = req.body;

    if (!firstName || !email || !universityName || !phone || !level || !country) {
      sendBadRequest(res, ApiMessage.WAITLIST_FIELDS_REQUIRED);
      return;
    }

    const first = String(firstName).trim();
    const normalizedEmail = String(email).toLowerCase().trim();
    const uni = String(universityName).trim();
    const ph = String(phone).trim();
    const lvl = String(level).trim();
    const ctry = String(country).trim();

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      sendBadRequest(res, ApiMessage.WAITLIST_INVALID_EMAIL);
      return;
    }

    const newEntry = await Waitlist.create({
      firstName: first,
      email: normalizedEmail,
      universityName: uni,
      phone: ph,
      level: lvl,
      country: ctry,
    });

    void sendWaitlistConfirmationEmail(normalizedEmail, first);

    sendCreated(res, newEntry, ApiMessage.WAITLIST_WELCOME);
  } catch (error: unknown) {
    const err = error as { code?: number; keyPattern?: { email?: boolean } };
    if (err.code === 11000 && err.keyPattern?.email) {
      sendError(res, ApiMessage.WAITLIST_EMAIL_EXISTS, 409);
      return;
    }
    sendError(
      res,
      ApiMessage.WAITLIST_SIGNUP_FAILED,
      500,
      error instanceof Error ? error : undefined
    );
  }
};
