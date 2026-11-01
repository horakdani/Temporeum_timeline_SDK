# Releasing

Releases are published by a GitHub Actions workflow, never from a laptop. As a result, every tarball on npm carries **provenance**: the registry shows which commit and which workflow run built it.

## Versioning

- The six packages share one version and are always released together: `@temporeum/timeline-core`, `-element`, `-react`, `-vue`, `-svelte` and `-angular`.
- [Semantic versioning](packages/docs/site/pages/stability.md):
  - **patch** for fixes;
  - **minor** for additions and deprecations;
  - **major** for removals, which must have been deprecated in a minor release first.
- A pre-release uses a suffix (`1.1.0-rc.0`) and is published under the `next` dist-tag, never `latest`.

## Steps

1. **Prepare the release in a pull request:**
   - Set the version in the `package.json` of each of the six packages (`packages/core`, `web-component`, `react`, `vue`, `svelte`, `angular`).
   - Update the dependencies between the packages to that exact version, and the versions the framework templates install (`packages/docs/templates/*/package.json`).
   - Update `VERSION` in `packages/core/src/version.ts`.
   - Turn each `CHANGELOG.md`'s "not yet published" heading into the version and the date. (The first publication is 1.0.0.)
2. **Merge it** once CI is green.
3. **Run the release workflow:** **Actions → Release → Run workflow**, with the dist-tag (`latest` or `next`). The workflow then:
   - builds and tests everything;
   - checks the packages with `npm publish --dry-run`;
   - publishes `@temporeum/timeline-core`, then `@temporeum/timeline-element`, then the four framework packages (`-react`, `-vue`, `-svelte`, `-angular`), each with `--provenance`;
   - tags the commit `v<version>`.
4. **Write the GitHub release** from the changelog entries.

## Secrets and permissions

- The workflow runs in the `npm` environment. Its `NPM_TOKEN` secret is an npm automation token with publish rights for the `@temporeum` scope. Once npm trusted publishing is set up for the six packages, the token can be removed.
- The workflow requests `id-token: write`, which npm provenance needs.
- Only maintainers with release rights can approve the `npm` environment.

## If a release goes wrong

- Don't unpublish. Publish a fixed patch version.
- If a version is broken badly enough, deprecate it with `npm deprecate`, naming the version to use instead.
