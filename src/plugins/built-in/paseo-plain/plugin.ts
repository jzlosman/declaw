import type { DeclawStylePlugin } from "../../../plugin-api.ts";
import { PROMPT_VERSION, buildRewritePrompt } from "./upstream/prompt.ts";
import { buildJsonPayload } from "../shared/json-payload.ts";

export const PASEO_PLAIN_SOURCE = {
  repository: "https://github.com/scowalt/paseo-plain",
  revision: "35e63ee2e5f17a5bad40a8772c84fa5f21a8678f",
  promptVersion: PROMPT_VERSION,
} as const;

/** Local adapter around Paseo Plain's pinned prompt and answer-only envelope. */
export const paseoPlainPlugin: DeclawStylePlugin = {
  apiVersion: 1,
  id: "builtin/plain",
  name: "Paseo Plain",
  version: "1.0.0",
  status: "active",
  styles: [{
    id: "plain",
    name: "Paseo Plain",
    relationship: "Prompt from",
    source: PASEO_PLAIN_SOURCE.repository,
    instructions: buildRewritePrompt(""),
    buildUserPayload: buildJsonPayload,
  }],
};
