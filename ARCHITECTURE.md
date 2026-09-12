# Declaw architecture

## Bounded context

Declaw owns the **Answer Rewriting** bounded context. Its authority is the completed
assistant answer. It does not own the main agent conversation, provider credentials,
model selection, Pi navigation, or browser-generated output.

```text
Pi command/UI ──► application action ──► domain plan
      ▲                    │                 │
      │                    │                 ├── StyleCatalog
      │                    │                 └── Preservation policy
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
- `src/domain/preservation.ts`: host-owned exact-text protection and validation.
- `src/domain/rewrite.ts`: rewrite policy, limits, and domain outcomes.
- `src/plugin-api.ts`: framework-free plugin port and registration bridge.
- `src/plugins/built-in/*`: one self-contained module per built-in plugin; each owns its
  prompt, provenance, and payload adapter. `src/plugins/built-in/index.ts` only aggregates them.
- `src/application/rewrite.ts`: rewrite use case and explicit completion/publication ports.
- `src/adapters/pi.ts`: Pi message/session/request translation.
- `src/adapters/model.ts`: Pi model/auth/provider translation and model selection.
- `src/adapters/settings.ts`: filesystem preference adapter.
- `index.ts`: composition root, lifecycle wiring, command registration, and display projection.
- `playground/`: static projection of saved recordings; never a model adapter.

## Actions and effects

| Action | Reads | Effects | Success projection |
|---|---|---|---|
| Rewrite latest answer | current branch, style, model settings | isolated model call, then append custom entry | display-only rewrite |
| Choose style | style catalog, current preference | preference file write | future rewrite default |
| Choose model | Pi model registry/auth | preference file write | future rewrite provider |
| List plugins | catalog, status file | none | status text |
| Manage plugins | catalog, status file | status file write | active/disabled catalog |

The rewrite path masks exact source spans, builds a plan, calls the model, validates
returned tokens, and only then appends a custom entry. The original answer is never
mutated or reintroduced as a model message.

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

- **Accepted** — output passes completion, unchanged-text, and exact-preservation checks.
- **Rejected** — output is incomplete, unchanged, oversized, or damages protected text.
- **Cancelled** — user or Pi lifecycle cancels the attempt; nothing is appended.
- **Indeterminate** — provider/network failure leaves the external outcome unknown;
  the original remains authoritative and no display entry is appended.

These outcomes are deliberately not collapsed into a boolean. The provider adapter
owns provider-specific errors; the domain owns semantic acceptance.

## Test strategy

- Domain tests: style identity, plugin namespace, collision, status, payload composition,
  masking, and preservation.
- Application tests: fake completion gateway, rejection, cancellation, and no-write behavior.
- Adapter tests: Pi message normalization, provider serialization, filesystem settings,
  and custom-entry rendering.
- Composition tests: built-in registration, external registration, `/declaw` alias,
  status persistence, and disabled-style selection.
- Static-site tests: saved snapshots only; no plugin or provider execution in the browser.
