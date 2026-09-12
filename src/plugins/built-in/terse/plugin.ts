import type { DeclawStylePlugin } from "../../../plugin-api.ts";
import { buildJsonPayload } from "../shared/json-payload.ts";
import { TERSE_PROMPT } from "./prompt.ts";

export const tersePlugin: DeclawStylePlugin = {
  apiVersion: 1,
  id: "builtin/terse",
  name: "Terse",
  version: "1.0.0",
  status: "active",
  styles: [{
    id: "terse",
    name: "Terse",
    relationship: "Local preset",
    instructions: TERSE_PROMPT,
    buildUserPayload: buildJsonPayload,
  }],
};
