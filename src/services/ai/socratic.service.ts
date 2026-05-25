import { deepseekService } from "./deepseek.service";
import { ConversationMessage } from "../../types";
import { AI_LIMITS } from "../../config/deepseek";

const SOCRATIC_SYSTEM_PROMPT = `You are a Socratic law tutor. Your role is to guide students to discover legal concepts through questioning — never give direct answers.

Rules:
1. Ask ONE clear, probing question per response that leads the student toward understanding
2. Build on the student's previous response — acknowledge what they got right
3. Use real-world Nigerian examples to make abstract concepts concrete
4. If the student is clearly wrong, ask a question that reveals the contradiction
5. Keep responses concise (2-3 sentences max + 1 question)
6. Never state the answer directly — guide through questions only`;

const HINT_PROMPT = (hintsRemaining: number) =>
  `The student is struggling. Provide a gentle hint that narrows down the answer without giving it away. Make it clear this is a hint (${hintsRemaining} hints remaining after this one).`;

export const socraticService = {
  async openingQuestion(topic: string): Promise<string> {
    const prompt = `Start a Socratic tutoring session on this Nigerian law topic: "${topic}". Ask an engaging opening question that assesses the student's baseline understanding.`;
    return deepseekService.chat(prompt, SOCRATIC_SYSTEM_PROMPT, AI_LIMITS.MAX_TOKENS.SOCRATIC);
  },

  async continueSession(
    messages: ConversationMessage[],
    latestStudentResponse: string
  ): Promise<string> {
    const updatedMessages: ConversationMessage[] = [
      ...messages,
      { role: "user", content: latestStudentResponse, timestamp: new Date() },
    ];
    return deepseekService.chatWithHistory(
      updatedMessages,
      SOCRATIC_SYSTEM_PROMPT,
      AI_LIMITS.MAX_TOKENS.SOCRATIC
    );
  },

  async provideHint(messages: ConversationMessage[], hintsRemaining: number): Promise<string> {
    const updatedMessages: ConversationMessage[] = [
      ...messages,
      {
        role: "user",
        content: HINT_PROMPT(hintsRemaining),
        timestamp: new Date(),
      },
    ];
    return deepseekService.chatWithHistory(
      updatedMessages,
      SOCRATIC_SYSTEM_PROMPT,
      AI_LIMITS.MAX_TOKENS.SOCRATIC
    );
  },

  async generateSessionSummary(
    messages: ConversationMessage[],
    topic: string
  ): Promise<{ understanding: number; summary: string; reflectionQuestion: string }> {
    const prompt = `Based on this Socratic tutoring session on "${topic}", evaluate the student's understanding.

Conversation:
${messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n")}

Return JSON:
{
  "understanding": <0-100>,
  "summary": "<what the student demonstrated they understand>",
  "reflectionQuestion": "<one deep reflection question to think about after the session>"
}`;

    return deepseekService.structuredCompletion<{
      understanding: number;
      summary: string;
      reflectionQuestion: string;
    }>(prompt);
  },
};
