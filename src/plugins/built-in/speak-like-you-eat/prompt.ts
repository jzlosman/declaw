import { SLYE_PROMPT as upstreamPrompt } from "./upstream/model-rewrite.ts";

/** Runtime-facing prompt selected from the pinned upstream model-rewrite source. */
export const SLYE_PROMPT = upstreamPrompt;
