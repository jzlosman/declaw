import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { compileSnapshot, type Snapshot } from "../../playground/build.ts";
import { legacySnapshot } from './legacy-snapshot.ts';

const code = await readFile(new URL("../../playground/app.js", import.meta.url), "utf8");
const snapshot = JSON.parse(await readFile(new URL("../../playground/samples.json", import.meta.url), "utf8")) as Snapshot;
const data = compileSnapshot(snapshot);
type Handler = (event: any) => unknown;
class Element {
  dataset: Record<string, string> = {};
  attrs = new Map<string, string>(); handlers = new Map<string, Handler[]>();
  hidden = false; disabled = true; innerHTML = ""; textContent = ""; value = ""; scrollTop = 0; tabIndex = 0;
  children: Element[] = [];
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  removeAttribute(key: string) { this.attrs.delete(key); }
  addEventListener(type: string, handler: Handler) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]); }
  replaceChildren(...children: Element[]) { this.children = children; }
  closest() { return null; }
  async emit(type: string, event: object = {}) { await Promise.all((this.handlers.get(type) ?? []).map(h => h({ target: this, ...event }))); }
  click() { return this.emit("click"); }
}
// Controller-level DOM double; real touch scrolling is verified in Chromium, not simulated here.
function app(isMobile = false, compiled = data) {
  const ids = ["fatal-error", "announcer", "diff-label", "original-scroll", "rewrite-scroll", "unified-scroll", "original-panel", "rewrite-panel", "unified-panel", "original-content", "rewrite-content", "unified-content", "case-label", "rewrite-label", "source-attribution", "unchanged-note", "no-changes", "example-select", "mode-select", "tab-original", "tab-rewrite"];
  const nodes = new Map(ids.map(id => [`#${id}`, new Element()]));
  for (const key of [".documents", ".mobile-tabs", ".diff-legend", "[data-diff]"]) nodes.set(key, new Element());
  const get = (selector: string) => { const el = nodes.get(selector); assert.ok(el, selector); return el; };
  const cases = compiled.cases.map(c => { const el = new Element(); el.dataset.case = c.id; return el; });
  const modes = compiled.modes.map(m => { const el = new Element(); el.dataset.mode = m.id; return el; });
  const copies = ["original", "rewrite"].map(side => { const el = new Element(); el.dataset.copy = side; return el; });
  const tabs = ["original", "rewrite"].map(side => { const el = get(`#tab-${side}`); el.dataset.side = side; return el; });
  const scrolls = ["original", "rewrite", "unified"].map(side => get(`#${side}-scroll`));
  const groups: Record<string, Element[]> = { "[data-case]": cases, "[data-mode]": modes, "[data-copy]": copies, '[role="tab"]': tabs, ".reading-scroll": scrolls, "[data-interactive]": [...cases, ...modes, ...copies, ...tabs, get("[data-diff]"), get("#example-select"), get("#mode-select")] };
  const documentEvents = new Map<string, Handler>();
  const document = { body: { dataset: {} as Record<string, string> }, querySelector: get, querySelectorAll: (selector: string) => groups[selector] ?? [], createElement: () => new Element(), addEventListener: (name: string, fn: Handler) => documentEvents.set(name, fn) };
  const window = { scrollY: 0, scrollTo: ({ top }: { top: number }) => { window.scrollY = top; }, addEventListener: () => {} };
  const media = { matches: isMobile, addEventListener: () => {} };
  const location = { hash: "" };
  const clipboard: string[] = [];
  vm.runInNewContext(code, { PLAIN_DEMO: compiled, document, window, location, history: { replaceState: (_: unknown, __: string, url: string) => { location.hash = url; } }, matchMedia: () => media, URLSearchParams, navigator: { clipboard: { writeText: async (text: string) => { clipboard.push(text); } } }, setTimeout: () => 1, clearTimeout: () => {} });
  return { get, cases, modes, copies, tabs, document, documentEvents, window, clipboard, location };
}

test("one click shows combined changes; another returns to the two clean readings", async () => {
  const a = app();
  assert.equal(a.document.body.dataset.view, "reading");
  assert.equal(a.get("#case-label").textContent, "Long-form prose");
  assert.equal(a.get("#unified-panel").hidden, true);
  await a.get("[data-diff]").click();
  assert.equal(a.document.body.dataset.view, "changes");
  assert.equal(a.get(".documents").hidden, true);
  assert.equal(a.get(".mobile-tabs").hidden, true);
  assert.equal(a.get("#unified-panel").hidden, false);
  assert.equal(a.get("[data-diff]").attrs.get("aria-pressed"), "true");
  assert.match(a.get("#unified-content").innerHTML, /<del class="change">/);
  assert.match(a.get("#unified-content").innerHTML, /<ins class="change">/);
  assert.equal(a.get("#diff-label").textContent, "Hide changes");
  await a.get("[data-diff]").click();
  assert.equal(a.get(".documents").hidden, false);
  assert.equal(a.get("#diff-label").textContent, "Show changes");
});
test("D is no longer an inspection gesture", () => {
  const a = app(); let prevented = false;
  a.documentEvents.get("keydown")!({ key: "d", target: new Element(), preventDefault: () => { prevented = true; } });
  assert.equal(a.document.body.dataset.view, "reading");
  assert.equal(prevented, false);
});
test("mobile restores page positions and does not create focusable inner scrollers", async () => {
  const a = app(true);
  for (const side of ["original", "rewrite", "unified"]) assert.equal(a.get(`#${side}-scroll`).attrs.has("tabindex"), false);
  a.window.scrollY = 420;
  await a.get("[data-diff]").click();
  assert.equal(a.window.scrollY, 0);
  a.window.scrollY = 280;
  await a.get("[data-diff]").click();
  assert.equal(a.window.scrollY, 420);
  await a.get("[data-diff]").click();
  assert.equal(a.window.scrollY, 280);
});
test("unchanged Tradeoffs regression fixture is explicit and not presented as a failed or empty diff", async () => {
  const fixture = structuredClone(snapshot);
  const tradeoffs = fixture.cases.find(c => c.id === "comparison-table")!;
  tradeoffs.variants.find(v => v.mode === "plain")!.text = tradeoffs.original.replace("\n", "\n\n");
  const a = app(false, compileSnapshot(fixture));
  await a.cases.find(c => c.dataset.case === "comparison-table")!.click();
  assert.equal(a.get("#unchanged-note").hidden, false);
  assert.equal(a.get("#no-changes").hidden, false);
  assert.equal(a.get(".diff-legend").hidden, true);
  await a.get("[data-diff]").click();
  assert.match(a.get("#unified-content").innerHTML, /Processing options/);
  assert.equal(a.get("#announcer").textContent, "No wording changes.");
});
test("all examples and modes update both views, keeping the user's toggle choice", async () => {
  const a = app(); await a.get("[data-diff]").click();
  for (const c of a.cases) {
    await c.click();
    for (const m of a.modes) {
      await m.click();
      const expected = data.cases.find(item => item.id === c.dataset.case)!.variants.find(v => v.mode === m.dataset.mode)!;
      assert.equal(a.get("#rewrite-content").innerHTML, expected.afterHtml);
      assert.equal(a.get("#source-attribution").innerHTML, expected.attributionHtml);
      assert.equal(a.get("#rewrite-label").textContent, data.modes.find(item => item.id === m.dataset.mode)!.label);
      assert.equal(a.get("#unified-content").innerHTML, expected.unifiedHtml);
      assert.equal(a.document.body.dataset.view, "changes");
    }
  }
});
test("SLYE is selectable on desktop and mobile across every example", async () => {
  for (const mobile of [false, true]) {
    const a = app(mobile);
    assert.ok(a.modes.some(mode => mode.dataset.mode === "slye"));
    assert.ok(a.get("#mode-select").children.some(option => option.value === "slye"));
    for (const sample of data.cases) {
      await a.cases.find(button => button.dataset.case === sample.id)!.click();
      if (mobile) {
        a.get("#mode-select").value = "slye";
        await a.get("#mode-select").emit("change");
      } else await a.modes.find(button => button.dataset.mode === "slye")!.click();
      const expected = sample.variants.find(variant => variant.mode === "slye")!;
      assert.equal(a.get("#rewrite-label").textContent, "Speak Like You Eat");
      assert.equal(a.get("#rewrite-content").innerHTML, expected.afterHtml);
      assert.equal(a.get("#unified-content").innerHTML, expected.unifiedHtml);
      await a.copies[1].click();
      assert.equal(a.clipboard.at(-1), expected.text);
      assert.ok(a.location.hash.includes("mode=slye"));
    }
  }
});

test("native mobile selectors update the displayed example and mode", async () => {
  const a = app(true);
  a.get("#example-select").value = "ordered-recovery";
  await a.get("#example-select").emit("change");
  a.get("#mode-select").value = "terse";
  await a.get("#mode-select").emit("change");
  assert.equal(a.get("#case-label").textContent, "Recovery procedure");
  assert.equal(a.get("#rewrite-label").textContent, "Terse");
  assert.ok(a.location.hash.includes("mode=terse"));
});
test("attribution follows mixed legacy and upstream cases in reading and changes views", async () => {
  const fixture = legacySnapshot(snapshot);
  fixture.cases[0].variants[0].recording = { runId: "new-run", recordedAt: "2026-09-12T10:00:00Z", model: "model", promptVersion: "paseo-plain-v5", context: "answer", promptSource: "paseo-plain-v5" };
  for (const mobile of [false, true]) {
    const a = app(mobile, compileSnapshot(fixture));
    assert.match(a.get("#source-attribution").innerHTML, /^Inspired by <a href="https:\/\/github.com\/scowalt\/paseo-plain">scowalt\/paseo-plain<\/a>$/);
    await a.cases[0].click();
    assert.match(a.get("#source-attribution").innerHTML, /^Prompt from /);
    await a.get("[data-diff]").click();
    assert.match(a.get("#source-attribution").innerHTML, /^Prompt from /);
    await a.cases[1].click();
    assert.match(a.get("#source-attribution").innerHTML, /^Inspired by /);
    await a.modes[1].click();
    assert.equal(a.get("#source-attribution").innerHTML, "Local preset");
    for (const [index, label, repo] of [[2, "I Have ADHD", "ayghri/i-have-adhd"], [3, "Squirrel Mode", "thgMatajs/squirrel-mode"], [4, "ASD-STE100", "danyuchn/asd-ste100-skill"]] as const) {
      a.get("#mode-select").value = fixture.modes[index].id;
      await a.get("#mode-select").emit("change");
      assert.equal(a.get("#rewrite-label").textContent, label);
      assert.equal(a.get("#source-attribution").innerHTML, `Adapted from <a href="https://github.com/${repo}">${repo}</a>`);
    }
    assert.deepEqual(a.get("#mode-select").children.map(option => option.textContent), ["Paseo Plain", "Terse", "I Have ADHD", "Squirrel Mode", "ASD-STE100"]);
  }
});
test("copy retains exact Markdown instead of unified diff text", async () => {
  const a = app(); await a.get("[data-diff]").click(); await a.copies[1].click();
  const expected = data.cases.find(c => c.id === data.defaultCaseId)!.variants[0].text;
  assert.equal(a.clipboard[0], expected);
});
