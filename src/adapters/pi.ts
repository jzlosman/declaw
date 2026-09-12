import { randomUUID } from "node:crypto";
import type { Api, AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildStyleRequest, DEFAULT_STYLE_ID, type StyleCatalog, type StyleId } from "../domain/styles.ts";
import { BUILTIN_CATALOG } from "../plugins/built-in/catalog.ts";

/** Composed default prompt exposed for integration diagnostics and compatibility. */
export const SYSTEM_PROMPT = buildStyleRequest("", DEFAULT_STYLE_ID, BUILTIN_CATALOG).system;

/** Pi's message shape is normalized at the adapter edge. */
export function completedText(message: AssistantMessage): string | undefined {
  if (message.stopReason !== "stop" || message.errorMessage ||
      message.content.some((part) => part.type === "toolCall")) return undefined;
  const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n\n");
  return text.trim() ? text : undefined;
}

/** Reads only the latest assistant message; a failed latest answer is authoritative. */
export function latestAnswer(branch: readonly SessionEntry[]): { id: string; text: string } | undefined {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const text = completedText(entry.message);
    return text === undefined ? undefined : { id: entry.id, text };
  }
  return undefined;
}

/** Converts the domain rewrite request into Pi's isolated, tool-free provider context. */
export function isolatedRequest(
  maskedAnswer: string,
  model: Model<Api>,
  signal: AbortSignal,
  style: StyleId = DEFAULT_STYLE_ID,
  catalog: StyleCatalog = BUILTIN_CATALOG,
): { context: Context; options: SimpleStreamOptions } {
  const request = buildStyleRequest(maskedAnswer, style, catalog);
  const context: Context = {
    systemPrompt: request.system,
    messages: [{ role: "user", content: request.user, timestamp: Date.now() }],
    tools: [],
  };
  return {
    context,
    options: {
      signal,
      sessionId: randomUUID(),
      cacheRetention: "none" as const,
      reasoning: "low",
      maxRetries: 0,
      transport: "sse",
      timeoutMs: 60_000,
      maxTokens: Math.min(16_384, model.maxTokens),
    },
  };
}
