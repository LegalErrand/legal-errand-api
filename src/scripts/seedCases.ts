/**
 * Seed script — Research Case Library
 * Run with:  npx ts-node --transpile-only src/scripts/seedCases.ts
 *
 * Inserts curated Nigerian law cases as library content.
 * Cases without a hosted PDF use an empty s3Key/s3Url; the record is still
 * fully searchable and viewable via its metadata and description.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGO_URI = process.env.MONGO_URI!;

// ── Minimal inline schema (avoids importing the full app) ────────────────────
const DocumentSchema = new mongoose.Schema(
  {
    title: String,
    type: String,
    subject: String,
    s3Key: { type: String, default: "" },
    s3Url: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    isLibraryContent: { type: Boolean, default: true },
    metadata: {
      court: String,
      year: Number,
      citation: String,
      jurisdiction: { type: String, default: "Nigeria" },
      description: String,
    },
    bookmarks: [mongoose.Schema.Types.ObjectId],
  },
  { timestamps: true, collection: "documents" }
);

const Doc = mongoose.model("SeedDocument", DocumentSchema);

// ── Case data ────────────────────────────────────────────────────────────────
const cases = [
  {
    title: "Attorney-General of the Federation v. Attorney-General of Abia State & 35 Ors",
    type: "case_law",
    subject: "Constitutional Law",
    isLibraryContent: true,
    metadata: {
      citation: "SC/CV/343/2024",
      court: "Supreme Court of Nigeria",
      year: 2024,
      jurisdiction: "Nigeria",
      description: `PARTIES
Plaintiff: Attorney-General of the Federation
Defendants: Attorneys-General of Abia State and 35 other States

FACTS
The Attorney-General of the Federation (AGF) filed an Originating Summons in 2024 challenging the long-standing practice by which State Governors withheld and controlled Federation Account allocations meant for the 774 Local Government Areas (LGAs) across Nigeria. Evidence showed that in over half of the 36 states, elected local government councils had been replaced by unelected caretaker committees, depriving LGAs of both democratic governance and independent finances.

ISSUES FOR DETERMINATION
1. Whether it is constitutional for State Governors to receive and retain Federation Account allocations meant for LGAs without paying same directly to the LGAs.
2. Whether State Governors can lawfully dissolve democratically elected Local Government Councils and replace them with caretaker committees.

HELD
The Supreme Court, in a unanimous decision delivered by Justice Emmanuel Agim, held as follows:
1. Democratically elected Local Government Councils have a constitutional right to receive their Federation Account allocations DIRECTLY into their own accounts, without the funds passing through State Government hands.
2. State Governors have no constitutional authority to dissolve democratically elected Local Government Councils and substitute them with caretaker committees.
3. The Federal Government was ordered to pay LGA allocations directly to duly elected councils, bypassing state joint accounts where governors exercised unilateral control.

RATIO DECIDENDI
Sections 7 and 162 of the 1999 Constitution (as amended) guarantee the system of democratically elected Local Government Councils and their right to a share of the Federation Account. Any arrangement that routes LGA funds through State Governments in a manner that enables governors to withhold, control, or divert those funds is unconstitutional. The constitutional architecture of Nigerian federalism demands that the three tiers of government — Federal, State, and Local — each receive their allocations independently.

SIGNIFICANCE
This is one of the most consequential constitutional law decisions of the 21st century in Nigeria. It directly affects the fiscal relationship between all three tiers of government, strengthens grassroots democracy, and curtails the decades-long practice of "State-Local Government joint accounts" which enabled governors to starve councils of funds. The ruling has significant implications for public finance law, constitutional federalism, and administrative law.

RELATED PRINCIPLES
- Section 7, 1999 Constitution (as amended) — Guarantee of democratic LGAs
- Section 162, 1999 Constitution (as amended) — Federation Account sharing
- Third Tier of Government fiscal autonomy
- Doctrine of constitutional supremacy

PRACTICE QUESTIONS
1. Analyse the constitutional basis for LGA financial autonomy under the 1999 Constitution.
2. To what extent does the Supreme Court's ruling alter the structure of Nigerian fiscal federalism?
3. Discuss the tension between Section 7 (LGA autonomy) and the supervisory powers of State Houses of Assembly over local governments.`,
    },
  },
  {
    title: "Okorodudu v. The State",
    type: "case_law",
    subject: "Criminal Law",
    isLibraryContent: true,
    metadata: {
      citation: "SC/766/2014",
      court: "Supreme Court of Nigeria",
      year: 2024,
      jurisdiction: "Nigeria",
      description: `PARTIES
Appellant: Tina Okorodudu
Respondent: The State

FACTS
On 30 April 2007, a physical altercation broke out between the appellant, Tina Okorodudu, and one Jerry Adarerhi. After the initial confrontation, the appellant retrieved a broken Coca-Cola bottle and used it to stab the deceased in the back, causing his death. The appellant was charged with murder. At trial, she raised the defences of provocation and self-defence.

ISSUES FOR DETERMINATION
1. Whether the Court of Appeal was right to uphold the trial court's finding that the appellant failed to establish the defence of provocation on the evidence.
2. Whether the defence of self-defence was available to the appellant on the facts.

HELD
The Supreme Court dismissed the appeal and affirmed the conviction. The Court held:
1. The prosecution had established all four elements of murder beyond reasonable doubt: (i) death occurred; (ii) the accused caused it; (iii) death occurred within a year and a day; and (iv) there was intention to cause serious bodily harm.
2. The defence of provocation requires "sudden and grave provocation" resulting in actual loss of self-control. On the facts, the appellant had sufficient time to cool down between the initial altercation and the stabbing. The act was therefore deliberate and premeditated, not spontaneous.
3. Self-defence was unavailable because the appellant was not the initial victim at the time she retrieved the broken bottle — she had had the opportunity to retreat or disengage.

RATIO DECIDENDI
For the defence of provocation to succeed, the retaliation must be immediate and proportionate, occurring before passion has had time to cool. A break in the sequence of events that gives an accused time to reflect and then choose to arm themselves and attack negates the suddenness required by law. Self-defence is only available to one who is in imminent danger and cannot reasonably retreat.

SIGNIFICANCE
This case reinforces the strict standard applied by Nigerian courts to murder defences. It clarifies the temporal element of provocation and confirms that deliberate arming after an initial altercation is inconsistent with both provocation and self-defence.

COUNSEL
Appellant: Fedude Zimughan, Esq.
Respondent: D.E. Agbaga, Esq.`,
    },
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(MONGO_URI);
  console.log("Connected to MongoDB");

  let inserted = 0;
  let skipped = 0;

  for (const c of cases) {
    const exists = await Doc.findOne({ title: c.title });
    if (exists) {
      console.log(`  SKIP  (already exists) — ${c.title}`);
      skipped++;
      continue;
    }
    await Doc.create(c);
    console.log(`  ADDED — ${c.title}`);
    inserted++;
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
