import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PlainError } from "./errors.ts";
import { completedText, isolatedModelRequest } from "./pi.ts";
import { readModelChoice, saveModelChoice } from "./settings.ts";
import { buildRewriteRequest, buildStyleRequest, DEFAULT_STYLE_ID, type StyleCatalog, type StyleId, type StyleRecord } from "../domain/styles.ts";
import { BUILTIN_CATALOG } from "../plugins/built-in/catalog.ts";
import type { StyleRequestPayload } from "../plugin-api.ts";
import type { RewriteExecutionPorts } from "../application/rewrite.ts";

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

/** Provider transport; auth is resolved afresh for each call. */
async function completeRequest(
  registry: ExtensionContext["modelRegistry"], model: Model<Api>, request: StyleRequestPayload, signal: AbortSignal,
) {
  signal.throwIfAborted();
  const provider = registry.getProvider(model.provider);
  if (!provider) throw new PlainError("The selected provider is unavailable. Run /declaw model to choose another.");
  // Resolves Pi's existing auth, including OAuth refresh, model headers, base URL and ambient env.
  const auth = await registry.getApiKeyAndHeaders(model);
  signal.throwIfAborted();
  if (!auth.ok) throw new PlainError("Authentication for the /declaw model failed. Check /login or choose another model with /declaw model.");
  const { context, options } = isolatedModelRequest(request, model, signal);
  return provider.streamSimple(auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model, context, {
    ...options,
    apiKey: auth.apiKey,
    headers: auth.headers,
    env: auth.env,
  }).result();
}

/** Single rewrite operation retained for adapter-level tooling and diagnostics. */
export async function completeRewrite(
  registry: ExtensionContext["modelRegistry"], model: Model<Api>, source: string, signal: AbortSignal,
  style: StyleId = DEFAULT_STYLE_ID, catalog: StyleCatalog = BUILTIN_CATALOG,
) {
  return completeRequest(registry, model, buildStyleRequest(source, style, catalog), signal);
}

/** Bind one model/style selection to an isolated single-call rewrite port. */
export function createRewriteGateway(
  registry: ExtensionContext["modelRegistry"], model: Model<Api>, style: StyleRecord,
): Pick<RewriteExecutionPorts, "rewrite"> {
  const selectedModel = Object.freeze({ ...model });
  const selectedStyle = Object.freeze({ ...style.style });
  const completeText = async (request: StyleRequestPayload, signal: AbortSignal): Promise<string> => {
    const response = await completeRequest(registry, selectedModel, request, signal);
    const text = completedText(response);
    if (text === undefined) throw new PlainError("The model did not return complete text. The original is unchanged.");
    return text;
  };
  return {
    rewrite: (source, signal) => completeText(buildRewriteRequest(source, selectedStyle), signal),
  };
}
