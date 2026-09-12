import { readFile, mkdir, writeFile, copyFile, cp, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderComparison } from "./markdown.ts";
import { renderUnifiedDiff } from "./unified.ts";
import { STYLE_IDS } from "../src/domain/styles.ts";

export const DEFAULT_CASE_ID = "verbose-explanation";

export interface Source {
  label: string; url?: string; relationship: "Inspired by" | "Adapted from" | "Local preset";
}
export interface Recording {
  runId: string; recordedAt: string; model: string; promptVersion: string;
  context: "answer"; promptSource: "paseo-plain-v5" | "plain-lab-2" | "package-v4";
  systemHash?: string;
}
export type Attribution = Omit<Source, "relationship"> & { relationship: Source["relationship"] | "Prompt from" };
export interface Snapshot {
  version: 1 | 2; recordedAt: string; runId: string; model: string; thinking: "low";
  promptVersion: string; synthetic: true;
  modes: { id: string; label: string; description: string; source: Source }[];
  cases: {
    id: string; label: string; title: string; sourceTitle: string; request: string;
    original: string; mustKeep: string[]; reviewFacts: string[]; pitfalls: string[];
    variants: { mode: string; text: string; recording?: Recording }[];
  }[];
}
const sourceDir = dirname(fileURLToPath(import.meta.url));
const CASES = ["local-vs-prod", "verbose-explanation", "ordered-recovery", "comparison-table"];
const LEGACY_MODES = STYLE_IDS.filter(id => id !== "slye");
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
function assertText(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 32_000) throw new Error(`Invalid ${name}: expected nonempty text, at most 32,000 characters`);
}
export function validateSnapshot(value: unknown): asserts value is Snapshot {
  if (!value || typeof value !== "object") throw new Error("Invalid snapshot");
  const s = value as Snapshot;
  if (![1, 2].includes(s.version) || s.synthetic !== true || s.thinking !== "low") throw new Error("Expected a synthetic snapshot with low thinking");
  const modes = s.version === 2 ? STYLE_IDS : LEGACY_MODES;
  for (const key of ["recordedAt", "runId", "model", "promptVersion"] as const) assertText(s[key], key);
  if (!Number.isFinite(Date.parse(s.recordedAt))) throw new Error("Invalid recording date");
  if (!Array.isArray(s.modes) || JSON.stringify(s.modes.map(m => m.id)) !== JSON.stringify(modes)) throw new Error("Expected the packaged styles in order");
  for (const mode of s.modes) {
    assertText(mode.label, "mode label"); assertText(mode.description, "mode description");
    const source = mode.source;
    if (!source || !["Inspired by", "Adapted from", "Local preset"].includes(source.relationship)) throw new Error("Invalid source relationship");
    assertText(source.label, "source label");
    if (source.url !== undefined) {
      assertText(source.url, "source URL");
      const url = new URL(source.url);
      if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port) throw new Error("Expected HTTPS github.com source URL without credentials");
    }
    if (mode.id === "terse" && (source.relationship !== "Local preset" || source.url !== undefined)) throw new Error("Terse must be a local preset without a URL");
  }
  if (!Array.isArray(s.cases) || JSON.stringify(s.cases.map(c => c.id)) !== JSON.stringify(CASES)) throw new Error("Expected the four curated cases in order");
  for (const c of s.cases) {
    for (const key of ["label", "title", "sourceTitle", "request", "original"] as const) assertText(c[key], key);
    for (const key of ["mustKeep", "reviewFacts", "pitfalls"] as const) {
      if (!Array.isArray(c[key])) throw new Error(`Invalid ${key}`);
      c[key].forEach(t => assertText(t, key));
    }
    if (!Array.isArray(c.variants) || JSON.stringify(c.variants.map(v => v.mode)) !== JSON.stringify(modes)) throw new Error(`Incomplete variants: ${c.id}`);
    c.variants.forEach(v => {
      assertText(v.text, "saved rewrite");
      if (s.version === 2 && (v.recording?.promptSource !== "package-v4" || !/^[a-f0-9]{64}$/.test(v.recording.systemHash ?? ""))) throw new Error("Current demos require packaged-engine recordings and prompt hashes for every style");
      if (v.recording !== undefined) {
        const r = v.recording;
        if (!r || r.context !== "answer" || !["paseo-plain-v5", "plain-lab-2", "package-v4"].includes(r.promptSource) ||
            (r.promptSource !== "package-v4" && v.mode !== "plain")) throw new Error("Expected a recognized package recording");
        for (const key of ["recordedAt", "runId", "model", "promptVersion"] as const) assertText(r[key], `recording ${key}`);
        if (!Number.isFinite(Date.parse(r.recordedAt))) throw new Error("Invalid variant recording date");
      }
    });
  }
}
export function renderAttribution(source: Attribution): string {
  if (source.relationship === "Local preset") return "Local preset";
  return `${escapeHtml(source.relationship)} ${source.url ? `<a href="${escapeHtml(source.url)}">${escapeHtml(source.label)}</a>` : escapeHtml(source.label)}`;
}
export function compileSnapshot(snapshot: Snapshot) {
  validateSnapshot(snapshot);
  return {
    version: snapshot.version, recordedAt: snapshot.recordedAt, runId: snapshot.runId,
    defaultCaseId: DEFAULT_CASE_ID,
    model: snapshot.model, promptVersion: snapshot.promptVersion, thinking: snapshot.thinking, synthetic: true,
    modes: snapshot.modes,
    cases: snapshot.cases.map(c => ({
      id: c.id, label: c.label, title: c.title, request: c.request, original: c.original,
      originalWords: countWords(c.original),
      variants: c.variants.map(v => {
        const comparison = renderComparison(c.original, v.text);
        const source = snapshot.modes.find(m => m.id === v.mode)!.source;
        const attribution: Attribution = v.recording?.promptSource === "paseo-plain-v5"
          ? { label: "scowalt/paseo-plain", url: "https://github.com/scowalt/paseo-plain", relationship: "Prompt from" }
          : { ...source, ...(v.mode === "plain" && v.recording?.promptSource !== "package-v4" ? { relationship: "Inspired by" as const } : {}) };
        return {
          mode: v.mode, text: v.text, words: countWords(v.text),
          ...(v.recording ? { recording: { ...v.recording } } : {}),
          attribution, attributionHtml: renderAttribution(attribution),
          ...comparison,
          ...renderUnifiedDiff(comparison.beforeHtml, comparison.afterHtml),
          missingExactText: c.mustKeep.filter(text => !v.text.includes(text)),
        };
      }),
    })),
  };
}
export function renderEvidence(snapshot: Snapshot, compiled = compileSnapshot(snapshot)): string {
  const esc = escapeHtml;
  const sections = snapshot.cases.map((c, i) => {
    const compiledCase = compiled.cases[i];
    return `<section id="${esc(c.id)}"><h2>${esc(c.label)}</h2><p>${esc(c.sourceTitle)}</p>
      <details><summary>Request, review facts, and known pitfalls</summary><h3>Request</h3><p>${esc(c.request)}</p><h3>Review facts</h3><ul>${c.reviewFacts.map(f => `<li>${esc(f)}</li>`).join("")}</ul><h3>Watch for</h3><ul>${c.pitfalls.map(f => `<li>${esc(f)}</li>`).join("")}</ul></details>
      ${compiledCase.variants.map(v => `<details class="evidence-variant"><summary>${esc(snapshot.modes.find(m => m.id === v.mode)!.label)} <span>${compiledCase.originalWords} → ${v.words} words</span></summary>
        <p class="source-attribution">${v.attributionHtml}</p>
        <p>${esc((v.recording ?? snapshot).model)} · ${esc((v.recording ?? snapshot).recordedAt)} · ${esc((v.recording ?? snapshot).promptVersion)} · Run: ${esc((v.recording ?? snapshot).runId)}${v.recording ? ` · Context: ${esc(v.recording.context)} · Prompt source: ${esc(v.recording.promptSource)}` : " · Legacy snapshot recording"}</p>
        <p class="check-note">${v.missingExactText.length ? `Missing exact strings: ${v.missingExactText.map(esc).join(", ")}` : "Required exact strings present. This is not a semantic-fidelity verdict."} ${v.changed ? "" : "Output is identical to the original."}</p>
        <div class="evidence-pair"><div><h3>Original</h3><div class="prose">${v.beforeHtml}</div></div><div><h3>${esc(snapshot.modes.find(m => m.id === v.mode)!.label)}</h3><div class="prose">${v.afterHtml}</div></div></div></details>`).join("")}</section>`;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'"><title>Declaw — recorded evidence</title><link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="evidence.css"></head><body class="evidence-page" data-inspecting="true"><main><a class="back-link" href="index.html">← Back to playground</a><h1>Recorded evidence.</h1><p>Four synthetic inputs. ${snapshot.cases.reduce((total, c) => total + c.variants.length, 0)} saved model outputs, preserved verbatim. This static view keeps the review facts next to the comparisons; the private lab remains separate.</p><p>Recording details are listed per output. Older outputs use the snapshot’s original recording details.</p><p>Strike-through marks source deletions; underlines mark rewrite additions. Moves can appear on both sides. Formatting-only edits may not be marked. Exact strings and word counts cannot establish equivalent meaning.</p><p><a href="samples.json" download>Download the source snapshot</a></p><nav aria-label="Evidence examples">${snapshot.cases.map(c => `<a href="#${esc(c.id)}">${esc(c.label)}</a>`).join("")}</nav>${sections}</main></body></html>`;
}
export function renderCredits(snapshot: Snapshot, template: string): string {
  const plain = snapshot.cases.flatMap(c => c.variants.filter(v => v.mode === "plain"));
  const packaged = snapshot.version === 2 && plain.length > 0 && plain.every(v => v.recording?.promptSource === "package-v4");
  const legacy = plain.some(v => !v.recording || v.recording.promptSource === "plain-lab-2");
  const provenance = packaged
    ? "These recordings use the installed package’s six styles, shared meaning-preservation rules and exact-text protection. Paseo Plain and Speak Like You Eat combine pinned source prompts with those shared rules."
    : legacy
      ? "This snapshot includes Plain recordings from an earlier local prompt, not Scott’s exact writing prompt. The historical four-call upstream comparison failed fidelity review and was not promoted. Each output’s attribution identifies its source."
      : "Plain recordings marked “Prompt from” use the pinned upstream writing prompt. Each output’s recording details identify its source.";
  const replacements = {
    "<!-- RECORDING_PROVENANCE -->": `<p>${provenance} See <a href="evidence.html">recorded evidence</a>. Source identity does not guarantee preserved meaning.</p>`,
    "<!-- SLYE_CREDIT -->": snapshot.modes.some(m => m.id === "slye")
      ? '<p>Speak Like You Eat uses the stable v1.1.0 prompt from <a href="https://github.com/wtfzambo/speak-like-you-eat">wtfzambo/speak-like-you-eat</a>, with the package’s shared preservation rules. <a href="assets/licenses/speak-like-you-eat-LICENSE">MIT license</a>.</p>' : "",
  };
  for (const [marker, text] of Object.entries(replacements)) {
    if (template.split(marker).length !== 2) throw new Error(`Expected one credits marker: ${marker}`);
    template = template.replace(marker, () => text);
  }
  return template;
}
export async function build(outputDir = resolve(sourceDir, "../dist/playground")): Promise<string> {
  const source = await readFile(resolve(sourceDir, "samples.json"), "utf8");
  const snapshot: unknown = JSON.parse(source);
  validateSnapshot(snapshot);
  const compiled = compileSnapshot(snapshot);
  const first = compiled.cases.find(c => c.id === DEFAULT_CASE_ID)!, variant = first.variants[0];
  let html = await readFile(resolve(sourceDir, "index.html"), "utf8");
  const replacements: Record<string, string> = {
    "<!-- INITIAL_SOURCE -->": variant.beforeHtml,
    "<!-- INITIAL_REWRITE -->": variant.afterHtml,
    "<!-- INITIAL_ATTRIBUTION -->": variant.attributionHtml,
    "<!-- MODE_BUTTONS -->": snapshot.modes.map((mode, index) => `<button class="rail-button" data-mode="${escapeHtml(mode.id)}" aria-pressed="${index === 0}" data-interactive disabled><svg class="icon" aria-hidden="true"><use href="#${({ plain: 'i-document', terse: 'i-prose', adhd: 'i-action', squirrel: 'i-branch', ste: 'i-code', slye: 'i-document' } as Record<string, string>)[mode.id]}"/></svg>${escapeHtml(mode.label)}</button>`).join('\n'),
  };
  for (const [marker, text] of Object.entries(replacements)) {
    if (html.split(marker).length !== 2) throw new Error(`Expected one template marker: ${marker}`);
    html = html.replace(marker, () => text);
  }
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "index.html"), html);
  await writeFile(resolve(outputDir, "data.js"), `"use strict";\nglobalThis.PLAIN_DEMO = ${scriptJson(compiled)};\n`);
  await writeFile(resolve(outputDir, "samples.json"), source);
  await writeFile(resolve(outputDir, "evidence.html"), renderEvidence(snapshot, compiled));
  await writeFile(resolve(outputDir, ".nojekyll"), "");
  await writeFile(resolve(outputDir, "credits.html"), renderCredits(snapshot, await readFile(resolve(sourceDir, "credits.html"), "utf8")));
  for (const file of ["styles.css", "app.js", "evidence.css"]) await copyFile(resolve(sourceDir, file), resolve(outputDir, file));
  // Remove the retired hold/lock controller from existing build directories too.
  await rm(resolve(outputDir, "interaction.js"), { force: true });
  await cp(resolve(sourceDir, "assets"), resolve(outputDir, "assets"), { recursive: true });
  await copyFile(resolve(sourceDir, "../licenses/speak-like-you-eat-LICENSE"), resolve(outputDir, "assets/licenses/speak-like-you-eat-LICENSE"));
  return outputDir;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().then(path => console.log(`Static playground: ${path}/index.html`)).catch(error => { console.error(error); process.exitCode = 1; });
}
