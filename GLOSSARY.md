# Declaw glossary

Declaw's bounded context is **Answer Rewriting**: turning a completed assistant
answer or user-supplied text into an alternate reading without changing the
conversation or pretending that shorter means better.

## Domain language

- **Rewrite source** — immutable text selected for one rewrite: a source answer or
  supplied text.
- **Source answer** — the completed assistant answer selected from the current branch.
- **Supplied text** — typed or pasted command input, used instead of a source answer.
  It needs no assistant message and is not inserted into the conversation.
- **Source entry ID** — identity of a source answer; `null` for supplied text.
  Supplied-text results never claim an assistant message as their source.
- **Source currency** — permission to publish in the originating session while the
  agent is idle. A source answer must still be the latest answer; supplied text
  requires the invocation's branch leaf to remain unchanged. Lifecycle cancellation
  also prevents publication.
- **Reading style** — a named presentation policy, such as Terse or SLYE.
- **One-off style** — an installed style selected for a single rewrite by its ID,
  optionally followed by supplied text. It does not change the saved preference.
- **Style definition** — a style's stable ID, label, provenance, instructions, and
  raw-source payload formatter.
- **Style plugin** — a trusted package contribution containing one or more definitions.
- **Style catalog** — the host-owned registry that validates IDs, namespaces,
  collisions, provenance, and active/disabled status.
- **Style snapshot** — style label, plugin ID, and plugin version saved with a
  display entry so historical entries remain readable after plugin removal.
- **Rewrite request** — raw source formatted by the plugin, with advisory host
  guidance, selected style instructions, and selected model.
- **Rewrite attempt** — one isolated model call, without retries or a mandatory editor.
- **Plugin-owned transformation** — the style chooses how to change content; host
  guidance is a default, not a fidelity enforcement policy.
- **Rewrite result** — accepted final text, explicit policy rejection, cancellation,
  stale-source suppression, or operational failure.
- **Display rewrite** — a Pi custom entry rendered to the user but excluded from
  future agent context.

## Application language

- **Action** — an intentional user request: `RewriteLatestAnswer`, `RewriteSuppliedText`, `ChooseStyle`,
  `ChooseModel`, `ListPlugins`, or `ManagePlugins`.
- **Port** — an application-owned capability required from the outside world:
  answer reading, model completion, preferences, clock/identity, and display writing.
- **Adapter** — an implementation of a port: Pi session, Pi provider, filesystem,
  or TUI adapter.
- **Effect** — an observable side effect: provider call, preference write, or
  `pi.appendEntry`. Effects happen after deterministic validation and planning.
- **Projection** — a representation for a consumer. The display rewrite is a
  projection, not a new assistant message.
- **Provenance** — where a style or output came from and how it relates to its source.
- **Indeterminate** — an operational outcome where the provider result cannot be
  known. It is not the same as rejecting empty or oversized output.

## Non-domain concerns

Pi model IDs, OAuth, headers, filesystem paths, terminal widgets, package loading,
and GitHub Pages are infrastructure concerns. They may be represented at adapters,
but they are not reading-style policy.
