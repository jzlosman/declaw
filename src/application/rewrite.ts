import { prepareRewrite, finalizeRewrite, type RejectedRewrite } from "../domain/rewrite.ts";
import { abortable } from "./cancellation.ts";

/** One provider call, with the overall clock owned by adapters. */
export const REWRITE_TIMEOUT_MS = 60_000;

export interface RewriteSource {
  /** A session answer identity, or null for user-supplied text. */
  readonly id: string | null;
  readonly text: string;
}

export interface PublishedRewrite {
  readonly sourceEntryId: string | null;
  readonly text: string;
}

export interface RewriteExecutionPorts {
  rewrite: (source: string, signal: AbortSignal) => Promise<string>;
  isCurrent: (source: RewriteSource) => boolean;
  publish: (rewrite: PublishedRewrite) => void;
}

export type RewriteExecutionResult =
  | { readonly kind: "accepted"; readonly sourceEntryId: string | null; readonly text: string }
  | RejectedRewrite
  | { readonly kind: "failed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "stale" };

type Interrupted = Extract<RewriteExecutionResult, { kind: "cancelled" | "stale" }>;

/** Rewrite once, check operational bounds, then publish while the source is current. */
export async function executeRewrite(
  source: RewriteSource,
  signal: AbortSignal,
  ports: RewriteExecutionPorts,
): Promise<RewriteExecutionResult> {
  const snapshot: RewriteSource = Object.freeze({ id: source.id, text: source.text });
  const interrupted = (): Interrupted | undefined => signal.aborted
    ? { kind: "cancelled" }
    : !ports.isCurrent(snapshot) ? { kind: "stale" } : undefined;
  const stopped = interrupted();
  if (stopped) return stopped;
  const prepared = prepareRewrite(snapshot.text);
  if (prepared.kind === "rejected") return prepared;

  let output: string;
  try {
    output = await abortable(ports.rewrite(prepared.plan.original, signal), signal);
  } catch {
    return interrupted() ?? { kind: "failed" };
  }
  const afterRewrite = interrupted();
  if (afterRewrite) return afterRewrite;
  const reading = finalizeRewrite(prepared.plan, output);
  if (reading.kind === "rejected") return reading;

  // No asynchronous work between the last current-source check and publication.
  ports.publish({ sourceEntryId: snapshot.id, text: reading.text });
  return { kind: "accepted", sourceEntryId: snapshot.id, text: reading.text };
}
