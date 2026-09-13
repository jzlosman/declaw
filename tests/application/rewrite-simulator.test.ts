import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { executeRewrite, type SourceAnswer } from "../../src/application/rewrite.ts";

const source: SourceAnswer = { id: "answer-1", text: "Use `config.json` before continuing." };
const events = fc.array(fc.constantFrom("invalidate", "cancel", "noop"), { maxLength: 12 });
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
};

test("deterministic simulator: a single rewrite cannot publish stale or cancelled work", async () => {
  await fc.assert(fc.asyncProperty(events, async beforeCompletion => {
    let current = true, rewrites = 0;
    const published: string[] = [];
    const controller = new AbortController();
    const entered = deferred<void>(), completion = deferred<void>();
    const run = executeRewrite(source, controller.signal, {
      rewrite: async raw => {
        rewrites++;
        assert.equal(raw, source.text);
        entered.resolve(); await completion.promise;
        return "Invented `new.json` with 99 dragons.";
      },
      isCurrent: () => current,
      publish: reading => { published.push(reading.text); },
    });
    await entered.promise;
    assert.deepEqual(published, []);
    for (const event of beforeCompletion) {
      if (event === "invalidate") current = false;
      if (event === "cancel") controller.abort();
    }
    completion.resolve();
    const result = await run;
    const shouldPublish = current && !controller.signal.aborted;
    assert.equal(rewrites, 1);
    assert.deepEqual(published, shouldPublish ? ["Invented `new.json` with 99 dragons."] : []);
    assert.equal(result.kind, controller.signal.aborted ? "cancelled" : current ? "accepted" : "stale");
  }), { seed: 0xdec1a, numRuns: 200 });
});
