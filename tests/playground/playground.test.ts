import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { build, compileSnapshot, countWords, scriptJson, validateSnapshot, renderEvidence, renderAttribution, DEFAULT_CASE_ID, type Snapshot, type Recording } from "../../playground/build.ts";

import { legacySnapshot } from './legacy-snapshot.ts';

const fixture = JSON.parse(await readFile(new URL("../../playground/samples.json", import.meta.url), "utf8")) as Snapshot;

test("all recordings compile without changing saved text", () => {
  const pristine = JSON.stringify(fixture), data = compileSnapshot(fixture);
  assert.equal(data.cases.length, 4);
  assert.equal(data.cases.flatMap(c => c.variants).length, fixture.version === 2 ? 24 : 20);
  assert.equal(JSON.stringify(fixture), pristine);
  assert.equal(data.defaultCaseId, "verbose-explanation");
  data.cases.forEach((c, i) => {
    assert.equal(c.original, fixture.cases[i].original);
    c.variants.forEach((v, j) => {
      assert.equal(v.text, fixture.cases[i].variants[j].text);
      assert.ok(v.beforeHtml.length && v.afterHtml.length && v.unifiedHtml.length);
      assert.ok(!v.beforeHtml.includes('<ins class="change">'));
      assert.ok(!v.afterHtml.includes('<del class="change">'));
    });
  });
  assert.ok(!("prompts" in data)); assert.ok(!("reviewFacts" in data.cases[0]));
});
test("Tradeoffs Plain's extra blank line regression fixture is not a wording change", () => {
  const snapshot = structuredClone(fixture);
  const tradeoffs = snapshot.cases.find(c => c.id === "comparison-table")!;
  tradeoffs.variants.find(v => v.mode === "plain")!.text = tradeoffs.original.replace("\n", "\n\n");
  const data = compileSnapshot(snapshot);
  const c = data.cases.find(c => c.id === "comparison-table")!;
  const plain = c.variants.find(v => v.mode === "plain")!;
  assert.notEqual(c.original, plain.text);
  assert.equal(plain.visibleChanged, false);
  assert.ok(!plain.unifiedHtml.includes('data-kind="remove"'));
  assert.ok(!plain.unifiedHtml.includes('data-kind="add"'));
});
test("snapshot validation rejects incomplete, reordered or non-synthetic evidence", () => {
  for (const mutate of [
    (s: Snapshot) => { s.cases[0].variants.pop(); },
    (s: Snapshot) => { s.cases.reverse(); },
    (s: Snapshot) => { s.modes[0].id = "auto"; },
    (s: Snapshot) => { (s as unknown as { synthetic: boolean }).synthetic = false; },
    (s: Snapshot) => { s.cases[0].original = ""; },
    (s: Snapshot) => { s.recordedAt = "not a date"; },
  ]) {
    const clone = structuredClone(fixture); mutate(clone);
    assert.throws(() => validateSnapshot(clone));
  }
});
const recording: Recording = {
  runId: "reviewed-run", recordedAt: "2026-09-12T10:00:00.000Z", model: "reviewed-model",
  promptVersion: "paseo-plain-v5", context: "answer", promptSource: "paseo-plain-v5",
};
test("recognizable modes carry source attribution without rewriting saved outputs", () => {
  const data = compileSnapshot(fixture);
  assert.deepEqual(data.modes.map(m => m.label), ["Paseo Plain", "Terse", "I Have ADHD", "Squirrel Mode", "ASD-STE100", ...(fixture.version === 2 ? ["Speak Like You Eat"] : [])]);
  assert.deepEqual(data.modes.map(m => m.source.label), ["scowalt/paseo-plain", "Terse", "ayghri/i-have-adhd", "thgMatajs/squirrel-mode", "danyuchn/asd-ste100-skill", ...(fixture.version === 2 ? ["wtfzambo/speak-like-you-eat"] : [])]);
  for (const mode of data.modes) {
    if (mode.id === "terse") assert.equal(mode.source.url, undefined);
    else assert.equal(mode.source.url, `https://github.com/${mode.source.label}`);
  }
});
test("mixed recordings preserve metadata and evidence attributes each output to its own run", () => {
  const snapshot = legacySnapshot(fixture);
  snapshot.cases[0].variants[0].recording = recording;
  const data = compileSnapshot(snapshot);
  const upstream = data.cases[0].variants[0], legacy = data.cases[1].variants[0];
  assert.deepEqual(upstream.recording, recording);
  assert.equal(upstream.attribution.relationship, "Prompt from");
  assert.equal(upstream.attribution.url, "https://github.com/scowalt/paseo-plain");
  assert.equal(legacy.attribution.relationship, "Inspired by");
  assert.equal(legacy.recording, undefined);
  assert.equal(data.cases[0].variants[1].attributionHtml, "Local preset");
  assert.equal(data.cases[0].variants[2].attribution.relationship, "Adapted from");
  assert.equal(upstream.text, fixture.cases[0].variants[0].text);
  assert.equal(legacy.text, fixture.cases[1].variants[0].text);
  const evidence = renderEvidence(snapshot, data);
  assert.match(evidence, /reviewed-model · 2026-09-12T10:00:00.000Z · paseo-plain-v5 · Run: reviewed-run/);
  assert.ok(evidence.includes(`Run: ${snapshot.runId}`));
  assert.match(evidence, /Context: answer · Prompt source: paseo-plain-v5/);
  assert.match(evidence, /Legacy snapshot recording/);
});
test("source validation rejects unsafe URLs and malformed source metadata", () => {
  for (const url of ["javascript:alert(1)", "http://github.com/a/b", "https://github.com.evil.test/a", "https://user:pass@github.com/a", "https://github.com:444/a", "//github.com/a", ""]) {
    const snapshot = structuredClone(fixture); snapshot.modes[0].source.url = url;
    assert.throws(() => validateSnapshot(snapshot), url);
  }
  for (const mutate of [
    (s: Snapshot) => { s.modes[0].source.label = " "; },
    (s: Snapshot) => { s.modes[0].source.relationship = "Prompt from" as any; },
    (s: Snapshot) => { s.modes[1].source.url = "https://github.com/a/b"; },
    (s: Snapshot) => { s.modes[0].source = null as any; },
  ]) {
    const snapshot = structuredClone(fixture); mutate(snapshot);
    assert.throws(() => validateSnapshot(snapshot));
  }
});
test("variant recording validation rejects partial, invalid and non-Plain records", () => {
  const invalid: unknown[] = [null, {}, ...Object.keys(recording).map(key => { const r = { ...recording } as Record<string, string>; delete r[key]; return r; }),
    ...["runId", "recordedAt", "model", "promptVersion"].map(key => ({ ...recording, [key]: " " })),
    { ...recording, recordedAt: "not a date" }, { ...recording, context: "tool-result" }, { ...recording, promptSource: "custom" }];
  for (const r of invalid) {
    const snapshot = structuredClone(fixture); snapshot.cases[0].variants[0].recording = r as Recording;
    assert.throws(() => validateSnapshot(snapshot));
  }
  const snapshot = structuredClone(fixture); snapshot.cases[0].variants[1].recording = recording;
  assert.throws(() => validateSnapshot(snapshot));
});
test("source text and evidence recording metadata are escaped outside model content", () => {
  const snapshot = legacySnapshot(fixture);
  snapshot.modes[2].source.label = '<img src=x onerror="alert(1)">';
  snapshot.cases[0].variants[0].recording = { ...recording, runId: "<script>bad</script>" };
  const data = compileSnapshot(snapshot);
  assert.match(data.cases[0].variants[2].attributionHtml, /&lt;img/);
  assert.doesNotMatch(data.cases[0].variants[2].attributionHtml, /<img/);
  assert.equal(renderAttribution({ label: 'a"b', url: 'https://github.com/a/b?x="', relationship: "Adapted from" }), 'Adapted from <a href="https://github.com/a/b?x=&quot;">a&quot;b</a>');
  const evidence = renderEvidence(snapshot, data);
  assert.match(evidence, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(data.cases[0].variants[2].afterHtml, /source-attribution/);
});
test("serialized browser data cannot escape its script and round-trips exactly", () => {
  const value = { text: '</script><script>alert("&")</script>\u2028\u2029' };
  const json = scriptJson(value);
  assert.ok(!/[<>&\u2028\u2029]/u.test(json)); assert.deepEqual(JSON.parse(json), value);
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(`globalThis.data = ${json}`, sandbox);
  assert.equal((sandbox.data as typeof value).text, value.text);
});
test("source word counts handle empty input and Unicode whitespace", () => {
  assert.equal(countWords(""), 0); assert.equal(countWords(" \n\t"), 0);
  assert.equal(countWords(" one\u2003two\nthree "), 3);
});
test("the demo has one changes toggle and no retired hold/method/marketing UI", async () => {
  const html = await readFile(new URL("../../playground/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../../playground/app.js", import.meta.url), "utf8");
  assert.equal((html.match(/data-diff\b/g) ?? []).length, 1);
  assert.match(html, /Show changes/);
  assert.doesNotMatch(html, /data-hold|data-lock|method-dialog|Source &amp; method|See what changed|original stays in reach|Recorded rewrite|No live model calls|Style changes can affect meaning/);
  assert.doesNotMatch(app, /setPointerCapture|pointerdown|pointerup|keyup|PlainInteraction/);
  assert.match(html, /id="unified-panel"/);
  assert.match(html, /href="https:\/\/github\.com\/jzlosman\/declaw#install"[^>]*>Try Declaw in Pi/);
  assert.match(html, /href="https:\/\/github\.com\/jzlosman\/declaw"[^>]*>View source on GitHub/);
});
test("production build is self-contained, deterministic and removes the retired controller", async () => {
  const output = await mkdtemp(join(tmpdir(), "plain-playground-test-"));
  try {
    await writeFile(join(output, "interaction.js"), "retired controller");
    await build(output);
    const html = await readFile(join(output, "index.html"), "utf8");
    const data = await readFile(join(output, "data.js"), "utf8");
    assert.ok(!html.includes("<!-- INITIAL_"));
    const initial = compileSnapshot(fixture).cases.find(c => c.id === DEFAULT_CASE_ID)!.variants[0];
    assert.ok(html.includes(`<p class="source-attribution" id="source-attribution">${initial.attributionHtml}</p>`));
    assert.equal((html.match(/id="source-attribution"/g) ?? []).length, 1);
    for (const [source, copy] of [["LICENSE", "paseo-plain-LICENSE"], ["Claudish-MIT.txt", "Claudish-MIT.txt"]]) {
      assert.equal(await readFile(join(output, "assets/licenses", copy), "utf8"), await readFile(new URL(`../../src/plugins/built-in/paseo-plain/upstream/${source}`, import.meta.url), "utf8"));
    }
    assert.equal(await readFile(join(output, "assets/licenses/speak-like-you-eat-LICENSE"), "utf8"),
      await readFile(new URL('../../licenses/speak-like-you-eat-LICENSE', import.meta.url), 'utf8'));
    assert.ok(html.includes(fixture.cases.find(c => c.id === DEFAULT_CASE_ID)!.original.slice(0, 70)));
    assert.ok(html.includes("connect-src 'none'"));
    const files = await readdir(output);
    for (const expected of ["index.html", "data.js", "styles.css", "app.js", "samples.json", "evidence.html", "credits.html", "assets", ".nojekyll"]) assert.ok(files.includes(expected));
    assert.ok(!files.includes("run.json")); assert.ok(!files.includes("interaction.js"));
    for (const page of [html, await readFile(join(output, "credits.html"), "utf8")]) {
      for (const match of page.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const target = match[1];
        if (target.startsWith("#") || target.startsWith("https:")) continue;
        assert.ok(!target.startsWith("/"), `root-relative path: ${target}`);
        await readFile(join(output, target));
      }
    }
    await build(output);
    assert.equal(await readFile(join(output, "data.js"), "utf8"), data);
    assert.equal(await readFile(join(output, "index.html"), "utf8"), html);
  } finally { await rm(output, { recursive: true, force: true }); }
});
