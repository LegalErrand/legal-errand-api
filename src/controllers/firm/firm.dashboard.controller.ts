import { Request, Response } from "express";
import { Matter, FirmTask, CalendarEvent, AIApprovalAction } from "../../models/firm";
import { sendSuccess, sendBadRequest } from "../../utils/response";

interface Priority {
  label: string;
  action: string;
  urgency: "red" | "amber" | "green";
}

export const getDashboardSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    // CalendarEvent.date is stored as an ISO `YYYY-MM-DD` string, so compare as strings.
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const now = new Date();
    const todayStr = iso(now);
    const weekAheadStr = iso(new Date(now.getTime() + 7 * 86400000));

    const totalMatters = await Matter.countDocuments();
    const urgentMatters = await Matter.countDocuments({ health: { $in: ["at_risk", "blocked"] } });
    const overdueTasks = await FirmTask.countDocuments({
      status: { $in: ["overdue", "escalated"] },
    });
    const openTasks = await FirmTask.countDocuments({
      status: { $in: ["not_started", "in_progress"] },
    });

    const deadlinesThisWeek = await CalendarEvent.countDocuments({
      date: { $gte: todayStr, $lte: weekAheadStr },
    });

    const recentMatters = await Matter.find()
      .sort({ updatedAt: -1 })
      .limit(4)
      .select("name stage health stageProgress nextDeadline lawyerName");

    const todayEvents = await CalendarEvent.find({ date: todayStr }).sort({ time: 1 });

    const pendingAI = await AIApprovalAction.find({ status: "pending" })
      .sort({ confidence: -1 })
      .limit(3);

    // Priorities are derived from real records — never invented.
    const priorities: Priority[] = [];

    const atRiskMatters = await Matter.find({ health: { $in: ["at_risk", "blocked"] } })
      .sort({ updatedAt: -1 })
      .limit(3)
      .select("name healthNote health");

    for (const m of atRiskMatters) {
      priorities.push({
        label: `${m.healthNote || m.health.replace(/_/g, " ")} — ${m.name}`,
        action: "Open",
        urgency: m.health === "blocked" ? "red" : "amber",
      });
    }

    const overdue = await FirmTask.find({ status: { $in: ["overdue", "escalated"] } })
      .sort({ dueDate: 1 })
      .limit(3)
      .select("title status");

    for (const t of overdue) {
      priorities.push({
        label: `${t.status === "escalated" ? "Escalated" : "Overdue"} — ${t.title}`,
        action: "Review",
        urgency: "red",
      });
    }

    if (pendingAI.length > 0) {
      priorities.push({
        label: `${pendingAI.length} AI action${pendingAI.length === 1 ? "" : "s"} awaiting approval`,
        action: "Review",
        urgency: "amber",
      });
    }

    sendSuccess(
      res,
      {
        metrics: {
          urgentCount: urgentMatters,
          deadlinesThisWeek,
          openTasksCount: openTasks,
          overdueCount: overdueTasks,
          totalMatters,
        },
        aiPriorities: priorities.slice(0, 5),
        todaySchedule: todayEvents.map((e) => ({
          id: e._id,
          time: e.time || "All day",
          event: `${e.title}${e.location ? `, ${e.location}` : ""}`,
        })),
        recentMatters,
        pendingAICount: pendingAI.length,
      },
      "Dashboard summary retrieved"
    );
  } catch (error) {
    sendBadRequest(res, "Failed to retrieve dashboard summary", error);
  }
};
