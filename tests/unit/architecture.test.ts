import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import * as rewriting from "../../src/domain/rewrite.ts";
import * as styles from "../../src/domain/styles.ts";

// A dependency guard, not a general proof of purity or a sandbox for trusted plugins.
test("domain and application dependencies point inward, without Pi or platform imports", async () => {
  for (const layer of ["domain", "application"] as const) {
    const directory = new URL(`../../src/${layer}/`, import.meta.url);
    for (const file of await readdir(directory)) {
      if (!file.endsWith(".ts")) continue;
      const source = await readFile(new URL(file, directory), "utf8");
      for (const match of source.matchAll(/^(?:import|export)\s+(type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/gm)) {
        const [, typeOnly, dependency] = match;
        const allowed = dependency.startsWith("./") || (layer === "application" && dependency.startsWith("../domain/")) ||
          (layer === "domain" && !!typeOnly && dependency === "../plugin-api.ts");
        assert.ok(allowed, `${layer}/${file} imports an outer-layer dependency: ${dependency}`);
      }
      assert.doesNotMatch(source, /\bimport\s*\(/, `${layer}/${file}: dynamic platform loading belongs in adapters`);
    }
  }
});

test("domain operations are synchronous; model orchestration lives in the application", () => {
  for (const module of [rewriting, styles]) {
    for (const [name, value] of Object.entries(module)) {
      if (typeof value === "function") assert.notEqual(value.constructor.name, "AsyncFunction", `${name} must not orchestrate effects`);
    }
  }
});
