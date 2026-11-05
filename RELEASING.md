# Releasing

Releases are published by a GitHub Actions workflow, never from a laptop. As a result, every tarball the workflow publishes carries **provenance**: the registry shows which commit and which workflow run built it. The one exception is a first publication by hand, below, which has none.

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
   - Update the dependencies between the packages to `^<version>` (a caret range on exactly that version: the pack check refuses an exact pin, so two copies of the engine are not installed side by side), and the versions the framework templates install (`packages/docs/templates/*/package.json`).
   - Update `VERSION` in `packages/core/src/version.ts`, and `RELEASE` in `packages/web-component/src/plugins.ts` (the plugin registry's key; the pack check holds both to the manifests).
   - Date each `CHANGELOG.md`'s "Unreleased" heading: `node scripts/sdk_changelog.mjs --date` (today, or `--date YYYY-MM-DD`). The release workflow refuses to publish a version whose six changelogs do not date it. (The first publication is 1.0.0.)
2. **Run the measurements** below on a quiet machine, on the release branch, and merge it once they and CI are green.
3. **Run the release workflow** from `main`: **Actions → Release → Run workflow**, with the dist-tag (`latest` or `next`). It refuses another branch, and a commit whose CI did not pass. Then, in four jobs with only the rights each needs:
   - **guard** checks the branch, the CI run and that the version fits the dist-tag;
   - **build** (read-only, no secret) builds and tests everything, checks the packages with `npm publish --dry-run` (a pre-release with `--allow-prerelease`), and packs the six tarballs;
   - **publish** installs nothing but a pinned npm (trusted publishing needs npm 11.5.1 or later) and runs no package script: it publishes those tarballs — `@temporeum/timeline-core`, then `@temporeum/timeline-element`, then `-react`, `-vue`, `-svelte`, `-angular` — with `--provenance`, skipping a version already on npm, so a run that stopped half-way can simply be started again;
   - **tag** tags the commit `v<version>`, unless it is tagged already.
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

- There is no npm token. The publish job runs in the `npm` environment and publishes through npm's **trusted publishing**: on npmjs.com, each of the six packages names this repository, the `release.yml` workflow **and the `npm` environment** as its trusted publisher (Settings → Trusted publishing). Naming the environment matters: without it any job of that workflow could publish; with it, only a job that ran in `npm` — after a maintainer approved it. On GitHub, restrict the `npm` environment's deployment branches to `main` (Settings → Environments → npm), so not even an approved run from another branch gets the token. Only that job requests `id-token: write`, which trusted publishing and provenance need.
- Only the tag job may write to the repository (`contents: write`); every other job reads.
- **The first publication.** If npm lets a trusted publisher be set only on a package that already exists, the six names have to exist before 1.0.0 goes out through the workflow: publish them once by hand from the build job's tarballs (download the `tarballs` artifact of a run whose publish job was not approved, then `npm publish ./<tgz> --access public --provenance=false` for each, in the order above), set the trusted publisher on each, and from then on the workflow publishes alone. `--provenance=false` is needed because each package's `publishConfig` asks for provenance, which npm can only generate in CI: outside it the publish fails with "Automatic provenance generation not supported for provider: null". The versions published this way carry no provenance; the registry shows it, and the next release, from the workflow, does.
- Only maintainers with release rights can approve the `npm` environment.

## If a release goes wrong

- Don't unpublish. Publish a fixed patch version.
- If a version is broken badly enough, deprecate it with `npm deprecate`, naming the version to use instead.
