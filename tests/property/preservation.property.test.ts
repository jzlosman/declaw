import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { rewriteText } from "../../src/domain/preservation.ts";

const exactSpan = fc.constantFrom(
  "config.json", "/tmp/declaw/output.md", "https://example.test/a?x=1",
  "npm test -- --run", "25 seconds", "`literal`", "\"exact words\"",
  "```ts\nconst value = 1;\n```", "[guide](https://example.test/guide)",
);
const prose = fc.array(
  fc.constantFrom("The ", "service ", "will ", "then ", "check ", "before ", "the ", "result. ", "\n"),
  { maxLength: 24 },
).map((parts) => parts.join(""));
const sourceWithSpan = fc.tuple(prose, exactSpan, prose).map(([before, exact, after]) => `${before}\n${exact}\n${after}`);
const sourceWithSpans = fc.array(exactSpan, { minLength: 1, maxLength: 8 }).map((spans) =>
  spans.map((span, index) => `Step ${index + 1}: preserve ${span}.`).join("\n"));

test("property: protected spans round-trip for generated technical inputs", async () => {
  await fc.assert(fc.asyncProperty(sourceWithSpan, async (source) => {
    let masked = "";
    const result = await rewriteText(source, async (value) => {
      masked = value;
      return value;
    });
    assert.equal(result, source);
    assert.match(masked, /⟦KEEP_[^⟧]+⟧/);
    assert.equal(masked.includes("config.json"), false);
    assert.equal(masked.includes("https://example.test"), false);
    assert.equal(masked.includes("npm test"), false);
  }), { numRuns: 120 });
});

test("property: protection is deterministic for the same source", async () => {
  await fc.assert(fc.asyncProperty(sourceWithSpans, async (source) => {
    let first = "", second = "";
    assert.equal(await rewriteText(source, async (value) => { first = value; return value; }), source);
    assert.equal(await rewriteText(source, async (value) => { second = value; return value; }), source);
    assert.equal(second, first);
  }), { numRuns: 100 });
});
