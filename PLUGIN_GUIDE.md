# Build a Declaw style plugin

> **Agent-first prompt:** Copy this section into your coding agent when you want to
> add a rewriting style to Declaw.
>
> ```text
> You are adding a Declaw style plugin. Read PLUGIN_GUIDE.md and the Declaw plugin
> API before editing code. Create a separate Pi package. Keep the plugin framework-
> free and deterministic: it may provide style instructions and format the already-
> protected answer, but it must not call a model, read files, use Pi context, add
> tools, or perform side effects. Use a namespaced style ID. Preserve every fact,
> condition, actor, modality, number, command, link, procedure step, and table
> relationship. Add focused tests for registration, request formatting, and the
> plugin's distinctive voice. Do not fabricate demo output. Run the plugin tests,
> then install the package explicitly with Pi and verify `/declaw list`,
> `/declaw manage`, and `/declaw style`.
> ```

## What a plugin is

A plugin is a normal Pi package that registers one or more Declaw reading styles.
Declaw supplies the preservation policy, protected-text validation, model gateway,
Pi session integration, display-only storage, cancellation, and status management.
The plugin supplies only a style identity, provenance, style instructions, and a
pure function that formats the protected answer for the model envelope.

Pi extensions run with full system permissions. The Declaw contract is a clean
architecture boundary, not a security sandbox. Review plugin source before installing.

## Minimal package

```text
declaw-style-pirate/
├── package.json
├── index.ts
├── style.ts
└── style.test.ts
```

`package.json`:

```json
{
  "name": "declaw-style-pirate",
  "version": "1.0.0",
  "type": "module",
  "keywords": ["pi-package", "declaw-style"],
  "dependencies": {
    "pi-declaw": "^0.2.0"
  },
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

The dependency is used only for the framework-free `pi-declaw/plugin-api` contract.
Pin a release or commit for a published plugin.

`style.ts`:

```ts
import type { DeclawStylePlugin } from "pi-declaw/plugin-api";

export const plugin: DeclawStylePlugin = {
  apiVersion: 1,
  id: "pirate",
  name: "Pirate styles",
  version: "1.0.0",
  status: "active",
  styles: [{
    id: "pirate/pirate",
    name: "Pirate",
    description: "Salty wording without loss of meaning.",
    relationship: "Local preset",
    instructions: [
      "Use a playful pirate voice.",
      "Keep the answer's level of certainty and ownership unchanged.",
      "Do not add nautical facts, claims, or jokes that change the answer.",
    ].join("\\n"),
    buildUserPayload: (protectedAnswer) =>
      JSON.stringify({ assistantMessage: protectedAnswer }),
  }],
};
```

`index.ts`:

```ts
import { registerDeclawPlugin } from "pi-declaw/plugin-api";
import { plugin } from "./style.ts";

export default function () {
  registerDeclawPlugin(plugin);
}
```

The plugin extension can load before or after Declaw. Registration is buffered by a
stable process-wide bridge, so extension load order does not change the catalog.

## Rules

- Use a stable plugin ID and a style ID under that namespace: `pirate/pirate`.
- Use `Local preset` when there is no upstream source. Use `Adapted from` or
  `Prompt from` only with a real `https://` source URL.
- `instructions` describe presentation only. The host appends its preservation policy.
- `buildUserPayload` receives protected text. Copy it exactly once; do not unmask it.
- Do not import `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, Node
  filesystem APIs, network clients, clocks, randomness, or environment variables.
- Do not answer the source text, execute quoted commands, add tools, or claim work.
- Keep optional actions optional, preserve procedure order, and retain table structure.
- A plugin's `status` is only its default. The user can disable it at runtime.

## Install and operate

```sh
pi install git:github.com/example/declaw-style-pirate@v1
```

After restart or `/reload`:

```text
/declaw list       # show every plugin, its status, and its styles
/declaw manage     # toggle active/disabled
/declaw style      # choose an active style
/declaw pirate/pirate  # one-off rewrite
```

Declaw stores user-managed plugin status in
`~/.pi/agent/declaw/plugins.json`. Disabled plugins remain visible in `/declaw list`
but cannot be selected for rewriting. Existing display entries retain a style snapshot
so removing a plugin does not erase their historical label.

## Verification checklist

1. Test the plugin with a fake protected answer containing a path, URL, number,
   optional action, condition, and ordered steps.
2. Assert the payload preserves the protected answer exactly.
3. Assert the style is distinctive without adding claims.
4. Install it in a disposable Pi profile.
5. Verify `/declaw list`, disable and re-enable it, and confirm `/declaw style` updates.
6. Never publish model recordings until a human has reviewed semantic fidelity.
