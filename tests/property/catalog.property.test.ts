import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { StyleCatalog } from "../../src/domain/styles.ts";
import type { DeclawStylePlugin } from "../../src/plugin-api.ts";

const suffix = fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 1, maxLength: 10 })
  .map((letters) => letters.join(""));
const statuses = fc.array(fc.constantFrom("active", "disabled" as const), { minLength: 1, maxLength: 12 });

function plugin(id: string): DeclawStylePlugin {
  return {
    apiVersion: 1,
    id,
    name: `${id} styles`,
    version: "1.0.0",
    styles: [{
      id: `${id}/default`,
      name: "Generated style",
      relationship: "Local preset",
      instructions: "Use the generated style without changing meaning.",
      buildUserPayload: (answer) => JSON.stringify({ assistantMessage: answer }),
    }],
  };
}

test("property: every generated plugin is discoverable by its namespaced style", () => {
  fc.assert(fc.property(suffix, (idSuffix) => {
    const id = `generated-${idSuffix}`;
    const catalog = new StyleCatalog([plugin(id)]);
    assert.equal(catalog.get(`${id}/default`)?.pluginId, id);
    assert.deepEqual(catalog.activeStyleIds(), [`${id}/default`]);
  }), { numRuns: 120 });
});

test("property: plugin status is an invariant over every status sequence", () => {
  fc.assert(fc.property(statuses, (sequence) => {
    const id = "generated-status";
    const catalog = new StyleCatalog([plugin(id)]);
    for (const status of sequence) catalog.setPluginStatus(id, status);
    const finalStatus = sequence.at(-1);
    assert.equal(catalog.listPlugins()[0].status, finalStatus);
    assert.equal(catalog.activeStyleIds().length, finalStatus === "active" ? 1 : 0);
    assert.equal(catalog.get(`${id}/default`, { includeDisabled: true })?.status, finalStatus);
  }), { numRuns: 100 });
});
