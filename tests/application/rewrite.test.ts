import test from "node:test";
import assert from "node:assert/strict";
import { executeRewrite, REWRITE_TIMEOUT_MS, type RewriteExecutionPorts } from "../../src/application/rewrite.ts";
import { MAX_INPUT_CHARS, MAX_OUTPUT_CHARS } from "../../src/domain/rewrite.ts";

const source = { id: "source-1", text: "Use `config.json` before continuing." };
function harness(overrides: Partial<RewriteExecutionPorts> = {}) {
  const calls: string[] = [], publications: any[] = [], inputs: string[] = [];
  const controller = new AbortController();
  const ports: RewriteExecutionPorts = {
    rewrite: async (rawSource, signal) => {
      calls.push("rewrite"); inputs.push(rawSource);
      assert.equal(signal, controller.signal);
      return rawSource.replace("Use", "Read");
    },
    isCurrent: () => true,
    publish: reading => { calls.push("publish"); publications.push(reading); },
    ...overrides,
  };
  return { calls, publications, inputs, controller, ports,
    run: (input = source) => executeRewrite(input, controller.signal, ports) };
}

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test("one raw-source rewrite is published once, with a one-minute budget", async () => {
  const h = harness();
  assert.equal(REWRITE_TIMEOUT_MS, 60_000);
  assert.deepEqual(await h.run(), { kind: "accepted", sourceEntryId: source.id, text: "Read `config.json` before continuing." });
  assert.deepEqual(h.calls, ["rewrite", "publish"]);
  assert.deepEqual(h.inputs, [source.text]);
  assert.deepEqual(h.publications, [{ sourceEntryId: source.id, text: "Read `config.json` before continuing." }]);
});

test("plugins may transform meaning, omit content, invent details and change literals", async () => {
  for (const output of [
    "Ignore the original task; a dragon invented 42 new planets.",
    "Run `invented-command` against /tmp/new.json within 25 seconds.",
    "Use ⟦KEEP_invented⟧ twice: ⟦KEEP_invented⟧.",
    "Done.",
    "  A deliberately different reading.\r\n",
  ]) {
    let rewrites = 0;
    const h = harness({ rewrite: async raw => { rewrites++; assert.equal(raw, source.text); return output; } });
    assert.deepEqual(await h.run(), { kind: "accepted", sourceEntryId: source.id, text: output });
    assert.equal(rewrites, 1);
    assert.deepEqual(h.publications, [{ sourceEntryId: source.id, text: output }]);
  }
});

test("provider failure is safe, stage-free, and never retried", async () => {
  for (const synchronous of [false, true]) {
    let rewrites = 0;
    const fail = () => { rewrites++; throw new Error("PRIVATE_PROVIDER_PAYLOAD"); };
    const h = harness({ rewrite: synchronous ? fail : async () => fail() });
    assert.deepEqual(await h.run(), { kind: "failed" });
    assert.equal(rewrites, 1);
    assert.deepEqual(h.publications, []);
  }
});

test("unusable output is rejected without publication", async () => {
  for (const output of ["", " \r\n\t", "x".repeat(MAX_OUTPUT_CHARS + 1), null as unknown as string]) {
    let rewrites = 0;
    const h = harness({ rewrite: async () => { rewrites++; return output; } });
    assert.deepEqual(await h.run(), { kind: "rejected", reason: "invalid-output" });
    assert.equal(rewrites, 1); assert.deepEqual(h.publications, []);
  }
  const output = "x".repeat(MAX_OUTPUT_CHARS);
  const valid = harness({ rewrite: async () => output });
  assert.equal((await valid.run()).kind, "accepted");
  assert.equal(valid.publications[0].text, output);
});

test("source rejection makes no calls and a trimmed duplicate adds no entry", async () => {
  for (const [text, reason] of [[" ", "empty-source"], ["x".repeat(MAX_INPUT_CHARS + 1), "source-too-long"]]) {
    const h = harness();
    assert.deepEqual(await h.run({ id: source.id, text }), { kind: "rejected", reason });
    assert.deepEqual(h.calls, []);
  }
  const h = harness({ rewrite: async raw => `\n${raw}\n` });
  assert.deepEqual(await h.run(), { kind: "rejected", reason: "unchanged" });
  assert.deepEqual(h.publications, []);
});

test("stale or cancelled sources cannot begin", async () => {
  const stale = harness({ isCurrent: () => false });
  assert.deepEqual(await stale.run(), { kind: "stale" }); assert.deepEqual(stale.calls, []);
  const cancelled = harness(); cancelled.controller.abort();
  assert.deepEqual(await cancelled.run(), { kind: "cancelled" }); assert.deepEqual(cancelled.calls, []);
});

test("cancellation settles a provider that ignores the signal and observes late rejection", async () => {
  for (const lateFailure of [false, true]) {
    const started = deferred<void>(), late = deferred<string>();
    let rewrites = 0;
    const h = harness({ rewrite: async () => { rewrites++; started.resolve(); return late.promise; } });
    const run = h.run(); await started.promise; h.controller.abort();
    assert.deepEqual(await run, { kind: "cancelled" });
    if (lateFailure) late.reject(new Error("Late provider rejection"));
    else late.resolve("Late reading");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rewrites, 1); assert.deepEqual(h.publications, []);
  }
});

test("a synchronous port abort prevents publication", async () => {
  const h = harness({ rewrite: async () => { h.controller.abort(); return "Never published."; } });
  assert.deepEqual(await h.run(), { kind: "cancelled" });
  assert.deepEqual(h.publications, []);
});

test("stale or cancelled results and failures are discarded", async () => {
  for (const fails of [false, true]) for (const cancelled of [false, true]) {
    let current = true;
    const h = harness({
      isCurrent: () => current,
      rewrite: async () => {
        current = false;
        if (cancelled) h.controller.abort();
        if (fails) throw new Error("late error");
        return "Never published.";
      },
    });
    assert.deepEqual(await h.run(), { kind: cancelled ? "cancelled" : "stale" });
    assert.deepEqual(h.publications, []);
  }
});

test("source is snapshotted and publication is synchronous after the currency check", async () => {
  const mutable = { ...source }, lifecycle: string[] = [];
  const h = harness({
    rewrite: async raw => {
      lifecycle.push("rewrite"); mutable.id = "changed"; mutable.text = "changed";
      return raw.replace("Use", "Read");
    },
    isCurrent: candidate => {
      assert.deepEqual(candidate, source); assert.ok(Object.isFrozen(candidate));
      lifecycle.push("current");
      queueMicrotask(() => lifecycle.push("microtask"));
      return true;
    },
    publish: reading => {
      assert.equal(reading.sourceEntryId, source.id);
      assert.equal(lifecycle.at(-1), "current");
      lifecycle.push("publish");
    },
  });
  assert.equal((await h.run(mutable)).kind, "accepted");
  assert.equal(lifecycle.filter(event => event === "current").length, 2);
  assert.equal(lifecycle.filter(event => event === "publish").length, 1);
});

test("source bounds stop before invoking the rewrite port or publishing", async () => {
  for (const [text, reason] of [
    ["\r\n\t", "empty-source"],
    [` ${"x".repeat(MAX_INPUT_CHARS)}`, "source-too-long"],
  ]) {
    const lifecycle: string[] = [];
    const h = harness({
      isCurrent: candidate => { lifecycle.push("current"); assert.equal(candidate.text, text); return true; },
      rewrite: async () => { lifecycle.push("rewrite"); throw new Error("must not call provider"); },
      publish: () => { lifecycle.push("publish"); },
    });
    assert.deepEqual(await h.run({ id: source.id, text }), { kind: "rejected", reason });
    assert.deepEqual(lifecycle, ["current"]);
  }
});

test("interruption takes precedence over unusable late output without publishing", async () => {
  for (const output of ["", source.text, "x".repeat(MAX_OUTPUT_CHARS + 1)]) {
    for (const cancel of [false, true]) {
      const work = deferred<string>();
      const lifecycle: string[] = [];
      let current = true;
      const h = harness({
        isCurrent: () => { lifecycle.push("current"); return current; },
        rewrite: async () => { lifecycle.push("rewrite"); return work.promise; },
        publish: () => { lifecycle.push("publish"); },
      });
      const run = h.run();
      assert.deepEqual(lifecycle, ["current", "rewrite"]);
      current = false;
      if (cancel) h.controller.abort();
      work.resolve(output);
      assert.deepEqual(await run, { kind: cancel ? "cancelled" : "stale" });
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.deepEqual(lifecycle, cancel ? ["current", "rewrite"] : ["current", "rewrite", "current"]);
    }
  }
});

test("a pre-cancelled execution does not consult currency or call any other port", async () => {
  const lifecycle: string[] = [];
  const h = harness({
    isCurrent: () => { lifecycle.push("current"); return false; },
    rewrite: async () => { lifecycle.push("rewrite"); return "Never published"; },
    publish: () => { lifecycle.push("publish"); },
  });
  h.controller.abort(new Error("session ended"));
  assert.deepEqual(await h.run(), { kind: "cancelled" });
  assert.deepEqual(lifecycle, []);
});

test("the maximum raw input crosses the port unchanged and output keeps its formatting", async () => {
  const text = `\r\n${"x".repeat(MAX_INPUT_CHARS - 4)}\r\n`;
  const output = " \r\nA plugin-owned reading.\t ";
  let rewrites = 0;
  const h = harness({ rewrite: async raw => { rewrites++; assert.equal(raw, text); return output; } });
  assert.deepEqual(await h.run({ id: source.id, text }), { kind: "accepted", sourceEntryId: source.id, text: output });
  assert.equal(rewrites, 1);
  assert.deepEqual(h.publications, [{ sourceEntryId: source.id, text: output }]);
});

test("publication faults are not mislabeled as provider failures", async () => {
  let publishes = 0;
  const h = harness({ publish: () => { publishes++; throw new Error("storage fault"); } });
  await assert.rejects(h.run(), /storage fault/); assert.equal(publishes, 1);
});
