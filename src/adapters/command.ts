import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";
import type { StyleCatalog } from "../domain/styles.ts";
import { ENTRY_TYPE, MAX_INPUT_CHARS, POLICY_VERSION, REWRITE_THINKING, type PlainEntry } from "../domain/rewrite.ts";
import { PlainError, rewriteFailureMessage } from "./errors.ts";
import { latestAnswer } from "./pi.ts";
import { executeRewrite, REWRITE_TIMEOUT_MS } from "../application/rewrite.ts";
import { chooseModel, createRewriteGateway, supportsLowThinking } from "./model.ts";
import { readModelChoice, readPluginStatuses, readStyleChoice, savePluginStatuses, saveStyleChoice } from "./settings.ts";

export interface DeclawCommandDependencies {
  readonly pi: ExtensionAPI;
  readonly catalog: StyleCatalog;
  readonly settingsPath: string;
  readonly stylePath: string;
  readonly pluginPath: string;
}

export interface DeclawCommandController {
  readonly command: Parameters<ExtensionAPI["registerCommand"]>[1];
  readonly cancel: () => void;
}

type Result = { text: string } | { error: string } | { cancelled: true } | { stale: true };

/** Pi command adapter. It translates UI/session effects into application ports. */
export function createDeclawCommand({ pi, catalog, settingsPath, stylePath, pluginPath }: DeclawCommandDependencies): DeclawCommandController {
  let active: AbortController | undefined;
  let pluginStatuses: Record<string, "active" | "disabled"> = {};
  let pluginStatusesLoaded = false;

  const syncPluginStatuses = async (repair = false) => {
    if (!pluginStatusesLoaded) {
      try {
        pluginStatuses = await readPluginStatuses(pluginPath);
      } catch (error) {
        if (!repair) throw error;
        pluginStatuses = {};
      }
      pluginStatusesLoaded = true;
    }
    for (const record of catalog.listPlugins()) {
      const status = pluginStatuses[record.plugin.id];
      if (status && status !== record.status) catalog.setPluginStatus(record.plugin.id, status);
    }
  };

  const cancel = () => active?.abort();
  const command: Parameters<ExtensionAPI["registerCommand"]>[1] = {
    description: "Rewrite the latest answer or supplied text; /declaw style selects a style, /declaw model selects its model",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        { value: "model", label: "model", description: "Choose the rewrite model (low thinking)" },
        { value: "style", label: "style", description: "Choose the saved rewrite style" },
        { value: "styles", label: "styles", description: "Alias for style: choose the saved rewrite style" },
        { value: "list", label: "list", description: "List installed Declaw plugins and statuses" },
        { value: "manage", label: "manage", description: "Enable or disable Declaw plugins" },
        ...catalog.activeStyleIds().map((id) => ({ value: id, label: id, description: `Rewrite once with ${catalog.get(id)!.style.name}` })),
      ].filter((item) => item.value.startsWith(prefix));
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("/declaw currently requires Pi's terminal UI.", "warning");
        return;
      }
      const command = args.trim();
      if (active || !ctx.isIdle()) {
        ctx.ui.notify("Wait for the current request to finish, then use /declaw.", "info");
        return;
      }
      const controller = new AbortController();
      active = controller;
      const sessionId = ctx.sessionManager.getSessionId();
      const invocationLeafId = ctx.sessionManager.getLeafId();
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await syncPluginStatuses(command === "manage");
        if (command === "model") {
          await chooseModel(ctx, settingsPath, controller.signal);
          return;
        }
        if (command === "list") {
          const lines = catalog.listPlugins().map(({ plugin, status }) => {
            const styles = plugin.styles.map((style) => `${style.name} (${style.id})`).join(", ");
            return `${plugin.name} [${plugin.id}] · ${status} · ${styles}`;
          });
          ctx.ui.notify(lines.join("\n") || "No Declaw plugins are installed.", "info");
          return;
        }
        if (command === "manage") {
          const leafId = ctx.sessionManager.getLeafId();
          const plugins = catalog.listPlugins();
          const labels = plugins.map(({ plugin, status }) => `${plugin.name} (${plugin.id}) · ${status}`);
          const selection = await ctx.ui.select("Declaw plugins", labels, { signal: controller.signal });
          if (!selection || controller.signal.aborted || !ctx.isIdle() ||
              ctx.sessionManager.getSessionId() !== sessionId || ctx.sessionManager.getLeafId() !== leafId) return;
          const selected = plugins[labels.indexOf(selection)];
          if (!selected) return;
          const status = selected.status === "active" ? "disabled" : "active";
          catalog.setPluginStatus(selected.plugin.id, status);
          pluginStatuses[selected.plugin.id] = status;
          await savePluginStatuses(pluginPath, pluginStatuses);
          if (!controller.signal.aborted) ctx.ui.notify(`${selected.plugin.name} is now ${status}.`, "info");
          return;
        }
        if (command === "style" || command === "styles") {
          const leafId = ctx.sessionManager.getLeafId();
          const current = await readStyleChoice(stylePath, catalog).catch(() => undefined);
          if (controller.signal.aborted) return;
          const styleIds = catalog.activeStyleIds();
          const labels = styleIds.map((id) => `${catalog.get(id)!.style.name} (${id})${id === current ? "  (current)" : ""}`);
          const selection = await ctx.ui.select("Declaw rewrite style", labels, { signal: controller.signal });
          if (!selection || controller.signal.aborted || !ctx.isIdle() ||
              ctx.sessionManager.getSessionId() !== sessionId || ctx.sessionManager.getLeafId() !== leafId) return;
          const style = styleIds[labels.indexOf(selection)];
          if (!style) return;
          await saveStyleChoice(stylePath, style, catalog);
          if (!controller.signal.aborted) ctx.ui.notify(`/declaw now uses ${catalog.get(style)!.style.name}. Model settings are unchanged.`, "info");
          return;
        }
        // Match installed IDs, not merely strings with valid ID syntax. Disabled
        // styles remain reserved so invoking one reports its unavailable status.
        const input = args.trimStart();
        // Consume one separator after a style ID (CRLF counts as one), leaving
        // any source indentation and subsequent line breaks untouched.
        const prefix = input.match(/^(\S+)(?:\r\n|\s)?/u);
        const requestedStyle = prefix && catalog.get(prefix[1], { includeDisabled: true })?.style.id;
        const suppliedText = prefix && requestedStyle ? input.slice(prefix[0].length) : args;
        const source = suppliedText.trim()
          ? { id: null, text: suppliedText }
          : latestAnswer(ctx.sessionManager.getBranch());
        if (!source) {
          ctx.ui.notify("No completed assistant answer is available to rewrite.", "warning");
          return;
        }
        if (source.text.length > MAX_INPUT_CHARS) {
          ctx.ui.notify("This source is too long for /declaw (32,000 characters maximum).", "warning");
          return;
        }
        const style = requestedStyle ?? await readStyleChoice(stylePath, catalog);
        const selected = catalog.get(style);
        const styleRecord = selected && { ...selected, style: { ...selected.style } };
        if (!styleRecord) {
          ctx.ui.notify(`The Declaw style ${style} is unavailable or disabled. Run /declaw style or /declaw manage.`, "warning");
          return;
        }
        const choice = await readModelChoice(settingsPath);
        if (controller.signal.aborted) return;
        const model = ctx.modelRegistry.find(choice.provider, choice.modelId);
        if (!model) {
          ctx.ui.notify(`The /declaw model ${choice.provider}/${choice.modelId} is unavailable. Run /declaw model to choose another.`, "warning");
          return;
        }
        if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
          ctx.ui.notify("Sign in to the selected provider with /login, or choose another model with /declaw model.", "warning");
          return;
        }
        if (!supportsLowThinking(model)) {
          ctx.ui.notify("The selected model lacks low thinking support. Run /declaw model to choose another.", "warning");
          return;
        }
        const gateway = createRewriteGateway(ctx.modelRegistry, model, styleRecord);
        timeout = setTimeout(() => { timedOut = true; controller.abort(); }, REWRITE_TIMEOUT_MS);
        const result = await ctx.ui.custom<Result | undefined>((tui, theme, _keys, done) => {
          const loader = new BorderedLoader(tui, theme, `Rewriting with ${styleRecord.style.name} · ${model.id} · ${REWRITE_THINKING} thinking…`);
          loader.onAbort = () => controller.abort();
          const work = executeRewrite(source, controller.signal, {
            ...gateway,
            isCurrent: (candidate) => ctx.sessionManager.getSessionId() === sessionId && ctx.isIdle() &&
              (candidate.id === null
                ? ctx.sessionManager.getLeafId() === invocationLeafId
                : latestAnswer(ctx.sessionManager.getBranch())?.id === candidate.id),
            publish: ({ sourceEntryId, text }) => pi.appendEntry<PlainEntry>(ENTRY_TYPE, {
              version: POLICY_VERSION, sourceEntryId, text,
              model: `${model.provider}/${model.id}`, thinkingLevel: REWRITE_THINKING,
              style, styleName: styleRecord.style.name, stylePlugin: styleRecord.pluginId,
              styleVersion: styleRecord.pluginVersion,
            }),
          });
          void work.then(
            (outcome) => {
              switch (outcome.kind) {
                case "accepted": done({ text: outcome.text }); break;
                case "cancelled": done({ cancelled: true }); break;
                case "stale": done({ stale: true }); break;
                case "rejected":
                case "failed": done({ error: rewriteFailureMessage(outcome) }); break;
              }
            },
            (error: unknown) => done(controller.signal.aborted ? { cancelled: true } :
              { error: error instanceof PlainError ? error.message : "The rewrite failed. The original is unchanged." }),
          );
          return loader;
        });
        if (controller.signal.aborted || !result || "cancelled" in result || "stale" in result) {
          if (active === controller && !controller.signal.aborted) controller.abort();
          if (timedOut) ctx.ui.notify(`The rewrite timed out after ${REWRITE_TIMEOUT_MS / 1000} seconds. The original is unchanged.`, "warning");
          return;
        }
        if ("error" in result) {
          ctx.ui.notify(result.error, "warning");
          return;
        }
      } catch (error) {
        if (!controller.signal.aborted) ctx.ui.notify(error instanceof PlainError ? error.message : "The /declaw request failed. The original is unchanged.", "warning");
      } finally {
        clearTimeout(timeout);
        controller.abort();
        if (active === controller) active = undefined;
      }
    },
  };

  return { command, cancel };
}
