import type { DeclawStylePlugin } from "../../../plugin-api.ts";
import { buildJsonPayload } from "../shared/json-payload.ts";
import { ASD_STE100_PROMPT } from "./prompt.ts";

export const asdSte100Plugin: DeclawStylePlugin = {
  apiVersion: 1,
  id: "builtin/ste",
  name: "ASD-STE100",
  version: "1.0.0",
  status: "active",
  styles: [{
    id: "ste",
    name: "ASD-STE100",
    relationship: "Adapted from",
    source: "https://github.com/danyuchn/asd-ste100-skill",
    instructions: ASD_STE100_PROMPT,
    buildUserPayload: buildJsonPayload,
  }],
};
