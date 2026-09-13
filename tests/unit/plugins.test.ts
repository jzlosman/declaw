import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_STYLE_IDS,
  DEFAULT_REWRITE_GUIDANCE,
  StyleCatalog,
  buildStyleRequest,
} from "../../src/domain/styles.ts";
import { BUILTIN_CATALOG } from "../../src/plugins/built-in/catalog.ts";
import {
  getRegisteredDeclawPlugins,
  registerDeclawPlugin,
  type DeclawStylePlugin,
  type DeclawStyleDefinition,
} from "../../src/plugin-api.ts";
import { readPluginStatuses, savePluginStatuses } from "../../src/adapters/settings.ts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const pirateStyle: DeclawStyleDefinition = {
  id: "pirate/pirate",
  name: "Pirate",
  description: "A salty but faithful rewrite.",
  relationship: "Local preset",
  instructions: "Use pirate-flavored wording without changing meaning.",
  buildUserPayload: (answer) => JSON.stringify({ assistantMessage: answer }),
};
const piratePlugin: DeclawStylePlugin = {
  apiVersion: 1,
  id: "pirate",
  name: "Pirate styles",
  version: "1.0.0",
  status: "active",
  styles: [pirateStyle],
};

 test("catalog exposes built-ins as plugins and accepts an active external plugin", () => {
  assert.equal(BUILTIN_STYLE_IDS.length, 6);
  const catalog = new StyleCatalog();
  for (const plugin of BUILTIN_CATALOG.listPlugins().map(({ plugin }) => plugin)) catalog.register(plugin);
  catalog.register(piratePlugin);
  assert.equal(catalog.get("pirate/pirate")?.style.name, "Pirate");
  assert.deepEqual(catalog.activeStyleIds(), [...BUILTIN_STYLE_IDS, "pirate/pirate"]);
  assert.equal(catalog.listPlugins().find((p) => p.plugin.id === "pirate")?.status, "active");
 });

test("disabled plugin styles remain listable but cannot be resolved for rewriting", () => {
  const catalog = new StyleCatalog([piratePlugin]);
  catalog.setPluginStatus("pirate", "disabled");
  assert.equal(catalog.listPlugins()[0].status, "disabled");
  assert.equal(catalog.get("pirate/pirate"), undefined);
  assert.equal(catalog.get("pirate/pirate", { includeDisabled: true })?.style.name, "Pirate");
  assert.deepEqual(catalog.activeStyleIds(), []);
});

test("catalog rejects duplicate plugins and styles outside their plugin namespace", () => {
  const catalog = new StyleCatalog([piratePlugin]);
  assert.throws(() => catalog.register(piratePlugin), /already registered/);
  assert.throws(() => catalog.register({ ...piratePlugin, id: "other", styles: [pirateStyle] }), /namespace/);
  for (const plugin of BUILTIN_CATALOG.listPlugins().map(({ plugin }) => plugin)) catalog.register(plugin);
  assert.throws(() => catalog.register({ ...piratePlugin, id: "builtin/other", styles: [{ ...pirateStyle, id: "plain" }] }), /already registered/);
});

test("plugin request receives advisory defaults before its own instructions and raw source", () => {
  const catalog = new StyleCatalog([piratePlugin]);
  const request = buildStyleRequest("Keep `config.json`.", "pirate/pirate", catalog);
  assert.ok(request.system.startsWith(DEFAULT_REWRITE_GUIDANCE));
  assert.ok(request.system.indexOf(pirateStyle.instructions) > request.system.indexOf(DEFAULT_REWRITE_GUIDANCE));
  assert.match(request.system, /pirate-flavored/);
  assert.equal(request.user, JSON.stringify({ assistantMessage: "Keep `config.json`." }));
});

test("registration bridge is idempotent and exposes plugins across extension module roots", () => {
  const before = getRegisteredDeclawPlugins().length;
  registerDeclawPlugin(piratePlugin);
  registerDeclawPlugin(piratePlugin);
  const registered = getRegisteredDeclawPlugins();
  assert.equal(registered.filter((plugin) => plugin.id === "pirate").length, 1);
  assert.ok(registered.length >= before);
});

test("plugin status settings are versioned, private, and round-trip active or disabled states", async () => {
  const directory = await mkdtemp(join(tmpdir(), "declaw-plugin-settings-"));
  try {
    const path = join(directory, "plugins.json");
    assert.deepEqual(await readPluginStatuses(path), {});
    await savePluginStatuses(path, { pirate: "disabled", "builtin/plain": "active" });
    assert.deepEqual(await readPluginStatuses(path), { pirate: "disabled", "builtin/plain": "active" });
    assert.match(await readFile(path, "utf8"), /\"version\": 1/);
    await assert.rejects(readPluginStatuses(directory), /Could not read/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("built-in catalog remains independent from the mutable runtime catalog", () => {
  const catalog = new StyleCatalog(BUILTIN_CATALOG.listPlugins().map(({ plugin }) => plugin));
  catalog.setPluginStatus("builtin/plain", "disabled");
  assert.equal(BUILTIN_CATALOG.get("plain")?.style.name, "Paseo Plain");
});
