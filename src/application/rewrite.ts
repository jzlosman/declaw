import { rewriteAnswer } from "../domain/rewrite.ts";

export interface SourceAnswer {
  readonly id: string;
  readonly text: string;
}

export interface PublishedRewrite {
  readonly sourceEntryId: string;
  readonly text: string;
}

export interface RewriteExecutionPorts {
  /** Model adapter. It receives masked text and must honor cancellation. */
  complete: (maskedAnswer: string, signal: AbortSignal) => Promise<string>;
  /** Application adapter decides whether the source is still publishable. */
  isCurrent: (source: SourceAnswer) => boolean;
  /** Display/session adapter persists an accepted display projection. */
  publish: (rewrite: PublishedRewrite) => void;
}

export type RewriteExecutionResult =
  | { kind: "accepted"; sourceEntryId: string; text: string }
  | { kind: "stale" };

/**
 * Application use case for the effectful rewrite boundary.
 * Validation happens before publication; stale work is discarded without a write.
 */
export async function executeRewrite(
  source: SourceAnswer,
  signal: AbortSignal,
  ports: RewriteExecutionPorts,
): Promise<RewriteExecutionResult> {
  const text = await rewriteAnswer(source.text, (maskedAnswer) => ports.complete(maskedAnswer, signal));
  if (signal.aborted || !ports.isCurrent(source)) return { kind: "stale" };
  ports.publish({ sourceEntryId: source.id, text });
  return { kind: "accepted", sourceEntryId: source.id, text };
}
