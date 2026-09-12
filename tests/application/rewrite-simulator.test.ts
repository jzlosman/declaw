import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { executeRewrite, type SourceAnswer } from "../../src/application/rewrite.ts";

const source: SourceAnswer = { id: "answer-1", text: "Use `config.json` before continuing." };
const events = fc.array(fc.constantFrom("invalidate", "cancel", "noop" as const), { maxLength: 12 });

test("deterministic simulator: invalidation before completion never publishes stale work", async () => {
  await fc.assert(fc.asyncProperty(events, async (beforeCompletion) => {
    let current = true;
    let published = 0;
    const controller = new AbortController();
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => { complete = resolve; });
    const run = executeRewrite(source, controller.signal, {
      complete: async (masked, signal) => {
        signal.throwIfAborted();
        await completion;
        signal.throwIfAborted();
        return masked.replace("Use", "Check");
      },
      isCurrent: () => current,
      publish: () => { published++; },
    });
    for (const event of beforeCompletion) {
      if (event === "invalidate") current = false;
      if (event === "cancel") controller.abort();
    }
    complete();
    const result = await run.catch(() => ({ kind: "cancelled" as const }));
    const shouldPublish = current && !controller.signal.aborted;
    assert.equal(published, shouldPublish ? 1 : 0);
    assert.equal(result.kind, controller.signal.aborted ? "cancelled" : current ? "accepted" : "stale");
  }), { numRuns: 100 });
});
