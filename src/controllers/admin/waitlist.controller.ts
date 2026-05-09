import { Response } from "express";
import { AdminRequest } from "../../types";
import { Waitlist } from "../../models/Waitlist";
import { sendSuccess, sendNotFound, sendError } from "../../utils/response";

export const listWaitlist = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const { page = "1", limit = "20", search, country, level } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);

    const filter: Record<string, unknown> = {};
    if (country) filter.country = { $regex: country, $options: "i" };
    if (level) filter.level = { $regex: level, $options: "i" };
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { universityName: { $regex: search, $options: "i" } },
      ];
    }

    const [entries, total] = await Promise.all([
      Waitlist.find(filter).skip(skip).limit(parseInt(limit as string)).sort({ createdAt: -1 }),
      Waitlist.countDocuments(filter),
    ]);

    sendSuccess(res, entries, "Waitlist retrieved", 200, {
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total,
      totalPages: Math.ceil(total / parseInt(limit as string)),
    });
  } catch (err) {
    sendError(res, "Failed to retrieve waitlist", 500, (err as Error).message);
  }
};

export const getWaitlistStats = async (_req: AdminRequest, res: Response): Promise<void> => {
  try {
    const [total, byCountry, byLevel, byUniversity, dailySignups] = await Promise.all([
      Waitlist.countDocuments(),
      Waitlist.aggregate([
        { $group: { _id: "$country", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Waitlist.aggregate([
        { $group: { _id: "$level", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Waitlist.aggregate([
        { $group: { _id: "$universityName", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      Waitlist.aggregate([
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: -1 } },
        { $limit: 30 },
        { $project: { date: "$_id", count: 1, _id: 0 } },
      ]),
    ]);

    sendSuccess(res, { total, byCountry, byLevel, byUniversity, dailySignups }, "Waitlist stats retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve waitlist stats", 500, (err as Error).message);
  }
};

export const getWaitlistEntry = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const entry = await Waitlist.findById(req.params.id);
    if (!entry) {
      sendNotFound(res, "Waitlist entry not found");
      return;
    }
    sendSuccess(res, entry, "Entry retrieved");
  } catch (err) {
    sendError(res, "Failed to retrieve entry", 500, (err as Error).message);
  }
};

export const deleteWaitlistEntry = async (req: AdminRequest, res: Response): Promise<void> => {
  try {
    const entry = await Waitlist.findByIdAndDelete(req.params.id);
    if (!entry) {
      sendNotFound(res, "Waitlist entry not found");
      return;
    }
    sendSuccess(res, null, "Waitlist entry removed");
  } catch (err) {
    sendError(res, "Failed to remove entry", 500, (err as Error).message);
  }
};
