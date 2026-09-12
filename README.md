<h1>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="playground/assets/declaw-wordmark-white.png">
  <img src="playground/assets/declaw-wordmark-charcoal.png" alt="Declaw" width="420">
</picture>
</h1>

[![CI](https://github.com/jzlosman/declaw/actions/workflows/ci.yml/badge.svg)](https://github.com/jzlosman/declaw/actions/workflows/ci.yml)
[![Coverage](https://codecov.io/gh/jzlosman/declaw/graph/badge.svg)](https://codecov.io/gh/jzlosman/declaw)
[![GitHub Pages](https://github.com/jzlosman/declaw/actions/workflows/pages.yml/badge.svg)](https://github.com/jzlosman/declaw/actions/workflows/pages.yml)
[![License](https://img.shields.io/github/license/jzlosman/declaw)](LICENSE)
[![Stars](https://img.shields.io/github/stars/jzlosman/declaw)](https://github.com/jzlosman/declaw/stargazers)
[![Forks](https://img.shields.io/github/forks/jzlosman/declaw)](https://github.com/jzlosman/declaw/network/members)

Agent-summary slop is annoying enough. The buzzwords, fake certainty, and excessive polish make it harder to tell what matters.

There are good tools for cleaning it up: [Paseo Plain](https://github.com/scowalt/paseo-plain), [Speak Like You Eat](https://github.com/wtfzambo/speak-like-you-eat), [ASD-STE100](https://github.com/danyuchn/asd-ste100-skill), [I Have ADHD](https://github.com/ayghri/i-have-adhd), [Squirrel Mode](https://github.com/thgMatajs/squirrel-mode), and others.

Used as ordinary prompts or skills, though, these styles can bleed into the rest of the conversation. That can change how the agent reads your requests and writes its next answer.

Paseo Plain was the inspiration for Declaw. It does this as a plugin for Paseo; Declaw takes the idea one step lower in the chain and implements it directly in Pi. A separate `pi` instance with no tools, skills, or extensions rewrites the most recent response, and the result is display-only. The original conversation stays untouched, while the same boundary supports Paseo Plain, the other styles above, and third-party plugins.

[Try the hosted playground](https://jzlosman.github.io/declaw/) · [Install Declaw](#install)

## Install

Install the package from npm:

```sh
pi install npm:pi-declaw
```

For the source repository instead:

```sh
pi install git:github.com/jzlosman/declaw
```

Then run `/reload` in Pi and use `/declaw`.

## Use

```text
/declaw              Rewrite the latest answer with your saved style.
/declaw style        Choose and save a style.
/declaw <style-id>   Rewrite once with a specific style.
/declaw model        Choose the separate rewrite model.
/declaw list        List installed styles/plugins and active status.
/declaw manage      Enable or disable a style plugin.
```

Example:

```text
/declaw slye
```

Press **Esc** to cancel. Declaw never rewrites automatically.

## Styles

| ID         | Style              | Source                                                                        |
| ---------- | ------------------ | ----------------------------------------------------------------------------- |
| `plain`    | Paseo Plain        | [scowalt/paseo-plain](https://github.com/scowalt/paseo-plain)                 |
| `terse`    | Terse              | Local preset                                                                  |
| `adhd`     | I Have ADHD        | [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)                   |
| `squirrel` | Squirrel Mode      | [thgMatajs/squirrel-mode](https://github.com/thgMatajs/squirrel-mode)         |
| `ste`      | ASD-STE100         | [danyuchn/asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill)     |
| `slye`     | Speak Like You Eat | [wtfzambo/speak-like-you-eat](https://github.com/wtfzambo/speak-like-you-eat) |

The six styles are shipped as built-in plugins. You do not install separate packages
for them. Additional styles can be installed as independent Pi packages; see
[`PLUGIN_GUIDE.md`](PLUGIN_GUIDE.md) for an agent-first recipe.

Some styles adapt rules from their sources. They are not complete ports or official
certifications. Source attribution does not imply endorsement.

## Plugin architecture

Declaw owns the preservation policy, model gateway, Pi session boundary, and display-only
projection. A plugin owns only its style instructions and protected-answer envelope.
Plugin IDs are stable, styles are namespaced, collisions are rejected, and user status
is persisted independently of plugin code. Disabled plugins remain visible in
`/declaw list` but are unavailable to `/declaw style`.

See the small, functioning [`declaw-style-pirate` example plugin](https://github.com/jzlosman/declaw-style-pirate)
for a complete third-party package built against this boundary.

Read [`GLOSSARY.md`](GLOSSARY.md) for the domain vocabulary and
[`ARCHITECTURE.md`](ARCHITECTURE.md) for ports, adapters, actions, and effects.

## What Declaw preserves

Declaw protects exact text before the model sees the answer. This includes:

- commands
- paths and links
- code
- quotations
- numbers
- names and other technical text

It rejects a rewrite when protected text is missing, duplicated, reordered, or invented.
It also preserves meaning rules such as:

- `may` must not become `will`;
- a proposed assistant action must not become a user instruction;
- prerequisites must not become broader;
- recommendation reasons must remain attached; and
- useful tables must remain tables.

These checks reduce errors. They cannot prove that a model preserved every meaning.
Read important rewrites against the original.

## Context isolation, privacy, and limits

Declaw is a display projection, not a second conversation. Rewritten text is never
made available to the agent as context: it is excluded from future prompts, tool
planning, skill and prompt evaluation, and session compaction. This prevents a
rewrite's changed wording from influencing later work.

Each rewrite request sends only one protected answer to the selected rewrite model.
It does not send conversation history, earlier requests, project files, tools, or
reasoning.

Declaw uses its own model and style settings. It does not change the main agent's
model or thinking level. The default rewrite model is:

```text
openai-codex/gpt-5.6-luna · low thinking
```

Provider charges apply. You must be authenticated to the selected provider.
Provider retries are disabled. Requests time out after 60 seconds.

Declaw requires Pi's terminal UI. It does not rewrite incomplete answers, tool-call
results, answers over 32,000 characters, or overlapping requests.

Rewrites are saved in the Pi session file as display-only entries. They remain visible
after reload, but Pi does not send them back to the agent or include them in compaction.

## Playground

The [hosted playground](https://jzlosman.github.io/declaw/) is a static demonstration
using saved outputs. It makes no browser model calls and collects no visitor credentials
or analytics.

```sh
npm run build:playground
open dist/playground/index.html
```

The public snapshot contains reviewed historical recordings from the earlier
five-style demo. It is labeled as historical and does not include SLYE output.
The site is live; do not treat the examples as a guarantee of semantic fidelity.

The private generation and review lab is kept outside this repository. Source pins,
licenses, and adaptations are documented in [SOURCES.md](SOURCES.md).

## Development

```sh
npm test
npm run coverage
npm run build:playground
```

Tests use synthetic answers and fake model responses. They do not make live model calls.

The GitHub Pages workflow is active at `.github/workflows/pages.yml`. It builds only
`dist/playground/`. The public repository is
[jzlosman/declaw](https://github.com/jzlosman/declaw), and Pages is available at
[jzlosman.github.io/declaw](https://jzlosman.github.io/declaw/).

## License

Declaw is Apache-2.0. Third-party prompts and rules retain their original licenses.
See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), the source-specific `upstream/` directories under `src/plugins/built-in/`, and `licenses/`.
