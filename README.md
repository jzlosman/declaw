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

All six styles come with Declaw. You can install more as separate Pi packages or
build your own with [`PLUGIN_GUIDE.md`](PLUGIN_GUIDE.md), which includes instructions
for coding agents.

Some styles borrow rules from the originals rather than porting them in full.
Attribution doesn't imply endorsement or certification.

## Plugin architecture

Declaw protects the answer, calls the model, and displays the rewrite without adding
it to the agent's context. Plugins supply style instructions and the format used to
send the protected answer to the model.

Plugin IDs stay fixed, and each plugin has its own namespace for styles. Declaw rejects
ID collisions and saves your enable/disable choices separately from plugin code.
Disabled plugins still appear in `/declaw list`, but you can't pick them in `/declaw style`.

The [`declaw-style-pirate` example](https://github.com/jzlosman/declaw-style-pirate)
is a small, working third-party plugin. For the internals, see
[`ARCHITECTURE.md`](ARCHITECTURE.md) and [`GLOSSARY.md`](GLOSSARY.md).

## What Declaw preserves

Before sending an answer to the model, Declaw protects commands, paths, links, code,
quotations, numbers, names, and other technical text. It rejects rewrites that drop,
duplicate, reorder, or invent protected text.

It also checks for changes in meaning: `may` must not become `will`, an action the
assistant offers to take must not become an instruction to you, and prerequisites
must not become broader. Recommendations must keep their reasons, and useful tables
must stay tables.

These checks can miss changes in meaning. Compare important rewrites with the original.

## Context isolation, privacy, and limits

Rewrites are for you to read. The agent never gets them as context for future prompts,
tool planning, skill or prompt evaluation, or session compaction, so the new wording
can't influence its later work. Pi saves rewrites as display-only session entries;
they're still visible after reload.

The rewrite model receives only the one protected answer. Declaw doesn't send it
conversation history, earlier requests, project files, tools, or reasoning.

Declaw has its own model and style settings. Your main agent's model and thinking
level stay unchanged. The default rewrite model is:

```text
openai-codex/gpt-5.6-luna · low thinking
```

You need to be signed in to the selected provider, and provider charges apply.
Requests time out after 60 seconds, with provider retries disabled.

Declaw requires Pi's terminal UI and handles one rewrite at a time. It won't rewrite
incomplete answers, tool-call results, or answers over 32,000 characters.

## Playground

The [hosted playground](https://jzlosman.github.io/declaw/) shows saved rewrites.
It makes no model calls in your browser and collects no credentials or analytics.

```sh
npm run build:playground
open dist/playground/index.html
```

The examples were reviewed but come from the older five-style demo. They're labeled
as historical and don't include SLYE. The site is live, but the examples aren't a
guarantee that rewrites always preserve meaning.

The private lab for generating and reviewing examples lives outside this repository.
See [SOURCES.md](SOURCES.md) for pinned source versions, licenses, and adaptations.

## Development

```sh
npm test
npm run coverage
npm run build:playground
```

Tests use synthetic answers and fake model responses, with no live model calls.

The active GitHub Pages workflow, `.github/workflows/pages.yml`, builds only
`dist/playground/` from [jzlosman/declaw](https://github.com/jzlosman/declaw) and publishes
to [jzlosman.github.io/declaw](https://jzlosman.github.io/declaw/).

## License

Declaw is Apache-2.0. Third-party prompts and rules retain their original licenses.
See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), the source-specific `upstream/` directories under `src/plugins/built-in/`, and `licenses/`.
