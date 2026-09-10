/**
 * Seed script for LegalErrand Law Firm Platform.
 * Populates MongoDB with the baseline firm dataset.
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/seedFirmData.ts
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { Firm, FirmMember, Client, Matter, ReviewQueueItem, EscalationRule } from "../models/firm";

function loadEnv(): void {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

async function seedFirm(): Promise<void> {
  loadEnv();
  const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/legalerrand";

  console.log(`Connecting to MongoDB at ${mongoUri.replace(/:[^:@]+@/, ":****@")}...`);
  await mongoose.connect(mongoUri);

  console.log("Seeding Law Firm platform data...");

  // 1. Firm
  let firm = await Firm.findOne({ contactEmail: "admin@oladipupoco.ng" });
  if (!firm) {
    firm = await Firm.create({
      name: "Odebiyi Oladipupo & Co.",
      jurisdiction: "Nigeria (Lagos State High Court)",
      courtFilingPortalId: "NBA/LAG/2014/0981",
      contactEmail: "admin@oladipupoco.ng",
      address: "14 Marina Road, Lagos Island, Lagos",
      subscriptionPlan: "enterprise",
      feeEarnerCapacity: 15,
      aiAutonomy: {
        intakeExtraction: "auto",
        documentDrafting: "partner",
        clientMessaging: "review",
        billingInvoicing: "partner",
      },
      notificationTiers: {
        criticalChannels: ["Push", "SMS", "WhatsApp"],
        attentionChannels: ["Push", "In-app"],
        completedChannels: ["In-app"],
      },
    });
    console.log(`Created Firm: ${firm.name}`);
  }

  // 2. Firm Members
  const membersData = [
    {
      name: "Odebiyi Oladipupo",
      initials: "OL",
      role: "managing_partner" as const,
      email: "odebiyi@oladipupoco.ng",
      mattersCount: 23,
      openMattersText: "23 matters · 78%",
      utilisation: 78,
      onTimeRate: 95,
      reworkRoundsAvg: 0.6,
      waitingOnReviewCount: 1,
      waitingAgeText: "1 item",
      supervision: "standard" as const,
    },
    {
      name: "Attorney Smith",
      initials: "AS",
      role: "senior_associate" as const,
      email: "smith@oladipupoco.ng",
      mattersCount: 31,
      openMattersText: "31 matters · 91%",
      utilisation: 91,
      onTimeRate: 84,
      reworkRoundsAvg: 0.8,
      waitingOnReviewCount: 6,
      waitingAgeText: "6 items · oldest 4 days",
      supervision: "standard" as const,
    },
    {
      name: "Tunde Okoro",
      initials: "TO",
      role: "associate" as const,
      email: "tunde@oladipupoco.ng",
      mattersCount: 12,
      openMattersText: "12 matters · 78%",
      utilisation: 78,
      onTimeRate: 95,
      reworkRoundsAvg: 0.6,
      waitingOnReviewCount: 1,
      supervision: "light" as const,
    },
    {
      name: "Kunle Adebayo",
      initials: "KA",
      role: "junior_associate" as const,
      email: "kunle@oladipupoco.ng",
      mattersCount: 3,
      openMattersText: "3 tasks · 68%",
      utilisation: 68,
      onTimeRate: 100,
      reworkRoundsAvg: 1.0,
      waitingOnReviewCount: 0,
      supervision: "standard" as const,
    },
    {
      name: "Ngozi Ibe",
      initials: "NI",
      role: "junior_associate" as const,
      email: "ngozi@oladipupoco.ng",
      mattersCount: 5,
      openMattersText: "5 tasks · 88%",
      utilisation: 88,
      onTimeRate: 60,
      reworkRoundsAvg: 2.4,
      waitingOnReviewCount: 0,
      supervision: "close" as const,
    },
    {
      name: "Sarah Eze",
      initials: "SE",
      role: "paralegal" as const,
      email: "sarah@oladipupoco.ng",
      mattersCount: 18,
      openMattersText: "18 matters · 82%",
      utilisation: 82,
      onTimeRate: 97,
      reworkRoundsAvg: 0.3,
      waitingOnReviewCount: 0,
      supervision: "standard" as const,
    },
    {
      name: "Kemi Alade",
      initials: "KE",
      role: "admin" as const,
      email: "kemi@oladipupoco.ng",
      mattersCount: 0,
      utilisation: 50,
      onTimeRate: 100,
      reworkRoundsAvg: 0,
      waitingOnReviewCount: 0,
      supervision: "standard" as const,
    },
  ];

  for (const m of membersData) {
    await FirmMember.findOneAndUpdate(
      { firmId: firm._id, email: m.email },
      { ...m, firmId: firm._id },
      { upsert: true, new: true }
    );
  }
  console.log(`Seeded ${membersData.length} team members`);

  // 3. Clients
  const clientsData = [
    {
      name: "Amaka Adeyemi",
      type: "Individual" as const,
      status: "lead" as const,
      practiceArea: "Probate",
      mattersCount: 0,
      lastContactText: "24 min ago",
      urgencyNote: "Lead · needs review",
    },
    {
      name: "John Doe",
      type: "Individual" as const,
      status: "active" as const,
      practiceArea: "Litigation",
      mattersCount: 1,
      lawyerName: "Attorney Smith",
      lastContactText: "Today",
    },
    {
      name: "Okafor Holdings Ltd",
      type: "Company" as const,
      status: "active" as const,
      practiceArea: "Corporate",
      mattersCount: 3,
      lawyerName: "Attorney Oladipupo",
      lastContactText: "Yesterday",
    },
    {
      name: "Lagos Logistics Company",
      type: "Company" as const,
      status: "active" as const,
      practiceArea: "Corporate",
      mattersCount: 1,
      lawyerName: "Attorney Oladipupo",
      lastContactText: "2 days ago",
    },
    {
      name: "Ngozi Bello",
      type: "Individual" as const,
      status: "at_risk" as const,
      practiceArea: "Family",
      mattersCount: 1,
      lawyerName: "Attorney Smith",
      lastContactText: "14 days ago",
      urgencyNote: "At risk · no reply 14 days",
    },
    {
      name: "Chidi Umeh",
      type: "Individual" as const,
      status: "archived" as const,
      practiceArea: "Litigation",
      mattersCount: 2,
      lastContactText: "Mar 2026",
    },
  ];

  const clientDocs: Record<string, mongoose.Types.ObjectId> = {};
  for (const c of clientsData) {
    const saved = await Client.findOneAndUpdate(
      { firmId: firm._id, name: c.name },
      { ...c, firmId: firm._id },
      { upsert: true, new: true }
    );
    clientDocs[c.name] = saved._id;
  }
  console.log(`Seeded ${clientsData.length} clients`);

  // 4. Matters
  const mattersData = [
    {
      name: "Doe vs ABC Corporation",
      clientName: "John Doe",
      clientId: clientDocs["John Doe"],
      type: "Civil litigation",
      stage: "Discovery" as const,
      stageProgress: 62,
      nextDeadline: "Sept 12 · 6 days",
      lawyerName: "Smith",
      health: "at_risk" as const,
      healthNote: "Witness statement missing",
      urgentItems: ["Witness statement missing", "Discovery deadline: Sept 12", "Motion filed"],
      nextActions: [
        { label: "Review witness statement", date: "Sept 9" },
        { label: "Prepare discovery response", date: "Sept 10" },
        { label: "Schedule client meeting", date: "Sept 11" },
      ],
      aiSummary:
        "Motion to compel was filed Aug 28. Opposing counsel responded Sept 3. Discovery closes Sept 12 and the witness statement from Mrs. Okoro is still outstanding — this is the main risk to the hearing date.",
      recentActivity: [
        { time: "12:45 PM", actor: "Partner", description: "reviewed", docName: "Motion.pdf" },
        { time: "11:20 AM", actor: "Client", description: "uploaded evidence.zip" },
        {
          time: "10:05 AM",
          actor: "AI",
          isAI: true,
          description: "created 3 tasks from opposing filing",
        },
      ],
    },
    {
      name: "Okafor Holdings share transfer",
      clientName: "Okafor Holdings Ltd",
      clientId: clientDocs["Okafor Holdings Ltd"],
      type: "Corporate",
      stage: "Filing" as const,
      stageProgress: 40,
      nextDeadline: "Sept 20",
      lawyerName: "Oladipupo",
      health: "on_track" as const,
      healthNote: "On track",
    },
    {
      name: "Adeyemi estate",
      clientName: "Amaka Adeyemi",
      clientId: clientDocs["Amaka Adeyemi"],
      type: "Probate",
      stage: "Intake" as const,
      stageProgress: 10,
      lawyerName: "Unassigned",
      health: "awaiting_client" as const,
      healthNote: "Awaiting acceptance",
    },
    {
      name: "Bello custody",
      clientName: "Ngozi Bello",
      clientId: clientDocs["Ngozi Bello"],
      type: "Family",
      stage: "Filing" as const,
      stageProgress: 30,
      nextDeadline: "Sept 15",
      lawyerName: "Smith",
      health: "blocked" as const,
      healthNote: "Client unresponsive",
    },
    {
      name: "Lagos Logistics SLA",
      clientName: "Lagos Logistics Company",
      clientId: clientDocs["Lagos Logistics Company"],
      type: "Corporate",
      stage: "Review" as const,
      stageProgress: 85,
      nextDeadline: "Sept 30",
      lawyerName: "Oladipupo",
      health: "on_track" as const,
      healthNote: "On track",
    },
  ];

  const matterDocs: Record<string, mongoose.Types.ObjectId> = {};
  for (const m of mattersData) {
    const saved = await Matter.findOneAndUpdate(
      { firmId: firm._id, name: m.name },
      { ...m, firmId: firm._id },
      { upsert: true, new: true }
    );
    matterDocs[m.name] = saved._id;
  }
  console.log(`Seeded ${mattersData.length} matters`);

  // 5. Review Queue Items
  const reviewItems = [
    {
      type: "filing" as const,
      title: "Doe vs ABC Corp",
      matter: "Doe vs ABC Corp",
      description: "Discovery response · draft v2",
      preparedBy: "Kunle Adebayo",
      reviewedBy: "Attorney Smith (reviewed, 4 comments resolved)",
      nextStep: "You",
      chain: ["Junior", "AI check", "Senior", "Partner", "Court"],
      deadline: "Sept 12",
    },
    {
      type: "client_advice" as const,
      title: "Okafor Holdings share transfer",
      matter: "Okafor Holdings share transfer",
      description: "Opinion letter on tax treatment",
      preparedBy: "Tunde Okoro",
      nextStep: "You",
      chain: ["Associate", "AI check", "Partner", "Client"],
      deadline: "Friday",
      skippedStep: "light supervision",
    },
    {
      type: "money" as const,
      title: "Bello custody",
      matter: "Bello custody",
      description: "Write off ₦180,000 of unbilled time — client unresponsive",
      preparedBy: "Attorney Smith",
      nextStep: "You",
      chain: ["Lawyer", "Partner", "Ledger"],
      amount: "₦180,000",
    },
    {
      type: "conflict_waiver" as const,
      title: "New lead · Chukwudi Adeyemi",
      matter: "Chukwudi Adeyemi lead",
      description: "Brother of existing client Amaka Adeyemi — opposing party in her estate matter",
      preparedBy: "AI",
      nextStep: "You",
      chain: ["AI", "Partner", "Decline / waive"],
    },
    {
      type: "ai_generated" as const,
      title: "Adeyemi estate",
      matter: "Adeyemi estate",
      description: "Retainer agreement — AI draft v1, 2 amber findings fixed",
      preparedBy: "AI",
      reviewedBy: "Attorney Smith (approved)",
      nextStep: "You",
      chain: ["AI", "Senior", "Partner", "E-sign"],
    },
  ];

  for (const r of reviewItems) {
    await ReviewQueueItem.findOneAndUpdate(
      { firmId: firm._id, title: r.title },
      { ...r, firmId: firm._id },
      { upsert: true, new: true }
    );
  }
  console.log(`Seeded ${reviewItems.length} review queue items`);

  // 6. Escalation Rules
  const escalationRules = [
    {
      trigger: "Court deadline in 48 h and work not in review",
      goesTo: "Responsible senior",
      ifNoActionWithin: "4 h",
      then: "Partner",
      channel: "Push · SMS",
    },
    {
      trigger: "Conflict detected at intake",
      goesTo: "Partner",
      ifNoActionWithin: "1 working day",
      then: "Managing partner",
      channel: "Push · email",
    },
    {
      trigger: "Client complaint or threat of complaint",
      goesTo: "Partner + responsible lawyer",
      ifNoActionWithin: "2 h",
      then: "Managing partner",
      channel: "Push · SMS · call",
    },
    {
      trigger: "Write-off or discount above ₦500k",
      goesTo: "Managing partner",
      ifNoActionWithin: "3 working days",
      then: "Reminder only",
      channel: "In-app · email",
    },
    {
      trigger: "Junior asks question in internal chat, unanswered",
      goesTo: "Supervising senior",
      ifNoActionWithin: "1 working day",
      then: "Partner",
      channel: "In-app",
    },
    {
      trigger: "Review waiting on a senior",
      goesTo: "That senior",
      ifNoActionWithin: "2 working days",
      then: "Partner offered to reassign",
      channel: "In-app · push",
    },
    {
      trigger: "Client unresponsive with a deadline pending",
      goesTo: "Responsible lawyer",
      ifNoActionWithin: "3 days",
      then: "Partner · consider withdrawal",
      channel: "In-app",
    },
  ];

  for (const er of escalationRules) {
    await EscalationRule.findOneAndUpdate(
      { firmId: firm._id, trigger: er.trigger },
      { ...er, firmId: firm._id },
      { upsert: true, new: true }
    );
  }
  console.log(`Seeded ${escalationRules.length} escalation rules`);

  console.log("Firm platform database seeded successfully!");
  await mongoose.disconnect();
}

seedFirm().catch((err) => {
  console.error("Failed to seed firm data:", err);
  process.exit(1);
});
