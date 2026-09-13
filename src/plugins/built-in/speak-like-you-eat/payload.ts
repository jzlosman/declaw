import type { DeclawStyleDefinition } from "../../../plugin-api.ts";

/** SLYE's pinned empty-context envelope, kept separate from its style prompt. */
export const buildSlyePayload: DeclawStyleDefinition["buildUserPayload"] = (answer) =>
  `Context:\n\n\nTarget:\n${answer}`;
