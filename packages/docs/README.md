# Docs workspace

The documentation site, its live examples and recipes, the framework
templates, the throttled benchmark, and the end-to-end suites that run under
Playwright device emulation.

It is a workspace like the packages it documents, and the commands below
address it by package name (`-w @temporeum/timeline-docs`).

## The site

```bash
npm run build -w @temporeum/timeline-docs      # → packages/docs/dist
npm run serve -w @temporeum/timeline-docs      # http://127.0.0.1:31737/site/
```

- `site/pages/` — the pages, in the Markdown subset of `scripts/markdown.mjs`;
  `site/nav.json` orders them, and a page missing from it fails the build.
- `site/examples/<id>/` — the live examples: `example.js`, an optional
  `example.html`, and `meta.json` with what the running example must show.
- `templates/` — one starter project per framework.
- `site/benchmark/results.json` — written by `npm run bench:compare`.

The live examples run in a sandboxed frame (`allow-scripts`, no
`allow-same-origin`; an example that saves a file or prints lists
`"allow": ["downloads", "modals"]` in its `meta.json`) and import the shipped bundles from `dist/lib` through an
import map, so a host serving the site has to allow cross-origin reads
(`Access-Control-Allow-Origin: *`; GitHub Pages sends it, `e2e/serve.mjs`
does too).

## The rule for code blocks

Every code block on the site and in the packages' READMEs is either a whole
live example or marked as an excerpt of one — ```` ```js excerpt:example/gantt ````
or `excerpt:template/react/src/App.jsx` — and then every line it shows must
be in that source, in order. Shell sessions and plain text are exempt.
`npm run test:examples` checks the blocks, runs every example in Chromium,
and builds and runs every template from the packed packages.

## The suites

`test` (the builder's unit tests), `test:examples`, `test:a11y`,
`test:e2e:touch`, `test:e2e:responsive`, `test:e2e:async`,
`test:e2e:cluster`, `test:ssr`, `bench:compare`. What each check behind them
proves is in [`scripts/README.md`](../../scripts/README.md).

## When a drawing changes on purpose

The core's visual and right-to-left suites compare every frame of their
matrix with committed SVG fixtures, byte for byte. A change that is meant to
alter the drawing writes them again, from the repository root:

```bash
node scripts/sdk_visual_snapshots.mjs        # the visual matrix: packages/core/test/visual/fixtures
node scripts/sdk_rtl_snapshots.mjs           # the same, right to left: packages/core/test/rtl/fixtures
node scripts/sdk_visual_snapshots.mjs --html /tmp/visual.html   # every fixture on one page, to look at
```

Look at the diff before you commit it: the fixtures are what the review sees.
