/**
 * Framework-free public contract for Declaw style packages.
 *
 * A plugin package may import only this module. It must not import Pi, the model
 * SDK, or filesystem/UI adapters. Pi packages are trusted code; this contract is
 * an extension boundary, not a sandbox.
 */

export const DECLAW_PLUGIN_API_VERSION = 1 as const;
export type PluginStatus = "active" | "disabled";
export type StyleRelationship = "Local preset" | "Adapted from" | "Prompt from";

export interface StyleRequestPayload {
  system: string;
  user: string;
}

export interface DeclawStyleDefinition {
  /** Built-in IDs are un-namespaced for backwards compatibility. Plugins use plugin-id/style-id. */
  id: string;
  name: string;
  description?: string;
  source?: string;
  relationship: StyleRelationship;
  /** Defines the transformation. Host rewrite guidance is advisory; the style controls. */
  instructions: string;
  /** Purely formats the original, unmasked answer for this style's model envelope. */
  buildUserPayload: (answer: string) => string;
}

export interface DeclawStylePlugin {
  apiVersion: typeof DECLAW_PLUGIN_API_VERSION;
  id: string;
  name: string;
  version: string;
  /** Default status. User-managed status is stored by the host, not by the plugin. */
  status?: PluginStatus;
  styles: readonly DeclawStyleDefinition[];
}

export interface RegisteredPlugin {
  readonly plugin: DeclawStylePlugin;
  readonly status: PluginStatus;
}

type Listener = (plugin: DeclawStylePlugin) => void;
interface DeclawPluginBridge {
  readonly plugins: Map<string, DeclawStylePlugin>;
  readonly listeners: Set<Listener>;
}

const BRIDGE_KEY = Symbol.for("declaw.plugin-bridge.v1");

type GlobalWithDeclawBridge = typeof globalThis & { [BRIDGE_KEY]?: DeclawPluginBridge };

function bridge(): DeclawPluginBridge {
  const root = globalThis as GlobalWithDeclawBridge;
  return root[BRIDGE_KEY] ??= { plugins: new Map(), listeners: new Set() };
}

/** Register from an independently loaded Pi extension package. Duplicate loads are harmless. */
export function registerDeclawPlugin(plugin: DeclawStylePlugin): void {
  const current = bridge().plugins.get(plugin.id);
  if (current) {
    if (current.version !== plugin.version) throw new Error(`Declaw plugin "${plugin.id}" was registered with two versions.`);
    return;
  }
  bridge().plugins.set(plugin.id, plugin);
  for (const listener of bridge().listeners) listener(plugin);
}

/** Read a snapshot so the host can compose a catalog without depending on load order. */
export function getRegisteredDeclawPlugins(): readonly DeclawStylePlugin[] {
  return [...bridge().plugins.values()];
}

/** Subscribe the host to plugins that load after Declaw. */
export function onDeclawPluginRegistered(listener: Listener): () => void {
  bridge().listeners.add(listener);
  return () => bridge().listeners.delete(listener);
}

/** Useful to tests and reload-aware hosts; does not affect plugin packages in other processes. */
export function clearDeclawPluginBridgeForTests(): void {
  const current = bridge();
  current.plugins.clear();
  current.listeners.clear();
}
