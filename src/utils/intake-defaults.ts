import {
  IntakeFormContent,
  IntakeStep,
  PracticeAreaQuestions,
} from "../models/firm/IntakeFormSchema";

// Mirror of legalerrand-firm-app's src/lib/intake-form.ts defaults. A firm with
// no form yet is seeded from this, so the editor opens on a working form rather
// than an empty one.

export const PRACTICE_AREA_OPTIONS: string[] = [
  "Probate & Estate",
  "Litigation",
  "Corporate & Commercial",
  "Family",
  "Employment",
  "Property",
  "Other",
];

export const DEFAULT_PRACTICE_AREA_QUESTIONS: PracticeAreaQuestions[] = [
  {
    area: "Probate & Estate",
    questions: [
      { id: "pe_who", label: "Who has passed away?", type: "short", required: true },
      {
        id: "pe_relationship",
        label: "Your relationship to them",
        type: "choice",
        options: ["Child", "Spouse", "Sibling", "Other relative", "Executor"],
        required: true,
      },
      {
        id: "pe_will",
        label: "Is there a will?",
        type: "choice",
        options: ["Yes, I have it", "Someone else has it", "No", "Not sure"],
      },
      { id: "pe_dispute", label: "Is anyone disputing the estate?", type: "yesno" },
      { id: "pe_estate", label: "What does the estate include?", type: "paragraph" },
    ],
  },
  {
    area: "Litigation",
    questions: [
      { id: "li_other_side", label: "Who is the other side?", type: "short", required: true },
      { id: "li_amount", label: "Roughly how much is in dispute?", type: "short" },
      { id: "li_filed", label: "Has a case been filed?", type: "yesno" },
      { id: "li_what", label: "What happened?", type: "paragraph", required: true },
    ],
  },
  {
    area: "Corporate & Commercial",
    questions: [
      { id: "cc_company", label: "Company name", type: "short", required: true },
      { id: "cc_need", label: "What do you need help with?", type: "paragraph", required: true },
      { id: "cc_counterparty", label: "Who is the counterparty?", type: "short" },
      { id: "cc_deadline", label: "Is there a deadline?", type: "date" },
    ],
  },
  {
    area: "Family",
    questions: [
      {
        id: "fa_concern",
        label: "What does this concern?",
        type: "choice",
        options: ["Divorce", "Child custody", "Maintenance", "Something else"],
        required: true,
      },
      { id: "fa_children", label: "Are children involved?", type: "yesno" },
      { id: "fa_filed", label: "Has anything been filed in court?", type: "yesno" },
      {
        id: "fa_risk",
        label: "Is anyone at risk of harm?",
        type: "choice",
        options: ["Yes", "No", "Not sure"],
        urgentWhen: "Yes",
        required: true,
      },
    ],
  },
  {
    area: "Employment",
    questions: [
      { id: "em_role", label: "Your role", type: "short", required: true },
      { id: "em_employer", label: "Your employer", type: "short", required: true },
      { id: "em_ended", label: "Has your employment ended?", type: "yesno" },
      { id: "em_when", label: "When did it happen?", type: "date" },
      { id: "em_reason", label: "What reason were you given?", type: "paragraph" },
    ],
  },
  {
    area: "Property",
    questions: [
      { id: "pr_kind", label: "What kind of property?", type: "short", required: true },
      { id: "pr_where", label: "Where is it?", type: "short", required: true },
      { id: "pr_issue", label: "What is the issue?", type: "paragraph", required: true },
      { id: "pr_docs", label: "What documents do you hold?", type: "paragraph" },
    ],
  },
  {
    area: "Other",
    questions: [
      { id: "ot_what", label: "Tell us what is going on", type: "paragraph", required: true },
    ],
  },
];

export const DEFAULT_INTAKE_STEPS: IntakeStep[] = [
  {
    step: 1,
    title: "Tell us how we can help",
    intro: "About four minutes; stop and come back any time.",
    questions: [
      { id: "full_name", label: "Your full name", type: "short", required: true },
      { id: "phone", label: "Phone number", type: "short", required: true },
      { id: "email", label: "Email address", type: "short" },
      {
        id: "contact_pref",
        label: "How should we contact you?",
        type: "choice",
        options: ["WhatsApp", "Phone call", "Email"],
      },
      { id: "location", label: "Where are you based?", type: "short" },
    ],
  },
  {
    step: 2,
    title: "About your legal matter",
    questions: [
      {
        id: "practice_area",
        label: "What do you need help with?",
        type: "choice",
        options: PRACTICE_AREA_OPTIONS,
        required: true,
      },
      { id: "one_line", label: "In one line, what is happening?", type: "short", required: true },
    ],
  },
  {
    step: 3,
    title: "A little more context",
    questions: [
      {
        id: "urgency",
        label: "How urgent is this?",
        type: "choice",
        options: ["There is a deadline", "Urgent but no fixed date", "Not urgent"],
        urgentWhen: "There is a deadline",
        required: true,
      },
      {
        id: "source",
        label: "How did you hear about us?",
        type: "choice",
        options: ["A referral", "Found you online", "Used you before", "LegalErrand", "Other"],
      },
      { id: "anything_else", label: "Anything else we should know?", type: "paragraph" },
    ],
  },
  {
    step: 4,
    title: "Any documents?",
    intro: "Nothing here is required.",
    questions: [
      {
        id: "documents",
        label: "Add a photo or a file",
        type: "file",
        hint: "Court papers, agreements, receipts, ID.",
      },
    ],
  },
  {
    step: 5,
    title: "Check your answers",
    intro: "Nothing has been sent yet.",
    questions: [],
  },
];

export function defaultConsentText(firmName: string): string {
  return `I agree that ${firmName} may contact me about this enquiry and hold the information I have given. Sending this does not create a lawyer–client relationship until the firm accepts the matter.`;
}

/** The seed form. `firmName` names the firm in the consent wording. */
export function defaultIntakeForm(firmName?: string): IntakeFormContent {
  return {
    firmName,
    steps: DEFAULT_INTAKE_STEPS,
    practiceAreas: DEFAULT_PRACTICE_AREA_QUESTIONS,
    consentText: defaultConsentText(firmName ?? "the firm"),
  };
}
