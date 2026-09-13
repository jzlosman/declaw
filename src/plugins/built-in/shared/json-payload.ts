import type { DeclawStyleDefinition } from "../../../plugin-api.ts";

/** Default answer-only envelope used by styles without a source-specific format. */
export const buildJsonPayload: DeclawStyleDefinition["buildUserPayload"] = (answer) =>
  JSON.stringify({ assistantMessage: answer });
