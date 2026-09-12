import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";
import { ENTRY_TYPE, type PlainEntry } from "./domain/rewrite.ts";
import { createDeclawCommand } from "./adapters/command.ts";
import { getRegisteredDeclawPlugins, onDeclawPluginRegistered } from "./plugin-api.ts";
import { join } from "node:path";
import { StyleCatalog } from "./domain/styles.ts";
import { BUILTIN_PLUGINS } from "./plugins/built-in/index.ts";

/** Pi composition root: assemble adapters, lifecycle hooks, and the display projection. */
export default function declaw(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  const settingsPath = join(agentDir, "declaw", "settings.json");
  const stylePath = join(agentDir, "declaw", "style.json");
  const pluginPath = join(agentDir, "declaw", "plugins.json");
  const catalog = new StyleCatalog();
  for (const plugin of BUILTIN_PLUGINS) catalog.register(plugin);
  const pluginErrors: string[] = [];
  const registerPlugin = (plugin: Parameters<StyleCatalog["register"]>[0]) => {
    try { catalog.register(plugin); }
    catch (error) { pluginErrors.push(error instanceof Error ? error.message : "Unknown Declaw plugin error."); }
  };
  for (const plugin of getRegisteredDeclawPlugins()) registerPlugin(plugin);
  const unsubscribePlugin = onDeclawPluginRegistered(registerPlugin);
  const commandController = createDeclawCommand({ pi, catalog, settingsPath, stylePath, pluginPath });

  pi.on("session_shutdown", () => { commandController.cancel(); unsubscribePlugin(); });
  pi.on("session_tree", commandController.cancel);
  pi.on("agent_start", commandController.cancel);
  if (pluginErrors.length) pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify(`Some Declaw plugins were not loaded: ${pluginErrors.join("; ")}`, "warning");
  });

  pi.registerEntryRenderer<PlainEntry>(ENTRY_TYPE, (entry, _options, theme) => {
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    const data = entry.data;
    const settings = data?.thinkingLevel ? ` · ${data.model} · ${data.thinkingLevel} thinking` : "";
    const style = typeof data?.style === "string" ? catalog.get(data.style, { includeDisabled: true }) : undefined;
    const label = data?.style === undefined || data.style === "plain" ? "Plain English"
      : style?.style.name ?? (typeof data?.styleName === "string" ? data.styleName
        : typeof data?.style === "string" ? data.style : "Unknown rewrite style");
    box.addChild(new Text(theme.fg("accent", theme.bold(label)) +
      theme.fg("dim", `${settings} · display only`), 0, 0));
    box.addChild(new Markdown(typeof data?.text === "string" ? data.text : "Rewrite unavailable.", 0, 1, getMarkdownTheme()));
    return box;
  });

  pi.registerCommand("declaw", commandController.command);
}
