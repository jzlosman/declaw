# Declaw playground

The playground is a static comparison page. It uses saved outputs only.
Visitors do not send model requests, provide credentials, or generate analytics.

## Build and open

Node 24. No package install is required for the static build.

```sh
npm run build:playground
open dist/playground/index.html
```

For an HTTP preview:

```sh
npm run playground
open http://127.0.0.1:4197
```

GitHub Pages serves only the generated `dist/playground/` directory. It does not
serve the private generation lab or any Pi session data.

## Reading and changes

- The long-form example opens first.
- Choose an example and reading mode in the rail, or use the mobile selectors.
- Desktop shows the original and rewrite side by side.
- Mobile uses Original/Rewrite tabs and normal page scrolling.
- **Show changes** opens one combined inline diff.
- Copy buttons return the exact saved Markdown.

The diff keeps common wording in place. Removed wording is crossed out. Added
wording is underlined. Lists, tables, code, and paragraph structure remain readable.
Whitespace-only changes show **Unchanged**.

The standalone E logo is used where the full wordmark does not fit. Credits link to
source repositories and license texts. Source attribution distinguishes local presets,
adaptations, and prompt sources.

## Data

`samples.json` contains four synthetic inputs and twenty reviewed historical outputs.
The recordings use the earlier five-style package and are labeled accordingly.
Speak Like You Eat is built into the Declaw extension but has no public recording yet.
Do not relabel old outputs or invent new examples.

`markdown.ts` renders a bounded inert subset of Markdown. Raw HTML is escaped.
Links and images do not load. `unified.ts` and `inline-diff.ts` align safe rendered
blocks without changing saved source or rewrite text.

The private generation and review lab is stored outside this repository. It is not
part of the hosted site or the public source tree.

## Verification

```sh
npm test
npm run build:playground
```

The build validates the saved snapshot and emits a self-contained Pages artifact.
Native Safari/iOS verification remains open.
