# Adapted writing presets

I Have ADHD, Squirrel Mode, and ASD-STE100 are **adaptations of output rules**,
not installations of the original skills or claims of equivalent behavior.
Paseo Plain and Speak Like You Eat retain pinned source prompts. All six built-in
styles receive short advisory host guidance. Each style owns its transformation;
Declaw does not enforce meaning or exact-text preservation.
Paseo Plain's repository license is Apache-2.0; its retained Claudish wording
and the three adapted skills are MIT-licensed. Copyright notices and license
texts are retained beside the relevant plugin or in `licenses/`.
No endorsement by the original authors is claimed.

## Paseo Plain (`plain`)

Source: [scowalt/paseo-plain, server/prompt.ts](https://github.com/scowalt/paseo-plain/blob/35e63ee2e5f17a5bad40a8772c84fa5f21a8678f/server/prompt.ts)

Revision: `35e63ee2e5f17a5bad40a8772c84fa5f21a8678f`, prompt policy 5.
Copyright 2026 scowalt — [upstream Apache-2.0 license and notices](src/plugins/built-in/paseo-plain/upstream/LICENSE).

`src/plugins/built-in/paseo-plain/upstream/prompt.ts` retains the upstream source unchanged.
The Paseo Plain plugin uses that prompt with advisory host guidance and an unmasked
answer. Fidelity preferences in this pinned prompt belong to this style, not to a
host-wide enforcement layer. No earlier request or reader profile is supplied.
The default model is Luna with low thinking, not necessarily the upstream application's model.

The upstream prompt retains wording from Mike Gvozdev's Claudish to English
v0.9.0, revision `bf271f95fd2c1a7d00ea545bbc6de44a1b6a1d3c`.
Its [MIT notice](src/plugins/built-in/paseo-plain/upstream/Claudish-MIT.txt) is included as well.

Earlier `plain-lab-1` and `plain-lab-2` recordings used custom local prompts,
not Scott's writing prompt. Do not retroactively label their results as upstream
prompt outputs. Source-faithful integration is not proof of model fidelity.
Historical `package-styles-8` recordings used exact-text masking and rejection.
That mechanism is no longer part of the runtime. The original upstream helper remains
in `src/plugins/built-in/paseo-plain/upstream/rewriter.ts` for attribution/reference only;
it is not executed by Declaw.

## Terse (`terse`)

A local control preset, not adapted from a third-party skill.

## I Have ADHD (`adhd`, formerly Action first)

Source: [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd/blob/6f1f982d0a47c65899af3c5a7450b7098bc65325/skills/i-have-adhd/SKILL.md)

Revision: `6f1f982d0a47c65899af3c5a7450b7098bc65325`

Copyright (c) 2026 Ayoub Ghriss — [MIT license](licenses/i-have-adhd-LICENSE).

Retained: action-first orientation, visible completed work, numbered bounded
steps, small groups, matter-of-fact errors, no filler or pleasantries, and a
source-supported next action when useful.

Changed: no session persistence, tools, invented estimates, assumed diagnosis,
made-up progress counts, or new questions. Short labeled groups and useful next
actions are preferred without fixed item counts or exhaustive detail requirements.
The mode does not assume any medical condition in the reader.

## Squirrel Mode (`squirrel`)

Source: [thgMatajs/squirrel-mode canonical base rules](https://github.com/thgMatajs/squirrel-mode/blob/6cf8a4103779183b6a55066e6a736ff73b94ba50/rules/base-rules.md)

Revision: `6cf8a4103779183b6a55066e6a736ff73b94ba50`

Copyright (c) 2026 Thiago Matajs — [MIT license](licenses/squirrel-mode-LICENSE).

Retained: answer first, one concept per paragraph, numbered steps in small groups,
code-first presentation when code is the answer, separate answers for separate
questions, neutral tone, and grouped workstream status when the source supports it.

Changed: a fixed experimental profile replaces the upstream persistent profile.
No checkpoint files, scope guard, topic-switch questions, tool calls, new
estimates, or cross-turn state. Options, later phases, and necessary explanation
remain visible even when the upstream profile would delay or limit them. Safety
conditions precede the relevant code or action. This is not a port of the separate
`squirrel:digest` skill and does not impose its fixed multi-section brief.

## ASD-STE100 skill (`ste`, formerly Technical)

Source: [danyuchn/asd-ste100-skill](https://github.com/danyuchn/asd-ste100-skill/blob/7d4a135a199a5d7447c4886bcd7ffe742a627bc9/SKILL.md)

Revision: `7d4a135a199a5d7447c4886bcd7ffe742a627bc9`

Copyright (c) 2026 Dustin Yuchen Teng — [MIT license](licenses/asd-ste100-skill-LICENSE).

Retained: the STE-flavored approach, explicit subjects, active voice when the
actor is known, consistent terminology, one instruction per sentence, short
sentences and noun phrases, literal verbs, and preservation of modality.

Changed: short sentences support technical clarity rather than minimum length or
certified constraints. The style favors explicit actors, consequential conditions,
and meaningful uncertainty, while allowing distracting secondary detail to be omitted.
It does not add definitions, rule tables, or compliance claims. This package does
not port the upstream linter.

**No official ASD dictionary or standard text is bundled.** The upstream skill
also excludes the official dictionary and disclaims certified compliance. Its MIT
license does not grant redistribution rights to the separate ASD standard. This
mode is STE-inspired, not a certified or dictionary-validated ASD-STE100 tool.

## Speak Like You Eat (`slye`, built in)

Source: [wtfzambo/speak-like-you-eat, src/model-rewrite.ts](https://github.com/wtfzambo/speak-like-you-eat/blob/e1725d982ec5b03fe26e7d637ce2d9384c3ef820/src/model-rewrite.ts)

Stable version: `1.1.0`; revision `e1725d982ec5b03fe26e7d637ce2d9384c3ef820`.
Copyright (c) 2026 wtfzambo — [MIT license](licenses/speak-like-you-eat-LICENSE).

`src/plugins/built-in/speak-like-you-eat/upstream/model-rewrite.ts` contains the retained
prompt fragment. The plugin uses advisory host guidance and the original `Context:` / `Target:`
envelope with empty context. It preserves the source language and intentional
language mix. The upstream README credits Claudish to English as inspiration.

SLYE is fully integrated into the same manual rewrite command, model selection,
context isolation, cancellation, storage and style picker as the other five
styles. Use `/declaw slye` once or save it with `/declaw style`; no separate package
is installed. Private evaluation tooling also uses it by default. We intentionally do not import
upstream automatic rewriting or conversation collection, because this package
rewrites only when asked and never changes the agent's conversation.

The newer unreleased rule broadly deleting contrastive negations was not imported;
it can conflict with retaining meaningful caveats. Fresh demo recordings for this
shared engine still require an authorized run and review.

## Shared boundary

The original answer is passed to the plugin's input formatter, and the result stays
out of the main conversation. Model access, isolation, cancellation, output bounds,
and display storage belong to the host. Content transformation belongs to the style.

Host guidance in `src/domain/styles.ts` is advisory. Styles can intentionally change,
omit, or add content; there is no mandatory editor, semantic review, or exact-text
validation. A style's own stricter preferences do not become requirements for other plugins.

GEPA and other prompt experiments are optional private development tools, not runtime,
installation, or release requirements.
