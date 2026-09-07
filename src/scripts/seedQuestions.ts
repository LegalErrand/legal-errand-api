/**
 * Seed the reasoning/quiz question bank with Nigerian law practice questions.
 *
 * Usage:
 *   DEV_MONGO_URI=... PROD_MONGO_URI=... npx ts-node --transpile-only src/scripts/seedQuestions.ts
 *   Or rely on .env.staging / .env.production MONGO_URI (seeds both when available).
 *
 * Idempotent: skips prompts that already exist (exact match).
 */
import fs from "fs";
import path from "path";
import mongoose from "mongoose";

type SeedQuestion = {
  type: "hypothetical" | "issue_spotting" | "application";
  subject: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  prompt: string;
  modelAnswer: string;
  gradingNotes: string;
  tags: string[];
};

function loadEnvFile(fileName: string): Record<string, string> {
  const filePath = path.resolve(__dirname, "../..", fileName);
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const QUESTIONS: SeedQuestion[] = [
  {
    type: "hypothetical",
    subject: "Contract Law",
    difficulty: "beginner",
    prompt:
      "Ada offers to sell her laptop to Ben for ₦150,000. Ben replies: 'I will buy it for ₦120,000.' Ada says nothing. Two days later Ben says he accepts the original ₦150,000 price. Advise Ada whether a contract has been formed.",
    modelAnswer:
      "Ben's counter-offer of ₦120,000 destroyed Ada's original offer (Hyde v Wrench). His later 'acceptance' of ₦150,000 is a fresh offer which Ada may accept or reject. No contract arises unless Ada accepts that new offer.",
    gradingNotes:
      "Look for counter-offer extinguishing original offer; distinction between acceptance and fresh offer; cite Hyde v Wrench or Nigerian equivalent reasoning.",
    tags: ["offer", "acceptance", "counter-offer"],
  },
  {
    type: "application",
    subject: "Contract Law",
    difficulty: "intermediate",
    prompt:
      "Chidi promises to pay Dayo ₦50,000 if Dayo completes work Chidi is already contractually bound to perform for a third party. Dayo finishes the work and claims the money. Is there valid consideration?",
    modelAnswer:
      "Performance of an existing contractual duty owed to a third party can be good consideration for a fresh promise (The Eurymedon / New Zealand Shipping). Dayo provides consideration by performing; Chidi's promise is enforceable unless other vitiating factors apply.",
    gradingNotes:
      "Identify existing duty doctrine variants; contrast duty to same promisee (Stilk) vs third party; apply to facts.",
    tags: ["consideration", "existing-duty"],
  },
  {
    type: "issue_spotting",
    subject: "Contract Law",
    difficulty: "advanced",
    prompt:
      "Identify the contractual issues in: a builder quotes a fixed price, later demands more after discovering harder ground conditions that a competent survey would have revealed before contract.",
    modelAnswer:
      "Issues include: formation (fixed-price allocation of risk), variation/consideration for extra payment, possible economic duress, misrepresentation/non-disclosure of site conditions, and frustration (unlikely where risk was foreseeable/assumable).",
    gradingNotes: "Credit issue-spotting over long essays; list issues with brief rule hooks.",
    tags: ["variation", "duress", "frustration", "risk"],
  },
  {
    type: "hypothetical",
    subject: "Criminal Law",
    difficulty: "beginner",
    prompt:
      "Emeka takes a phone he honestly believes is his twin's identical phone. It belongs to a stranger. Discuss liability for theft under Nigerian law.",
    modelAnswer:
      "Theft requires dishonest appropriation of property belonging to another with intent to permanently deprive. Honest belief that the property is one's own negatives dishonesty; Emeka likely lacks mens rea for theft.",
    gradingNotes: "Separate actus reus and mens rea; emphasise dishonesty / claim of right.",
    tags: ["theft", "mens-rea", "dishonesty"],
  },
  {
    type: "application",
    subject: "Criminal Law",
    difficulty: "intermediate",
    prompt:
      "During a fight, Funke aims a blow at Grace but hits Helen instead, killing Helen. Discuss Funke's liability for homicide.",
    modelAnswer:
      "Transferred malice applies: intent to assault/kill Grace transfers to Helen. Depending on intent and circumstances, Funke may be liable for murder or manslaughter under the Criminal Code / Penal Code framework applicable in the jurisdiction.",
    gradingNotes:
      "Expect transferred malice; distinguish murder vs manslaughter; note Code differences if raised.",
    tags: ["homicide", "transferred-malice"],
  },
  {
    type: "issue_spotting",
    subject: "Criminal Law",
    difficulty: "advanced",
    prompt:
      "Spot the criminal-law issues: a security guard shoots a fleeing unarmed shoplifter in the back after the theft is complete and the thief is outside the store.",
    modelAnswer:
      "Issues: self-defence / defence of property limits, excessive force, timing (crime completed / flight), possible murder or manslaughter, private defence under the Codes, and whether arrest powers justify lethal force.",
    gradingNotes: "Focus on proportionality and when private defence ends.",
    tags: ["self-defence", "force", "homicide"],
  },
  {
    type: "hypothetical",
    subject: "Tort Law",
    difficulty: "beginner",
    prompt:
      "A driver runs a red light and hits a pedestrian. What must the pedestrian prove in negligence?",
    modelAnswer:
      "Duty of care (road users), breach (falling below the standard of a reasonable driver — running a red light), causation (factual and legal), and damage (injury/loss).",
    gradingNotes:
      "Classic negligence elements; Donoghue/neighbour principle adapted to road users.",
    tags: ["negligence", "duty", "breach"],
  },
  {
    type: "application",
    subject: "Tort Law",
    difficulty: "intermediate",
    prompt:
      "A newspaper publishes a false story that a named senator took bribes. The senator sues. Outline the elements of defamation and any likely defences.",
    modelAnswer:
      "Defamation requires a defamatory statement referring to the claimant and published to a third party. Defences may include justification (truth), fair comment/honest opinion, and privilege. Falsity of the bribery claim undermines justification.",
    gradingNotes: "Elements + defences; note libel (written) vs slander.",
    tags: ["defamation", "libel"],
  },
  {
    type: "hypothetical",
    subject: "Constitutional Law",
    difficulty: "beginner",
    prompt:
      "Explain the doctrine of separation of powers under the 1999 Constitution of Nigeria (as amended).",
    modelAnswer:
      "Legislative power is vested in the National Assembly, executive in the President, and judicial in the courts (ss.4–6). Each arm checks the others through mechanisms such as impeachment, judicial review, and legislative oversight.",
    gradingNotes: "Cite ss.4–6; give at least one check-and-balance example.",
    tags: ["separation-of-powers", "1999-constitution"],
  },
  {
    type: "application",
    subject: "Constitutional Law",
    difficulty: "intermediate",
    prompt:
      "A state governor unilaterally creates a new local government outside the constitutional process. Advise on constitutionality.",
    modelAnswer:
      "Local government creation and related matters are constitutionally regulated (e.g. s.8). Unilateral creation outside the prescribed procedure is ultra vires and liable to be struck down; courts have invalidated similar attempts.",
    gradingNotes: "Reference s.8 procedure and supremacy of the Constitution (s.1).",
    tags: ["local-government", "federalism"],
  },
  {
    type: "issue_spotting",
    subject: "Constitutional Law",
    difficulty: "advanced",
    prompt:
      "Spot constitutional issues in an Act that ousts judicial review of administrative detention indefinitely.",
    modelAnswer:
      "Issues: supremacy of the Constitution, fundamental rights (liberty/fair hearing), limits on ouster clauses, judicial review as a constitutional function, and possible inconsistency with Chapter IV.",
    gradingNotes: "Credit rights analysis + ouster/judicial review.",
    tags: ["ouster", "fundamental-rights", "judicial-review"],
  },
  {
    type: "hypothetical",
    subject: "Property Law",
    difficulty: "beginner",
    prompt: "What is the effect of the Land Use Act 1978 on radical title to land in Nigeria?",
    modelAnswer:
      "Radical title is vested in the Governor (for state land) / appropriate authority, with citizens holding rights of occupancy rather than freehold absolute ownership in the old sense.",
    gradingNotes:
      "Core LUA vesting principle; distinguish customary occupation vs statutory right of occupancy.",
    tags: ["land-use-act", "title"],
  },
  {
    type: "application",
    subject: "Property Law",
    difficulty: "intermediate",
    prompt:
      "Ifeanyi buys land from someone who holds only a customary right without Governor's consent where required. Risks?",
    modelAnswer:
      "Transactions requiring consent may be inchoate/voidable or ineffective until consent; buyer risks defective title, inability to perfect C of O, and disputes with the true holder/family.",
    gradingNotes: "Consent requirements and title risk; mention due diligence.",
    tags: ["consent", "customary-land"],
  },
  {
    type: "hypothetical",
    subject: "Evidence Law",
    difficulty: "beginner",
    prompt: "What is hearsay evidence, and why is it generally inadmissible?",
    modelAnswer:
      "Hearsay is an out-of-court statement tendered to prove the truth of its contents. It is generally inadmissible because the original speaker is not under oath/cross-examination, reducing reliability — subject to statutory exceptions.",
    gradingNotes: "Definition + rationale + mention exceptions exist.",
    tags: ["hearsay", "admissibility"],
  },
  {
    type: "application",
    subject: "Evidence Law",
    difficulty: "intermediate",
    prompt:
      "The prosecution tenders a confessional statement allegedly signed by the accused who claims it was obtained by torture. How should the court proceed?",
    modelAnswer:
      "The court should hold a trial-within-trial (voir dire) to determine voluntariness. If involuntary, the confession is inadmissible; if voluntary, it may be admitted and weight assessed with other evidence.",
    gradingNotes: "Voluntariness + trial-within-trial procedure.",
    tags: ["confession", "voluntariness"],
  },
  {
    type: "hypothetical",
    subject: "Commercial Law",
    difficulty: "beginner",
    prompt:
      "Distinguish a private company from a public company under Nigerian company law (high level).",
    modelAnswer:
      "A private company restricts share transfer and membership and cannot invite the public to subscribe for shares; a public company may offer shares to the public and faces stricter disclosure/capital market regulation.",
    gradingNotes: "CAMA distinctions at a conceptual level suffice.",
    tags: ["cama", "company-types"],
  },
  {
    type: "application",
    subject: "Commercial Law",
    difficulty: "intermediate",
    prompt:
      "Directors divert a corporate opportunity to themselves. What claim may the company bring?",
    modelAnswer:
      "Breach of fiduciary duty / conflict of interest; company may seek account of profits, constructive trust, or damages. Duties include acting in good faith for the company's best interests.",
    gradingNotes: "Fiduciary duties + remedies.",
    tags: ["directors", "fiduciary"],
  },
  {
    type: "hypothetical",
    subject: "Equity & Trusts",
    difficulty: "beginner",
    prompt: "State the three certainties required to create an express trust.",
    modelAnswer:
      "Certainty of intention, certainty of subject matter, and certainty of objects (beneficiaries).",
    gradingNotes: "Knight v Knight three certainties.",
    tags: ["trusts", "certainties"],
  },
  {
    type: "application",
    subject: "Equity & Trusts",
    difficulty: "intermediate",
    prompt:
      "A trustee mixes trust money with personal funds and buys land. What equitable remedies may beneficiaries seek?",
    modelAnswer:
      "Tracing into the mixed fund/asset; charge or constructive trust over the land to the extent of trust money; personal claim for breach of trust if tracing fails.",
    gradingNotes: "Tracing + personal vs proprietary claims.",
    tags: ["tracing", "breach-of-trust"],
  },
  {
    type: "hypothetical",
    subject: "Administrative Law",
    difficulty: "beginner",
    prompt: "What is ultra vires in administrative law?",
    modelAnswer:
      "An act beyond the legal powers conferred on a public authority. Courts may quash or declare such acts invalid on judicial review.",
    gradingNotes: "Simple definition + judicial review consequence.",
    tags: ["ultra-vires", "judicial-review"],
  },
  {
    type: "application",
    subject: "Administrative Law",
    difficulty: "intermediate",
    prompt:
      "A licensing board refuses a licence without hearing the applicant. Which ground of review is strongest?",
    modelAnswer:
      "Breach of natural justice / fair hearing (audi alteram partem). The decision is liable to be quashed for procedural impropriety.",
    gradingNotes: "Natural justice focus; may mention legitimate expectation if raised.",
    tags: ["fair-hearing", "natural-justice"],
  },
  {
    type: "hypothetical",
    subject: "Family Law",
    difficulty: "beginner",
    prompt:
      "Under the Matrimonial Causes Act, what is the sole ground for dissolution of marriage in Nigeria?",
    modelAnswer:
      "That the marriage has broken down irretrievably, proved by one or more of the statutory facts (e.g. adultery, intolerable behaviour, desertion, separation periods).",
    gradingNotes: "Irretrievable breakdown + illustrative facts.",
    tags: ["divorce", "mca"],
  },
  {
    type: "application",
    subject: "Family Law",
    difficulty: "intermediate",
    prompt:
      "Parents separate; mother wants sole custody of a 4-year-old. What is the court's paramount consideration?",
    modelAnswer:
      "The welfare of the child is paramount. Courts consider emotional needs, care arrangements, stability, and each parent's capacity — not parental 'rights' as such.",
    gradingNotes: "Welfare principle paramount.",
    tags: ["custody", "welfare"],
  },
  {
    type: "hypothetical",
    subject: "International Law",
    difficulty: "beginner",
    prompt: "Explain the dualist approach to treaties in Nigeria.",
    modelAnswer:
      "Treaties do not automatically form part of domestic law; they generally require domestic incorporation (e.g. legislative transformation) before they create enforceable municipal rights, subject to constitutional provisions on treaty implementation.",
    gradingNotes: "Dualism vs monism; need for domestic incorporation.",
    tags: ["treaties", "dualism"],
  },
  {
    type: "application",
    subject: "International Law",
    difficulty: "intermediate",
    prompt:
      "Nigeria ratifies a human-rights treaty but has not enacted an implementing Act. Can a citizen sue in a Nigerian court relying only on the treaty?",
    modelAnswer:
      "Generally no, under dualism, unless the treaty has been domesticated or another domestic pathway (e.g. African Charter via Cap A9) applies. Mere ratification is usually insufficient for direct municipal enforcement.",
    gradingNotes: "Domestication requirement; African Charter exception if known.",
    tags: ["domestication", "human-rights"],
  },
  {
    type: "hypothetical",
    subject: "Jurisprudence",
    difficulty: "beginner",
    prompt: "Briefly contrast natural law theory with legal positivism.",
    modelAnswer:
      "Natural law links validity of law to morality/reason; unjust 'laws' may lack true legal character. Positivism separates law as it is from law as it ought to be; validity depends on social sources/pedigree, not moral merit.",
    gradingNotes: "Clear contrast; name a theorist optionally (Aquinas/Austin/Hart).",
    tags: ["natural-law", "positivism"],
  },
  {
    type: "application",
    subject: "Jurisprudence",
    difficulty: "intermediate",
    prompt:
      "Using Hart's concept of law, explain the difference between a primary rule and a secondary rule.",
    modelAnswer:
      "Primary rules impose duties (do/don't). Secondary rules confer powers and include rules of recognition, change, and adjudication that identify, alter, and enforce primary rules.",
    gradingNotes: "Hart primary/secondary distinction.",
    tags: ["hart", "rules"],
  },
  {
    type: "hypothetical",
    subject: "Evidence Law",
    difficulty: "advanced",
    prompt: "When may similar-fact evidence be admitted against an accused in a criminal trial?",
    modelAnswer:
      "When its probative value on a live issue (e.g. identity, system, rebutting accident/innocent association) outweighs prejudicial effect; mere propensity is insufficient.",
    gradingNotes: "Probative vs prejudice; purpose beyond propensity.",
    tags: ["similar-fact", "prejudice"],
  },
  {
    type: "hypothetical",
    subject: "Tort Law",
    difficulty: "advanced",
    prompt:
      "An employer is sued for a battery committed by an employee during work hours but for a personal grudge. Advise on vicarious liability.",
    modelAnswer:
      "Vicarious liability requires a tort by employee in the course of employment. A personal vendetta may be a frolic of one's own outside employment; however, modern close-connection tests may still impose liability if the job created the risk/opportunity. Apply facts carefully.",
    gradingNotes: "Course of employment / close connection; frolic doctrine.",
    tags: ["vicarious-liability"],
  },
  {
    type: "application",
    subject: "Contract Law",
    difficulty: "beginner",
    prompt: "State the postal rule and when it typically applies.",
    modelAnswer:
      "Acceptance is complete when a properly addressed acceptance letter is posted, not when received — traditionally for postal acceptances where post is an contemplated medium. It does not usually apply to instantaneous communications.",
    gradingNotes: "Adams v Lindsell idea; instantaneous exception.",
    tags: ["postal-rule", "acceptance"],
  },
  {
    type: "issue_spotting",
    subject: "Commercial Law",
    difficulty: "advanced",
    prompt:
      "Spot issues: a company's MD guarantees a bank loan orally, company seal is not affixed, and the board never authorised the guarantee.",
    modelAnswer:
      "Issues: authority (actual/ostensible), indoor management rule, formality of guarantees/company execution, possible personal liability of MD, and whether the bank can enforce against company or only MD.",
    gradingNotes: "Authority + formalities + indoor management.",
    tags: ["authority", "guarantee"],
  },
  {
    type: "hypothetical",
    subject: "Administrative Law",
    difficulty: "advanced",
    prompt: "Distinguish certiorari, prohibition, and mandamus.",
    modelAnswer:
      "Certiorari quashes an ultra vires/invalid decision already made; prohibition restrains a body from exceeding jurisdiction going forward; mandamus compels performance of a public duty.",
    gradingNotes: "Three prerogative orders correctly distinguished.",
    tags: ["prerogative-orders"],
  },
  {
    type: "application",
    subject: "Property Law",
    difficulty: "advanced",
    prompt:
      "Two parties claim the same land: one has a prior equitable interest, the other a later legal title as bona fide purchaser without notice. Who prevails in equity's classic priority rules?",
    modelAnswer:
      "A bona fide purchaser of a legal estate for value without notice generally takes free of prior equities. If the later party has notice or is not a purchaser for value, the prior equity may prevail.",
    gradingNotes: "Equity's darling / notice doctrine.",
    tags: ["priorities", "bona-fide-purchaser"],
  },
  {
    type: "issue_spotting",
    subject: "Family Law",
    difficulty: "advanced",
    prompt:
      "Spot issues in a dispute over whether an Islamic marriage and a later statutory Marriage Act ceremony create one or two marital statuses and what law governs divorce.",
    modelAnswer:
      "Issues: validity of each ceremony, potential double-decker / conversion issues, applicable personal law vs Matrimonial Causes Act, jurisdiction, and relief available on dissolution.",
    gradingNotes: "Plurality of marriage systems in Nigeria.",
    tags: ["customary", "islamic", "statutory-marriage"],
  },
  {
    type: "hypothetical",
    subject: "Constitutional Law",
    difficulty: "intermediate",
    prompt: "What is the effect of section 1(3) of the 1999 Constitution?",
    modelAnswer:
      "If any other law is inconsistent with the Constitution, the Constitution prevails and the other law is void to the extent of the inconsistency — constitutional supremacy.",
    gradingNotes: "Supremacy / inconsistency clause.",
    tags: ["supremacy", "s1"],
  },
  {
    type: "application",
    subject: "Criminal Law",
    difficulty: "beginner",
    prompt: "Define actus reus and mens rea.",
    modelAnswer:
      "Actus reus is the prohibited conduct/state of affairs (including sometimes omissions). Mens rea is the fault element (intention, knowledge, recklessness, etc.) required for the offence, unless it is strict liability.",
    gradingNotes: "Basic definitions; optional note on strict liability.",
    tags: ["actus-reus", "mens-rea"],
  },
];

const QuestionSchema = new mongoose.Schema(
  {
    type: String,
    subject: String,
    difficulty: String,
    prompt: String,
    modelAnswer: String,
    gradingNotes: String,
    tags: [String],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "questions" }
);

async function seedDb(label: string, uri: string): Promise<void> {
  const conn = await mongoose.createConnection(uri).asPromise();
  const Question = conn.model("Question", QuestionSchema);
  let inserted = 0;
  let skipped = 0;

  for (const q of QUESTIONS) {
    const existing = await Question.findOne({ prompt: q.prompt }).lean();
    if (existing) {
      skipped += 1;
      continue;
    }
    await Question.create({ ...q, isActive: true });
    inserted += 1;
  }

  const total = await Question.countDocuments({ isActive: true });
  console.log(`[${label}] inserted=${inserted} skipped=${skipped} activeTotal=${total}`);
  await conn.close();
}

async function main(): Promise<void> {
  const prodEnv = loadEnvFile(".env.production");
  const stagingEnv = loadEnvFile(".env.staging");
  const targets: Array<{ label: string; uri: string }> = [];

  const prodUri = process.env.PROD_MONGO_URI || prodEnv.MONGO_URI;
  const devUri = process.env.DEV_MONGO_URI || stagingEnv.MONGO_URI;
  if (devUri) targets.push({ label: "dev/test", uri: devUri });
  if (prodUri) targets.push({ label: "prod/legalerrand", uri: prodUri });

  if (!targets.length) {
    throw new Error("No Mongo URIs found. Set DEV_MONGO_URI / PROD_MONGO_URI.");
  }

  console.log(`Seeding ${QUESTIONS.length} question templates…`);
  for (const t of targets) {
    await seedDb(t.label, t.uri);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
