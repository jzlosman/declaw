import { rewriteText } from "./preservation.ts";
import { REWRITE_POLICY_VERSION } from "./styles.ts";

export const ENTRY_TYPE = "plain-rewrite";
export const POLICY_VERSION = REWRITE_POLICY_VERSION;
export const REWRITE_PROVIDER = "openai-codex";
export const REWRITE_MODEL = "gpt-5.6-luna";
export const REWRITE_THINKING = "low" as const;
export const MAX_INPUT_CHARS = 32_000;
export const TIMEOUT_MS = 60_000;

export interface PlainEntry {
  version: typeof POLICY_VERSION;
  sourceEntryId: string;
  text: string;
  model: string;
  thinkingLevel?: typeof REWRITE_THINKING;
  style?: string;
  /** Snapshot metadata keeps historical entries readable after plugin removal. */
  styleName?: string;
  stylePlugin?: string;
  styleVersion?: string;
}

export class PlainError extends Error {}

/** Pure application operation: the model gateway returns text, not a Pi message. */
export async function rewriteAnswer(text: string, complete: (masked: string) => Promise<string>): Promise<string> {
  if (text.length > MAX_INPUT_CHARS) {
    throw new PlainError("This answer is too long for /declaw (32,000 characters maximum).");
  }
  try {
    const rewritten = await rewriteText(text, complete);
    if (rewritten.trim() === text.trim()) {
      throw new PlainError("The model returned unchanged text, so no duplicate was added. Try /declaw again if you want another attempt.");
    }
    return rewritten;
  } catch (error) {
    if (error instanceof PlainError) throw error;
    if (error instanceof Error && ["preservation", "empty-or-oversize"].includes(error.message)) {
      throw new PlainError("The rewrite failed the exact-text checks and was discarded. The original is unchanged.");
    }
    throw new PlainError("The rewrite request failed. Check /login or choose another model with /declaw model.");
  }
}

/** Stop waiting even if a provider ignores cancellation; still observe any late rejection. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason ?? new Error("Cancelled"));
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
  });
}
