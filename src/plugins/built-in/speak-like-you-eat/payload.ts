import type { DeclawStyleDefinition } from "../../../plugin-api.ts";

/** SLYE's pinned empty-context envelope, kept separate from its style prompt. */
export const buildSlyePayload: DeclawStyleDefinition["buildUserPayload"] = (protectedAnswer) =>
  `Context:\n\n\nTarget:\n${protectedAnswer}`;
