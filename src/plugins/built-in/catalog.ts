import { StyleCatalog, type BuiltinStyleId, type StyleMetadata } from "../../domain/styles.ts";
import { BUILTIN_PLUGINS } from "./index.ts";

export { BUILTIN_PLUGINS };
export const BUILTIN_CATALOG = new StyleCatalog(BUILTIN_PLUGINS);
export const BUILTIN_STYLE_IDS = ["plain", "terse", "adhd", "squirrel", "ste", "slye"] as const;
export type { BuiltinStyleId };
/** Compatibility alias for consumers that only need the native styles. */
export const STYLE_IDS = BUILTIN_STYLE_IDS;

/** Native metadata projection; dynamic plugins are resolved through StyleCatalog. */
export const STYLES: Record<BuiltinStyleId, StyleMetadata> = Object.fromEntries(
  BUILTIN_STYLE_IDS.map((id) => {
    const style = BUILTIN_CATALOG.get(id, { includeDisabled: true })!.style;
    return [id, { name: style.name, source: style.source, relationship: style.relationship }];
  }),
) as Record<BuiltinStyleId, StyleMetadata>;
