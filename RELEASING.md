# Releasing

Releases are published by a GitHub Actions workflow, never from a laptop. As a result, every tarball on npm carries **provenance**: the registry shows which commit and which workflow run built it.

## Versioning

- The six packages share one version and are always released together: `@temporeum/timeline-core`, `-element`, `-react`, `-vue`, `-svelte` and `-angular`.
- [Semantic versioning](https://horakdani.github.io/Temporeum_timeline_SDK/stability.html):
  - **patch** for fixes;
  - **minor** for additions and deprecations;
  - **major** for removals, which must have been deprecated in a minor release first.
- A pre-release uses a suffix (`1.1.0-rc.0`) and is published under the `next` dist-tag, never `latest`.

## Steps

1. **Prepare the release in a pull request:**
   - Set the version in the `package.json` of each of the six packages (`packages/core`, `web-component`, `react`, `vue`, `svelte`, `angular`).
   - Update the dependencies between the packages to that exact version, and the versions the framework templates install (`packages/docs/templates/*/package.json`).
   - Update `VERSION` in `packages/core/src/version.ts`.
   - Date each `CHANGELOG.md`'s "Unreleased" heading: `node scripts/sdk_changelog.mjs --date` (today, or `--date YYYY-MM-DD`). The release workflow refuses to publish a version whose six changelogs do not date it. (The first publication is 1.0.0.)
2. **Run the measurements** below on a quiet machine, on the release branch, and merge it once they and CI are green.
3. **Run the release workflow:** **Actions → Release → Run workflow**, with the dist-tag (`latest` or `next`). The workflow then:
   - builds and tests everything;
   - checks the packages with `npm publish --dry-run`;
   - publishes `@temporeum/timeline-core`, then `@temporeum/timeline-element`, then the four framework packages (`-react`, `-vue`, `-svelte`, `-angular`), each with `--provenance`;
   - tags the commit `v<version>`.
4. **Write the GitHub release** from the changelog entries.

## Measurements

CI checks everything that does not depend on the machine's speed (the README of `@temporeum/timeline-core` lists those budgets). What does is measured here, before each release, on a machine doing nothing else — a busy machine misses frames the library does not:

```bash
npm run build
npm run bench:assert -w @temporeum/timeline-core       # frames missed, the engine's own page
npm run bench:memory -w @temporeum/timeline-core       # nodes created in a long pan
npm run bench:schedule -w @temporeum/timeline-core     # scheduling 10 000 tasks
npm run bench:public -w @temporeum/timeline-docs       # frames missed, through createTimeline
npm run bench:deep -w @temporeum/timeline-docs         # 4x pinch zoom
npm run bench:wheel -w @temporeum/timeline-docs        # ctrl+wheel zoom from a fresh page
npm run bench:labels -w @temporeum/timeline-docs       # the 10 000-item comparison page
npm run bench:pan-memory -w @temporeum/timeline-docs   # heap growth over its pan
npm run bench:gantt -w @temporeum/timeline-docs        # 10 000 tasks and dependencies
npm run bench:resources -w @temporeum/timeline-docs    # 500 resources, 10 000 assignments
npm run test:e2e:touch:webkit -w @temporeum/timeline-docs   # WebKit, and Mobile Safari on macOS
node scripts/sdk_check_acr.mjs                         # every test the conformance report names
```

Each prints `<name>: passed` or fails with what it measured. `test:e2e:touch:webkit` drives the iOS Simulator through `safaridriver` and needs macOS with Xcode; the published benchmark page (`npm run bench:field -w @temporeum/timeline-docs`, about 45 minutes) is measured again when its numbers should change. [scripts/README.md](scripts/README.md) says what each check proves.

## Secrets and permissions

- The workflow runs in the `npm` environment. Its `NPM_TOKEN` secret is an npm automation token with publish rights for the `@temporeum` scope. Once npm trusted publishing is set up for the six packages, the token can be removed.
- The workflow requests `id-token: write`, which npm provenance needs.
- Only maintainers with release rights can approve the `npm` environment.

## If a release goes wrong

- Don't unpublish. Publish a fixed patch version.
- If a version is broken badly enough, deprecate it with `npm deprecate`, naming the version to use instead.
