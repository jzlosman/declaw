import type { DeclawStylePlugin } from "../../plugin-api.ts";
import { asdSte100Plugin } from "./asd-ste100/plugin.ts";
import { iHaveAdhdPlugin } from "./i-have-adhd/plugin.ts";
import { paseoPlainPlugin } from "./paseo-plain/plugin.ts";
import { speakLikeYouEatPlugin } from "./speak-like-you-eat/plugin.ts";
import { squirrelModePlugin } from "./squirrel-mode/plugin.ts";
import { tersePlugin } from "./terse/plugin.ts";

/** The composition root for built-in plugins. Definitions remain owned by their modules. */
export const BUILTIN_PLUGINS: readonly DeclawStylePlugin[] = [
  paseoPlainPlugin,
  tersePlugin,
  iHaveAdhdPlugin,
  squirrelModePlugin,
  asdSte100Plugin,
  speakLikeYouEatPlugin,
];
