import { deepseekService } from "./deepseek.service";
import { AI_LIMITS } from "../../config/deepseek";

interface GradingResult {
  scores: {
    issueIdentification: number;
    ruleStatement: number;
    application: number;
    conclusion: number;
    total: number;
  };
  feedback: {
    issueIdentification: string;
    ruleStatement: string;
    application: string;
    conclusion: string;
    overall: string;
  };
  strengths: string[];
  improvements: string[];
  modelAnswerHints: string;
}

export const gradingService = {
  async gradeAnswer(
    questionPrompt: string,
    studentAnswer: string,
    modelAnswer?: string,
    gradingNotes?: string
  ): Promise<GradingResult> {
    const prompt = `
Grade the following student answer to a Nigerian law reasoning question using the IRAC rubric.

QUESTION:
${questionPrompt}

STUDENT ANSWER:
${studentAnswer}

${modelAnswer ? `MODEL ANSWER REFERENCE:\n${modelAnswer}\n` : ""}
${gradingNotes ? `GRADING NOTES:\n${gradingNotes}\n` : ""}

Return a JSON object with this exact structure:
{
  "scores": {
    "issueIdentification": <0-100>,
    "ruleStatement": <0-100>,
    "application": <0-100>,
    "conclusion": <0-100>,
    "total": <weighted total using: issueIdentification*0.25 + ruleStatement*0.25 + application*0.35 + conclusion*0.15>
  },
  "feedback": {
    "issueIdentification": "<specific feedback on issue spotting>",
    "ruleStatement": "<specific feedback on stating the law>",
    "application": "<specific feedback on applying law to facts>",
    "conclusion": "<specific feedback on conclusion>",
    "overall": "<overall summary feedback>"
  },
  "strengths": ["<strength 1>", "<strength 2>"],
  "improvements": ["<improvement area 1>", "<improvement area 2>"],
  "modelAnswerHints": "<key points the student missed>"
}`;

    return deepseekService.structuredCompletion<GradingResult>(
      prompt,
      undefined,
      AI_LIMITS.MAX_TOKENS.GRADING
    );
  },
};
