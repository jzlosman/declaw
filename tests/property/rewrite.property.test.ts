import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { MAX_INPUT_CHARS, MAX_OUTPUT_CHARS, prepareRewrite, finalizeRewrite } from "../../src/domain/rewrite.ts";

const fragment = fc.oneof(fc.string({ maxLength: 120 }), fc.constantFrom(
  "`config.json`", "/tmp/declaw/output.md", "https://example.test/a?x=1",
  "npm test -- --run", "25 seconds", '"exact words"',
  "```ts\nconst value = 1;\n```", "~~~ts\r\nconst café = '🦀';\r\n~~~",
  "“café e\u0301 日本語 🦀”", "⟦KEEP_native_0⟧", "⟦KEEP_broken", "\r\n\t ",
));
const text = fc.array(fragment, { maxLength: 12 }).map(parts => parts.join("\n"));
const source = text.map(value => `Source:\n${value}`);
const output = text.map(value => `Transformation:\n${value}`);
const whitespace = fc.array(fc.constantFrom(" ", "\n", "\r", "\t", "\u2003"), { maxLength: 16 }).map(parts => parts.join(""));

test("property: arbitrary plugin transformations pass through unchanged with an original-only source snapshot", () => {
  fc.assert(fc.property(source, output, (original, transformed) => {
    const prepared = prepareRewrite(original);
    assert.equal(prepared.kind, "ready");
    if (prepared.kind !== "ready") throw new Error("Valid generated source rejected");
    assert.deepEqual(prepared.plan, { original });
    assert.ok(Object.isFrozen(prepared.plan));
    assert.deepEqual(finalizeRewrite(prepared.plan, transformed), { kind: "accepted", text: transformed });
  }), { numRuns: 200 });
});

test("property: surrounding whitespace cannot create duplicate entries", () => {
  fc.assert(fc.property(source, whitespace, whitespace, (original, before, after) => {
    assert.deepEqual(finalizeRewrite({ original }, before + original + after), { kind: "rejected", reason: "unchanged" });
  }), { numRuns: 150 });
});

test("property: bounds accept every sampled in-range length and reject overflow before trimming", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: MAX_INPUT_CHARS }),
    fc.integer({ min: 1, max: MAX_OUTPUT_CHARS }),
    fc.integer({ min: 1, max: 128 }),
    (inputLength, outputLength, overflow) => {
      const original = "s".repeat(inputLength), transformed = "t".repeat(outputLength);
      const prepared = prepareRewrite(original);
      assert.deepEqual(prepared, { kind: "ready", plan: { original } });
      assert.deepEqual(finalizeRewrite({ original }, transformed), { kind: "accepted", text: transformed });
      assert.deepEqual(prepareRewrite("s".repeat(MAX_INPUT_CHARS) + " ".repeat(overflow)), { kind: "rejected", reason: "source-too-long" });
      assert.deepEqual(finalizeRewrite({ original }, "t".repeat(MAX_OUTPUT_CHARS) + " ".repeat(overflow)), { kind: "rejected", reason: "invalid-output" });
    },
  ), { numRuns: 120 });
});

test("property: all generated blank sources and outputs are rejected", () => {
  fc.assert(fc.property(whitespace, blank => {
    assert.deepEqual(prepareRewrite(blank), { kind: "rejected", reason: "empty-source" });
    assert.deepEqual(finalizeRewrite({ original: "Source" }, blank), { kind: "rejected", reason: "invalid-output" });
  }), { numRuns: 100 });
});
