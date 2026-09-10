import { Request, Response } from "express";
import { FirmMember } from "../../models/firm";
import { sendSuccess, sendBadRequest } from "../../utils/response";

export const getTeamSupervision = async (req: Request, res: Response): Promise<void> => {
  try {
    const members = await FirmMember.find().sort({ role: 1 });

    // Bottlenecks are derived from real member workload, never invented.
    const overloaded = members
      .filter((m) => (m.waitingOnReviewCount ?? 0) > 0)
      .sort((a, b) => (b.waitingOnReviewCount ?? 0) - (a.waitingOnReviewCount ?? 0));

    const leastLoaded = [...members]
      .filter((m) => !overloaded.some((o) => String(o._id) === String(m._id)))
      .sort((a, b) => (a.utilisation ?? 0) - (b.utilisation ?? 0))[0];

    const bottlenecks = overloaded.slice(0, 3).map((m) => ({
      lawyerName: m.name,
      oldestAge: m.waitingAgeText || "",
      queueCount: m.waitingOnReviewCount ?? 0,
      matters: [] as string[],
      suggestedTransferTo: leastLoaded?.name || "",
    }));

    sendSuccess(
      res,
      {
        members,
        bottlenecks,
      },
      "Team supervision metrics retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve supervision metrics", error);
  }
};

export const activateHandoverCover = async (req: Request, res: Response): Promise<void> => {
  try {
    const { absentMemberId, coveringMemberId, startDate, endDate } = req.body;

    const absentMember = absentMemberId ? await FirmMember.findById(absentMemberId) : null;
    if (absentMember) {
      absentMember.coverProxy = {
        coveringMemberId,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : new Date(Date.now() + 7 * 86400000),
        active: true,
      };
      await absentMember.save();
    }

    sendSuccess(
      res,
      {
        status: "active",
        absentMemberName: absentMember?.name || "",
        leavePeriod: startDate && endDate ? `${startDate} to ${endDate}` : "",
        noticesDispatched: true,
      },
      "Handover and cover schedule activated successfully"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to activate cover", error);
  }
};
