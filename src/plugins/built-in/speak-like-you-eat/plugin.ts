import type { DeclawStylePlugin } from "../../../plugin-api.ts";
import { buildSlyePayload } from "./payload.ts";
import { SLYE_PROMPT } from "./prompt.ts";

export const SLYE_SOURCE = {
  repository: "https://github.com/wtfzambo/speak-like-you-eat",
  revision: "e1725d982ec5b03fe26e7d637ce2d9384c3ef820",
  version: "1.1.0",
} as const;

/** Local adapter around SLYE's pinned prompt and empty-context envelope. */
export const speakLikeYouEatPlugin: DeclawStylePlugin = {
  apiVersion: 1,
  id: "builtin/slye",
  name: "Speak Like You Eat",
  version: "1.0.0",
  status: "active",
  styles: [{
    id: "slye",
    name: "Speak Like You Eat",
    relationship: "Adapted from",
    source: SLYE_SOURCE.repository,
    instructions: SLYE_PROMPT,
    buildUserPayload: buildSlyePayload,
  }],
};
