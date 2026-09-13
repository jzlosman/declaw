import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { REWRITE_MODEL, REWRITE_PROVIDER } from "../domain/rewrite.ts";
import { PlainError } from "./errors.ts";
import { DEFAULT_STYLE_ID, isStyleId, type PluginStatus, type StyleCatalog, type StyleId } from "../domain/styles.ts";
import { BUILTIN_CATALOG } from "../plugins/built-in/catalog.ts";

export interface ModelChoice {
  provider: string;
  modelId: string;
}

export const DEFAULT_MODEL: ModelChoice = { provider: REWRITE_PROVIDER, modelId: REWRITE_MODEL };

export async function readModelChoice(path: string): Promise<ModelChoice> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_MODEL };
    throw new PlainError("Could not read /declaw settings. Check the permissions on its settings file.");
  }
  try {
    const value = JSON.parse(contents);
    if (value?.version !== 1 || typeof value.provider !== "string" || !value.provider.trim() ||
        typeof value.modelId !== "string" || !value.modelId.trim()) throw new Error("invalid-settings");
    return { provider: value.provider, modelId: value.modelId };
  } catch {
    throw new PlainError("The /declaw settings file is invalid. Run /declaw model to choose and save a model again.");
  }
}

export async function readStyleChoice(path: string, catalog: StyleCatalog = BUILTIN_CATALOG): Promise<StyleId> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_STYLE_ID;
    throw new PlainError("Could not read /declaw style settings. Check the permissions on its style file.");
  }
  try {
    const value = JSON.parse(contents);
    if (value?.version !== 1 || typeof value.style !== "string" || !isStyleId(value.style) ||
        !catalog.has(value.style, { includeDisabled: true })) {
      throw new Error("invalid-style");
    }
    return value.style;
  } catch {
    throw new PlainError("The /declaw style settings file is invalid. Run /declaw style to choose and save a style again.");
  }
}

export async function saveStyleChoice(path: string, style: StyleId, catalog: StyleCatalog = BUILTIN_CATALOG): Promise<void> {
  if (!isStyleId(style) || !catalog.has(style, { includeDisabled: true })) throw new PlainError("Unknown /declaw style. Run /declaw style to choose an available style.");
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify({ version: 1, style }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch {
    throw new PlainError("Could not save the /declaw style choice. Check the permissions on its settings directory.");
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export type PluginStatuses = Record<string, PluginStatus>;

export async function readPluginStatuses(path: string): Promise<PluginStatuses> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new PlainError("Could not read /declaw plugin settings. Check the permissions on its settings file.");
  }
  try {
    const value = JSON.parse(contents);
    if (value?.version !== 1 || value.plugins === null || typeof value.plugins !== "object" || Array.isArray(value.plugins)) {
      throw new Error("invalid-plugin-settings");
    }
    const statuses: PluginStatuses = {};
    for (const [id, status] of Object.entries(value.plugins)) {
      if (!isStyleId(id) || (status !== "active" && status !== "disabled")) throw new Error("invalid-plugin-settings");
      statuses[id] = status as PluginStatus;
    }
    return statuses;
  } catch {
    throw new PlainError("The /declaw plugin settings file is invalid. Run /declaw manage to repair it.");
  }
}

export async function savePluginStatuses(path: string, statuses: PluginStatuses): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify({ version: 1, plugins: statuses }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch {
    throw new PlainError("Could not save the /declaw plugin settings. Check the permissions on its settings directory.");
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function saveModelChoice(path: string, choice: ModelChoice): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify({ version: 1, ...choice }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } catch {
    throw new PlainError("Could not save the /declaw model choice. Check the permissions on its settings directory.");
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
