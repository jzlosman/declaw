import type { DeclawStylePlugin } from "../../../plugin-api.ts";
import { buildJsonPayload } from "../shared/json-payload.ts";
import { SQUIRREL_PROMPT } from "./prompt.ts";

export const squirrelModePlugin: DeclawStylePlugin = {
  apiVersion: 1,
  id: "builtin/squirrel",
  name: "Squirrel Mode",
  version: "1.0.0",
  status: "active",
  styles: [{
    id: "squirrel",
    name: "Squirrel Mode",
    relationship: "Adapted from",
    source: "https://github.com/thgMatajs/squirrel-mode",
    instructions: SQUIRREL_PROMPT,
    buildUserPayload: buildJsonPayload,
  }],
};
