import { aiClient, AI_MODEL, AI_LIMITS } from "../../config/deepseek";
import { ConversationMessage } from "../../types";
import { logger } from "../../utils/logger";

// Nigerian law system prompt injected into every AI call
const NIGERIAN_LAW_SYSTEM_PROMPT = `You are a senior Nigerian law lecturer and legal research assistant for LegalErrand Academy.

EXPERTISE:
- Nigerian constitutional law (CFRN 1999 as amended)
- Nigerian common law and equity
- Statutes: Evidence Act 2011, Criminal Code Act, Penal Code (Northern States), Companies and Allied Matters Act 2020, Land Use Act, Labour Act, and other federal/state legislation
- Nigerian court hierarchy: Supreme Court → Court of Appeal → Federal/State High Courts → Magistrate Courts
- Nigerian legal citation format: e.g., Abiodun v. FRN (2007) 18 NWLR (Pt. 1066) 539

STRICT ACCURACY RULES:
1. Only cite cases and statutes you are confident are real and accurately described. If unsure of a citation, say so clearly.
2. Do not fabricate case names, page numbers, party names, or year of judgment.
3. When a question is outside Nigerian law or your confident knowledge, say so rather than guessing.
4. Provide balanced analysis — state what the law IS, then explain any controversy or reform debates.

STYLE:
- Write in clear, accessible English suitable for Nigerian law students at 100–500 level.
- Use plain prose for explanations; avoid markdown tables or bullet lists unless the format specifically requires it.
- Distinguish obiter dicta from ratio decidendi when analyzing cases.`;

export const deepseekService = {
  /**
   * Single-turn chat (context-free)
   */
  async chat(
    userMessage: string,
    systemContext?: string,
    maxTokens: number = AI_LIMITS.MAX_TOKENS.CHAT
  ): Promise<string> {
    const systemPrompt = systemContext
      ? `${NIGERIAN_LAW_SYSTEM_PROMPT}\n\n${systemContext}`
      : NIGERIAN_LAW_SYSTEM_PROMPT;

    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content ?? "";
  },

  /**
   * Multi-turn conversation (with history)
   */
  async chatWithHistory(
    messages: ConversationMessage[],
    systemContext?: string,
    maxTokens: number = AI_LIMITS.MAX_TOKENS.CHAT
  ): Promise<string> {
    const systemPrompt = systemContext
      ? `${NIGERIAN_LAW_SYSTEM_PROMPT}\n\n${systemContext}`
      : NIGERIAN_LAW_SYSTEM_PROMPT;

    const formattedMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...formattedMessages],
      max_tokens: maxTokens,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content ?? "";
  },

  /**
   * Structured JSON response (for grading, scoring, etc.)
   */
  async structuredCompletion<T>(
    prompt: string,
    systemContext?: string,
    maxTokens: number = AI_LIMITS.MAX_TOKENS.GRADING
  ): Promise<T> {
    const systemPrompt = `${NIGERIAN_LAW_SYSTEM_PROMPT}${systemContext ? `\n\n${systemContext}` : ""}

Respond ONLY with valid JSON. No markdown, no prose outside the JSON.`;

    const response = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.3, // Lower temperature for structured outputs
    });

    const raw = response.choices[0]?.message?.content ?? "{}";
    try {
      return JSON.parse(raw) as T;
    } catch {
      logger.error("Failed to parse AI structured response:", raw);
      throw new Error("AI returned invalid JSON");
    }
  },

  /**
   * Streaming chat (for real-time UI responses)
   */
  async *streamChat(
    userMessage: string,
    history: ConversationMessage[] = [],
    systemContext?: string
  ): AsyncGenerator<string> {
    const systemPrompt = systemContext
      ? `${NIGERIAN_LAW_SYSTEM_PROMPT}\n\n${systemContext}`
      : NIGERIAN_LAW_SYSTEM_PROMPT;

    const formattedHistory = history.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    const stream = await aiClient.chat.completions.create({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...formattedHistory,
        { role: "user", content: userMessage },
      ],
      max_tokens: AI_LIMITS.MAX_TOKENS.CHAT,
      temperature: 0.7,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  },
};
