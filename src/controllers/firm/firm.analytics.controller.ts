import { Request, Response } from "express";
import { Matter, FirmMember, FirmTask } from "../../models/firm";
import { sendSuccess, sendBadRequest } from "../../utils/response";

export const getAnalytics = async (req: Request, res: Response): Promise<void> => {
  try {
    const totalMatters = await Matter.countDocuments();
    const atRiskMatters = await Matter.find({
      health: { $in: ["at_risk", "blocked", "awaiting_client"] },
    })
      .limit(3)
      .select("name lawyerName health stage stageProgress");

    const feeEarners = await FirmMember.find().select("name role utilisation onTimeRate");

    const practiceBreakdown = [
      { area: "Corporate & Commercial", amount: 11400000, percentage: 46 },
      { area: "Civil Litigation", amount: 8200000, percentage: 33 },
      { area: "Probate & Estate", amount: 3150000, percentage: 13 },
      { area: "Family Law", amount: 2100000, percentage: 8 },
    ];

    sendSuccess(
      res,
      {
        kpis: {
          revenueCollected: 24850000,
          billableHours: 412.5,
          activeMatters: totalMatters || 38,
          overdueTasks: await FirmTask.countDocuments({ status: "overdue" }),
          avgClientResponseHours: 1.4,
        },
        practiceBreakdown,
        utilisationList: feeEarners.map((f) => ({
          name: f.name,
          role: f.role,
          utilisation: f.utilisation ?? 0,
          isOverloaded: (f.utilisation || 0) > 85,
        })),
        mattersNeedingAttention: atRiskMatters,
      },
      "Firm analytics retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve analytics", error);
  }
};
