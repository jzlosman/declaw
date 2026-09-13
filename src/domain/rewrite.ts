import { REWRITE_POLICY_VERSION } from "./styles.ts";

export const ENTRY_TYPE = "plain-rewrite";
export const POLICY_VERSION = REWRITE_POLICY_VERSION;
export const REWRITE_PROVIDER = "openai-codex";
export const REWRITE_MODEL = "gpt-5.6-luna";
export const REWRITE_THINKING = "low" as const;
export const MAX_INPUT_CHARS = 32_000;
export const MAX_OUTPUT_CHARS = 64_000;

export interface PlainEntry {
  version: typeof POLICY_VERSION;
  /** Null identifies supplied text, which is not an assistant session entry. */
  sourceEntryId: string | null;
  text: string;
  model: string;
  thinkingLevel?: typeof REWRITE_THINKING;
  style?: string;
  /** Snapshot metadata keeps historical entries readable after plugin removal. */
  styleName?: string;
  stylePlugin?: string;
  styleVersion?: string;
}

export interface RewritePlan {
  readonly original: string;
}

export type RewriteRejection = "empty-source" | "source-too-long" | "invalid-output" | "unchanged";
export type RejectedRewrite<R extends RewriteRejection = RewriteRejection> = { readonly kind: "rejected"; readonly reason: R };
export type PreparedRewrite = { readonly kind: "ready"; readonly plan: RewritePlan } | RejectedRewrite<"empty-source" | "source-too-long">;
export type FinalReading = { readonly kind: "accepted"; readonly text: string } | RejectedRewrite<"invalid-output" | "unchanged">;

/** Keep the raw source for the plugin; the host only bounds usable text. */
export function prepareRewrite(text: string): PreparedRewrite {
  if (!text.trim()) return { kind: "rejected", reason: "empty-source" };
  if (text.length > MAX_INPUT_CHARS) return { kind: "rejected", reason: "source-too-long" };
  return { kind: "ready", plan: Object.freeze({ original: text }) };
}

/** Plugins own transformation. This gate checks size and duplicates, not fidelity. */
export function finalizeRewrite(plan: RewritePlan, output: string): FinalReading {
  if (typeof output !== "string" || !output.trim() || output.length > MAX_OUTPUT_CHARS) {
    return { kind: "rejected", reason: "invalid-output" };
  }
  if (output.trim() === plan.original.trim()) return { kind: "rejected", reason: "unchanged" };
  return { kind: "accepted", text: output };
}
