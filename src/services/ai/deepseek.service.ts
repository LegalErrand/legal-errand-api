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

/**
 * Models often wrap JSON in ``` fences or add leading/trailing prose.
 * Extract the first parseable JSON object/array from the model output.
 */
export function parseAiJson<T>(raw: string): T {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    throw new Error("AI returned empty response");
  }

  const candidates: string[] = [trimmed];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  const objStart = trimmed.indexOf("{");
  const objEnd = trimmed.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    candidates.push(trimmed.slice(objStart, objEnd + 1));
  }

  const arrStart = trimmed.indexOf("[");
  const arrEnd = trimmed.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    candidates.push(trimmed.slice(arrStart, arrEnd + 1));
  }

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("AI returned invalid JSON");
}

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
   * Structured JSON response (for grading, scoring, case explainer, etc.)
   */
  async structuredCompletion<T>(
    prompt: string,
    systemContext?: string,
    maxTokens: number = AI_LIMITS.MAX_TOKENS.GRADING
  ): Promise<T> {
    const systemPrompt = `${NIGERIAN_LAW_SYSTEM_PROMPT}${systemContext ? `\n\n${systemContext}` : ""}

Respond ONLY with a single valid JSON object. No markdown fences. No prose outside the JSON.`;

    const requestOnce = async (userPrompt: string, useJsonMode: boolean): Promise<string> => {
      try {
        const response = await aiClient.chat.completions.create({
          model: AI_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
          ...(useJsonMode ? { response_format: { type: "json_object" as const } } : {}),
        });
        return response.choices[0]?.message?.content ?? "";
      } catch (err) {
        // Some model/proxy combos reject response_format — retry without it.
        if (useJsonMode) {
          logger.warn("JSON response_format rejected — falling back to plain completion", {
            error: err instanceof Error ? err.message : String(err),
          });
          return requestOnce(userPrompt, false);
        }
        throw err;
      }
    };

    let raw = await requestOnce(prompt, true);
    try {
      return parseAiJson<T>(raw);
    } catch (firstErr) {
      logger.warn("AI structured JSON parse failed — retrying once", {
        preview: raw.slice(0, 240),
        error: firstErr instanceof Error ? firstErr.message : String(firstErr),
      });

      raw = await requestOnce(
        `Your previous reply was not valid JSON. Convert it into ONE valid JSON object that matches the required schema. Output JSON only.\n\nPREVIOUS REPLY:\n${raw.slice(0, 6000)}`,
        true
      );

      try {
        return parseAiJson<T>(raw);
      } catch {
        logger.error("Failed to parse AI structured response after retry:", raw.slice(0, 800));
        throw new Error("AI returned invalid JSON");
      }
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
