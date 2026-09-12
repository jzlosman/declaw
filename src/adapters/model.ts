import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PlainError } from "../domain/rewrite.ts";
import { isolatedRequest } from "./pi.ts";
import { readModelChoice, saveModelChoice } from "./settings.ts";
import type { StyleCatalog, StyleId } from "../domain/styles.ts";

/** Exclude non-reasoning models and explicit remappings away from low. */
export function supportsLowThinking(model: Model<Api>): boolean {
  return model.reasoning && (model.thinkingLevelMap?.low === undefined || model.thinkingLevelMap.low === "low");
}

export async function chooseModel(ctx: ExtensionCommandContext, settingsPath: string, signal: AbortSignal): Promise<void> {
  const models = ctx.modelRegistry.getAvailable()
    .filter((model) => supportsLowThinking(model) && ctx.modelRegistry.hasConfiguredAuth(model))
    .sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`));
  if (models.length === 0) {
    ctx.ui.notify("No authenticated models with low thinking support are available. Use /login or refresh the model catalog.", "warning");
    return;
  }
  // The picker must also be usable to repair an invalid settings file.
  const current = await readModelChoice(settingsPath).catch(() => undefined);
  if (signal.aborted) return;
  const labels = models.map((model) => `${model.provider}/${model.id}` +
    (model.provider === current?.provider && model.id === current.modelId ? "  (current)" : ""));
  const selection = await ctx.ui.select("Plain rewrite model · low thinking", labels, { signal });
  if (!selection || signal.aborted) return;
  const model = models[labels.indexOf(selection)];
  if (!model) return;
  await saveModelChoice(settingsPath, { provider: model.provider, modelId: model.id });
  if (!signal.aborted) ctx.ui.notify(`/declaw now uses ${model.provider}/${model.id} with low thinking. Main agent settings are unchanged.`, "info");
}

/** Use Pi's provider-neutral low-thinking conversion without borrowing main-agent context. */
export async function completeRewrite(
  registry: ExtensionContext["modelRegistry"], model: Model<Api>, masked: string, signal: AbortSignal,
  style?: StyleId, catalog?: StyleCatalog,
) {
  signal.throwIfAborted();
  const provider = registry.getProvider(model.provider);
  if (!provider) throw new PlainError("The selected provider is unavailable. Run /declaw model to choose another.");
  // Resolves Pi's existing auth, including OAuth refresh, model headers, base URL and ambient env.
  const auth = await registry.getApiKeyAndHeaders(model);
  signal.throwIfAborted();
  if (!auth.ok) throw new PlainError("Authentication for the /declaw model failed. Check /login or choose another model with /declaw model.");
  const { context, options } = isolatedRequest(masked, model, signal, style, catalog);
  return provider.streamSimple(auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model, context, {
    ...options,
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
  }).result();
}
