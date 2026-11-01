# Contributing

Thank you for considering a contribution. This file explains how the repository works, what a change needs before it can be merged, and where to ask first.

## Before you write code

- **Bugs:** open an issue with a minimal reproduction. A failing example in a fork of one of the [starter templates](packages/docs/templates) is ideal. Say which package and version you use, and which browser.
- **Features:** open an issue or a discussion before a pull request. The public API follows semantic versioning ([stability policy](packages/docs/site/pages/stability.md)), so every new option has to be kept until the next major version. We would rather agree on its shape first.
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

## The repository

| Path | What it holds |
|---|---|
| `packages/core` | The engine. DOM-free: everything except `src/dom/` must run in Node. |
| `packages/web-component` | `createTimeline`, `<temporeum-timeline>`, server rendering. |
| `packages/react` | The React wrapper. |
| `packages/docs` | The documentation site, its live examples, the starter templates and the benchmark. |
| `scripts` | The checks CI runs on top of the unit tests. |

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

Be kind and assume good faith. Criticise code, not people. A maintainer may lock a thread, delete a comment or ban an account for harassment, insults or discrimination, and will say which rule was broken. Report conduct problems the same private way as security issues ([SECURITY.md](SECURITY.md)).

## Licence

By contributing, you agree that your contribution is licensed under the project's [MIT licence](LICENSE).
