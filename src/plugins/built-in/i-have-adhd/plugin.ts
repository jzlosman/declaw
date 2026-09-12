import type { DeclawStylePlugin } from "../../../plugin-api.ts";
import { buildJsonPayload } from "../shared/json-payload.ts";
import { ADHD_PROMPT } from "./prompt.ts";

export const iHaveAdhdPlugin: DeclawStylePlugin = {
  apiVersion: 1,
  id: "builtin/adhd",
  name: "I Have ADHD",
  version: "1.0.0",
  status: "active",
  styles: [{
    id: "adhd",
    name: "I Have ADHD",
    relationship: "Adapted from",
    source: "https://github.com/ayghri/i-have-adhd",
    instructions: ADHD_PROMPT,
    buildUserPayload: buildJsonPayload,
  }],
};
