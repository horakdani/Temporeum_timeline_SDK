/**
 * The flags every `npm publish --dry-run` of the release checks runs with.
 *
 * npm 11 (the one Node 24 bundles, so CI's and the release build's) fetches
 * the packument during a dry run and refuses a version the registry already
 * has: "You cannot publish over the previously published versions". The pack
 * check judges the tarball, not whether the version is still free, so once
 * 1.0.0 was on npm it failed on every push until the next version bump, and
 * the documented first publication (by hand, then the workflow once to tag)
 * died in the build job (X1).
 *
 * So the dry run asks a registry that is not there: a loopback port nothing
 * listens on, without retries. npm reports what it would publish and does not
 * mind that the packument cannot be fetched. It also keeps the check off the
 * network. Both the registry and the scoped one are set, so an `.npmrc` with
 * `@temporeum:registry` cannot send it back to npmjs.com.
 */
export const NOWHERE_REGISTRY = "http://127.0.0.1:9/";

export const NPM_DRY_RUN_FLAGS = Object.freeze([
  "--dry-run",
  "--provenance=false",
  "--ignore-scripts",
  `--registry=${NOWHERE_REGISTRY}`,
  `--@temporeum:registry=${NOWHERE_REGISTRY}`,
  "--fetch-retries=0",
]);
