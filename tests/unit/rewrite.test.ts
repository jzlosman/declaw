import test from "node:test";
import assert from "node:assert/strict";
import { MAX_INPUT_CHARS, MAX_OUTPUT_CHARS, prepareRewrite, finalizeRewrite } from "../../src/domain/rewrite.ts";

const plan = { original: 'Use `config.json` for 5 seconds. Keep "exact words".' };

test("preparation keeps raw source in a frozen original-only plan", () => {
  const original = ' \r\nUse `config.json`, ⟦KEEP_native⟧ and "café 日本語".\r\n ';
  const result = prepareRewrite(original);
  assert.deepEqual(result, { kind: "ready", plan: { original } });
  if (result.kind === "ready") assert.ok(Object.isFrozen(result.plan));
});

test("source bounds reject blank and oversized input but include the maximum", () => {
  assert.equal(MAX_INPUT_CHARS, 32_000);
  for (const source of ["", " \r\n\t"]) assert.deepEqual(prepareRewrite(source), { kind: "rejected", reason: "empty-source" });
  assert.equal(prepareRewrite("x".repeat(MAX_INPUT_CHARS)).kind, "ready");
  assert.deepEqual(prepareRewrite("x".repeat(MAX_INPUT_CHARS + 1)), { kind: "rejected", reason: "source-too-long" });
});

test("output bounds use raw length, include the maximum and reject non-text", () => {
  assert.equal(MAX_OUTPUT_CHARS, 64_000);
  for (const output of ["", " \r\n\t", "x".repeat(MAX_OUTPUT_CHARS + 1), ` ${"x".repeat(MAX_OUTPUT_CHARS)}`, null, undefined, 42]) {
    assert.deepEqual(finalizeRewrite(plan, output as string), { kind: "rejected", reason: "invalid-output" });
  }
  const output = "x".repeat(MAX_OUTPUT_CHARS);
  assert.deepEqual(finalizeRewrite(plan, output), { kind: "accepted", text: output });
});

test("only exact trimmed duplicates are rejected, not case or whitespace transformations", () => {
  assert.deepEqual(finalizeRewrite(plan, `\n ${plan.original}\t`), { kind: "rejected", reason: "unchanged" });
  for (const output of [plan.original.toUpperCase(), plan.original.replaceAll(" ", "  "), plan.original.replace("exact", "invented")]) {
    assert.deepEqual(finalizeRewrite(plan, output), { kind: "accepted", text: output });
  }
});

test("there is no token parsing, literal integrity check, or semantic gate", () => {
  for (const output of [
    "A wholly invented story about 99 dragons.",
    "Run `invented-command` on /tmp/new.json for 25 minutes.",
    'A new quote: "different words". https://new.example/',
    "⟦KEEP_unknown⟧ ⟦KEEP_unknown⟧ ⟦KEEP_broken",
    "```ts\r\nconst café = '日本語';\r\n```",
    "No.",
    " \r\nChanged text with retained surrounding whitespace.\t ",
  ]) assert.deepEqual(finalizeRewrite(plan, output), { kind: "accepted", text: output });
});
