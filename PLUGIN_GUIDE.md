# Build a Declaw style plugin

> **Agent-first prompt:** Copy this section into your coding agent when you want to
> add a rewriting style to Declaw.
>
> ```text
> You are adding a Declaw style plugin. Read PLUGIN_GUIDE.md and the Declaw plugin
> API before editing code. Create a separate Pi package. Keep the plugin framework-
> free and deterministic: it may provide transformation instructions and format the
> original answer, but it must not call a model, read files, use Pi context, add
> tools, or perform side effects. Use a namespaced style ID. The plugin owns what
> its transformation changes, omits, or adds; host guidance is advisory.
> Add focused tests for registration, request formatting, and the
> plugin's distinctive voice. Do not fabricate demo output. Run the plugin tests,
> then install the package explicitly with Pi and verify `/declaw list`,
> `/declaw manage`, and `/declaw style`.
> ```

## What a plugin is

A plugin is a normal Pi package that registers one or more Declaw reading styles.
Declaw supplies the model gateway, Pi session integration, display-only storage,
operational limits, cancellation, and status management. The plugin supplies a
style identity, provenance, transformation instructions, and a pure function that
formats the original answer for the model envelope. Declaw does not enforce semantic
fidelity or exact-text preservation on plugin output.

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
    buildUserPayload: (answer) =>
      JSON.stringify({ assistantMessage: answer }),
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
- `instructions` define the transformation. The selected style takes precedence over
  advisory host guidance and can intentionally change, omit, or add content.
- `buildUserPayload` receives the original, unmasked answer. Format it for your style's
  single model request; there is no host-owned editor envelope.
- Do not import `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, Node
  filesystem APIs, network clients, clocks, randomness, or environment variables.
- Plugin code must not execute source commands or add tools. What the generated text
  says is the style's choice, not subject to a host semantic approval step.
- A plugin's `status` is only its default. The user can disable it at runtime.

Existing formatters still use the same string-to-string API. They now receive the
original text, not host-generated `KEEP` tokens; adapt any formatter that assumed masking.

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

1. Test the plugin with representative original answers.
2. Assert that its input formatter produces the envelope you intended.
3. Test the transformation against the plugin's own goals, not a mandatory host fidelity rubric.
4. Install it in a disposable Pi profile.
5. Verify `/declaw list`, disable and re-enable it, and confirm `/declaw style` updates.
6. Never publish model recordings until a human has reviewed semantic fidelity.
