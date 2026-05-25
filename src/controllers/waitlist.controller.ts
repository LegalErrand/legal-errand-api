import { Request, Response } from "express";
import { Waitlist } from "../models/Waitlist";
import { logger } from "../utils/logger";

export const joinWaitlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const { firstName, email, universityName, phone, level, country } = req.body;

    // Basic validation
    if (!firstName || !email || !universityName || !phone || !level || !country) {
      res.status(400).json({ success: false, message: "All fields are required" });
      return;
    }

    const newEntry = await Waitlist.create({
      firstName,
      email,
      universityName,
      phone,
      level,
      country,
    });

    res.status(201).json({ success: true, data: newEntry });
  } catch (error: any) {
    // Handle duplicate email
    if (error.code === 11000 && error.keyPattern && error.keyPattern.email) {
      res.status(409).json({ success: false, message: "Email is already on the waitlist" });
      return;
    }
    
    logger.logError("Waitlist signup failed", error);
    res.status(500).json({ success: false, message: "Server error while joining waitlist" });
  }
};
