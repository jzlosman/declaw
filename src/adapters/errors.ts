import type { RewriteExecutionResult } from "../application/rewrite.ts";

/** Adapter-facing error whose message is safe to show without provider diagnostics. */
export class PlainError extends Error {}

/** Translate typed outcomes at the UI edge; never display provider exception payloads. */
export function rewriteFailureMessage(result: Extract<RewriteExecutionResult, { kind: "rejected" | "failed" }>): string {
  if (result.kind === "failed") {
    return "The rewrite request failed. Check /login or choose another model with /declaw model. The original is unchanged.";
  }
  switch (result.reason) {
    case "empty-source": return "No completed assistant answer is available to rewrite.";
    case "source-too-long": return "This answer is too long for /declaw (32,000 characters maximum).";
    case "invalid-output": return "The model did not return a usable rewrite (64,000 characters maximum). The original is unchanged.";
    case "unchanged": return "The rewrite is unchanged, so no duplicate was added.";
  }
}
