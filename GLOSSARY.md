# Declaw glossary

Declaw's bounded context is **Answer Rewriting**: turning a completed assistant
answer into an alternate reading without changing the conversation or pretending
that shorter means better.

## Domain language

- **Source answer** — the immutable completed assistant answer selected for rewriting.
- **Source entry ID** — Pi identity of the source answer. It prevents a late result
  from being attached to a different branch or newer answer.
- **Reading style** — a named presentation policy, such as Terse or SLYE.
- **Style definition** — a style's stable ID, label, provenance, instructions, and
  protected-answer payload formatter.
- **Style plugin** — a trusted package contribution containing one or more definitions.
- **Style catalog** — the host-owned registry that validates IDs, namespaces,
  collisions, provenance, and active/disabled status.
- **Style snapshot** — style label, plugin ID, and plugin version saved with a
  display entry so historical entries remain readable after plugin removal.
- **Protected answer** — source text with exact spans replaced by temporary tokens.
- **Rewrite request** — protected answer plus style instructions and selected model.
- **Rewrite attempt** — one isolated, tool-free provider invocation.
- **Rewrite result** — accepted text, unchanged text, preservation rejection,
  cancellation, or operational failure.
- **Display rewrite** — a Pi custom entry rendered to the user but excluded from
  future agent context.

## Application language

- **Action** — an intentional user request: `RewriteLatestAnswer`, `ChooseStyle`,
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
  known. It is not the same as a semantic rejection.

## Non-domain concerns

Pi model IDs, OAuth, headers, filesystem paths, terminal widgets, package loading,
and GitHub Pages are infrastructure concerns. They may be represented at adapters,
but they are not reading-style policy.
