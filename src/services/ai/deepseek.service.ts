import { aiClient, AI_MODEL, AI_LIMITS } from "../../config/deepseek";
import { ConversationMessage } from "../../types";
import { logger } from "../../utils/logger";

// Nigerian law system prompt injected into every AI call
const NIGERIAN_LAW_SYSTEM_PROMPT = `You are an expert Nigerian law tutor and legal research assistant for LegalErrand Academy.
Your knowledge covers Nigerian constitutional law, common law as applied in Nigeria, statutory law including the Constitution of the Federal Republic of Nigeria 1999 (as amended), the Evidence Act, Criminal Code, Penal Code, and other key Nigerian statutes.
Always reference Nigerian cases, statutes, and legal principles where relevant.
When citing cases, use proper Nigerian legal citation format (e.g., Donoghue v Stevenson [1932] AC 562, as applied in Nigerian courts).
Be precise, educational, and adapt your language to law students. Avoid hallucinating case names or statutes.`;

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
