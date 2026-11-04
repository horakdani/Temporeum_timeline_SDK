# Contributing

Thank you for considering a contribution. This file explains how the repository works, what a change needs before it can be merged, and where to ask first.

## Before you write code

- **Bugs:** open an issue with a minimal reproduction. A failing example in a fork of one of the [starter templates](packages/docs/templates) is ideal. Say which package and version you use, and which browser.
- **Features:** open an issue or a discussion before a pull request. The public API follows semantic versioning ([stability policy](https://horakdani.github.io/Temporeum_timeline_SDK/stability.html)), so every new option has to be kept until the next major version. We would rather agree on its shape first.
- **Security issues:** never in a public issue. See [SECURITY.md](SECURITY.md).

## Setting up

You need Node 22.12 or later.

```bash
npm ci
npm run build
npm test
```

The browser suites (examples, accessibility, touch, server rendering) run in Chromium through Playwright:

```bash
npx playwright install chromium
npm run test:examples -w @temporeum/timeline-docs
npm run test:a11y -w @temporeum/timeline-docs
```

### When a visual fixture fails

`npm run test:visual -w packages/core` and `npm run test:rtl -w packages/core` compare the drawing with committed SVG files byte for byte. If your change alters the drawing on purpose, write the fixtures again (`node scripts/sdk_visual_snapshots.mjs`, `node scripts/sdk_rtl_snapshots.mjs`), look at them (`node scripts/sdk_visual_snapshots.mjs --html /tmp/visual.html` puts every one on a page), and commit them with the change: the diff is part of the review.

## The repository

| Path | What it holds |
|---|---|
| `packages/core` | The engine. DOM-free: everything except `src/dom/` must run in Node. |
| `packages/web-component` | `createTimeline`, `<temporeum-timeline>`, server rendering. |
| `packages/react`, `packages/vue`, `packages/svelte`, `packages/angular` | The framework components, each a thin shell around the element's instance. |
| `packages/docs` | The documentation site, its live examples, the starter templates and the benchmark. |
| `scripts` | The checks behind the documentation's claims, the benchmarks and the release tools — [scripts/README.md](scripts/README.md) lists each one. |

## What a pull request needs

1. **A test for the change.** Write it before the fix: a bug fix comes with the test that failed before it. If you cannot write a test, say why in the pull request.
2. **Green checks:** `npm run lint`, `npm run typecheck`, `npm test`. CI runs these on Node 22 and 24.
3. **No new runtime dependency** in `@temporeum/timeline-core`. The engine has none, and a check enforces it (`npm run deps`).
4. **No `any` on the public surface.** The typecheck enforces this too.
5. **The size budget holds:** `npm run size`. Each entry point has its own limit. If a change needs more bytes, say why in the pull request; raising a budget is a decision, not a side effect.
6. **Accessibility.** If you add an interaction, add its keyboard equivalent, and keep the accessibility suite at 0 violations.
7. **A changelog line** under the next version in each `CHANGELOG.md` your change touches, written for the people who use the package.

Pull requests are squash-merged. The title becomes the commit message, so make it say what changes for a user.

## Style

The repository's ESLint and TypeScript settings are the style guide. Comments explain *why*, not *what*. Public names are complete words, not abbreviations.

## Conduct

The project follows the [code of conduct](CODE_OF_CONDUCT.md) (the Contributor Covenant 2.1). Report a conduct problem privately, as it says.

## Licence

By contributing, you agree that your contribution is licensed under the project's [MIT licence](LICENSE).
