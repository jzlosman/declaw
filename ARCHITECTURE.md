# Declaw architecture

## Bounded context

Declaw owns the **Answer Rewriting** bounded context. Its input is a completed
assistant answer or user-supplied text. It does not own the main agent conversation, provider credentials,
model selection, Pi navigation, or browser-generated output.

```text
Pi command/UI ──► application action ──► domain plan
      ▲                    │                 │
      │                    │                 ├── StyleCatalog
      │                    │                 └── Output limits
      │                    ▼
      └── DisplayWriter ◄── accepted result ◄─ RewriteModel
```

## Dependency rule

```text
domain / policy       → no Pi, model SDK, filesystem, network, or UI
application actions   → depend on domain and ports
adapters              → implement ports and translate external shapes
composition root      → wires built-ins, registered plugins, and adapters
```

The files map to this boundary as follows:

- `src/domain/styles.ts`: style identity, plugin catalog, status, and request composition.
- `src/domain/rewrite.ts`: synchronous preparation, size limits, and duplicate-output checks.
- `src/plugin-api.ts`: framework-free plugin port and registration bridge.
- `src/plugins/built-in/*`: one self-contained module per built-in plugin; each owns its
  prompt, provenance, and payload adapter. `src/plugins/built-in/index.ts` only aggregates them.
- `src/application/rewrite.ts`: single-call orchestration and explicit publication ports.
- `src/application/cancellation.ts`: stop waiting while observing late provider rejections.
- `src/adapters/command.ts`: exact command routing, source selection, Pi source-currency
  checks, deadline, and display publication through application ports.
- `src/adapters/pi.ts`: Pi message/session/request translation.
- `src/adapters/model.ts`: Pi model/auth/provider translation and model selection.
- `src/adapters/settings.ts`: filesystem preference adapter.
- `src/extension.ts`: composition root, lifecycle wiring, command registration, and display projection.
- `index.ts`: package entrypoint.
- `playground/`: static projection of saved recordings; never a model adapter.

## Actions and effects

| Action | Reads | Effects | Success projection |
|---|---|---|---|
| Rewrite latest answer | current branch, style, model settings | one isolated model call, then append custom entry | display-only final reading |
| Rewrite supplied text | command text, style, model settings | one isolated model call, then append custom entry | display-only final reading |
| Choose style | style catalog, current preference | preference file write | future rewrite default |
| Choose model | Pi model registry/auth | preference file write | future rewrite provider |
| List plugins | catalog, status file | none | status text |
| Manage plugins | catalog, status file | status file write | active/disabled catalog |

The domain checks input bounds and snapshots the raw source. The application
requests one transformation using the selected model and style. The plugin's payload
formatter receives the original, unmasked source. Short host guidance is advisory;
the selected style owns what to change, omit, or add. There is no editor, semantic
judge, token masking, or exact-text rejection in the runtime.

Cancellation and source currency are checked before and after the call. The command
adapter owns a 60-second deadline. Provider retries are disabled. Complete, nonempty,
bounded output that differs from the source can become a display entry, regardless
of whether it follows Declaw's default preferences. The original answer and future
main-agent context remain untouched.

## Source selection and identity

The command adapter reserves exact `model`, `style`, `styles` (a `style` alias),
`list`, and `manage` after trimming for comparison. An installed style ID as the
first whitespace-delimited token selects a one-off style. The adapter removes that
ID and one separator (CRLF counts as one); the remainder is supplied text, with
formatting intact. Empty or whitespace-only remainders select the latest completed
assistant answer. This override never writes the saved style preference.

Disabled style IDs stay reserved so they cannot silently become source text. ID
syntax alone does not reserve a word. Without an installed style prefix, the whole
nonempty argument is supplied text as received from Pi, using the saved style.
Empty arguments select the latest completed assistant answer.

Both routes call the same `executeRewrite` action with a framework-free
`RewriteSource`. Its `id` is the answer's identity or `null` for supplied text;
publication preserves that distinction in `sourceEntryId`. No synthetic assistant
entry or additional history read is needed for supplied text. Existing display
entries with string IDs remain valid; rendering does not depend on source identity.

The adapter implements `isCurrent`: both routes require the original session and
an idle agent. Answer rewrites require the same latest-answer ID. Supplied-text
rewrites require the same branch leaf captured before any asynchronous work.
Lifecycle cancellation remains wired in the composition root. The application
checks this port before the provider call and before publication; it has no Pi
session, command syntax, or filesystem dependencies.

## Plugin lifecycle

1. Pi loads the Declaw package and any installed style packages.
2. Each style package registers a versioned, framework-free plugin contract.
3. Declaw validates plugin identity, style namespace, provenance, and collisions.
4. `/declaw list` shows all registered plugins and status.
5. `/declaw manage` persists `active` or `disabled` status.
6. Only active styles enter `/declaw style` and rewrite resolution.
7. Display entries save style snapshots so plugin removal does not break history.

The six built-in styles are six built-in plugin records. Third-party plugins use a
namespaced style ID such as `pirate/pirate`. The process-wide registration bridge
handles Pi extension load order; explicit package installation remains the trust boundary.

## Outcome model

- **Accepted** — complete output is nonempty, within bounds, and differs from the source.
- **Rejected** — input or output violates size/empty-text limits, or output is unchanged.
- **Cancelled** — user, deadline, or Pi lifecycle cancels the operation; nothing is appended.
- **Stale** — the source is no longer current; no later stage or publication occurs.
- **Failed** — the model adapter fails or returns an incomplete completion;
  provider diagnostics are not exposed to the UI.

These outcomes are deliberately not collapsed into a boolean. Operational failure
is not an input/output rejection: a remote invocation may have occurred even when
its result is unavailable. The original stays authoritative in every non-accepted outcome.
The domain owns deterministic acceptance, not a claim that the LLM proved fidelity.

## Test strategy

- Domain tests: style identity, plugin namespace, collision, status, payload composition,
  raw-source formatting, output bounds, and plugin-owned transformations.
- Application tests: fake completion gateway, rejection, cancellation, and no-write behavior.
- Adapter tests: Pi message normalization, provider serialization, filesystem settings,
  and custom-entry rendering.
- Composition tests: built-in registration, external registration, `/declaw` alias,
  status persistence, and disabled-style selection.
- Static-site tests: saved snapshots only; no plugin or provider execution in the browser.
