# Governance

## Who decides

The project has one maintainer today, Daniel Horak, who decides what is merged and released. That is the project's biggest risk, and we say so openly: a library that one person keeps alive can stop when that person does. **A second maintainer is the most valuable contribution this project can get.** If you have sent a few good pull requests and want to help keep the project running, say so in an issue.

## How a second maintainer is added

A contributor with a track record of merged pull requests and reviews can be invited by an existing maintainer. Maintainers have merge rights. Release rights (the npm publish environment) follow after a release has been done together.

## How decisions are made

- **Everyday changes:** a pull request with green checks and one maintainer's approval.
- **Public API changes:** an issue first, open for at least 7 days for comments, then a maintainer decides and writes the reasoning in the issue. The [stability policy](packages/docs/site/pages/stability.md) says what counts as public.
- **Breaking changes:** only in a major release. Anything removed is deprecated in a minor release first, at least one minor before the major.
- **Disagreement:** the maintainers decide, and write down why in the issue or pull request, so the reasoning stays on record.

## What the project will not do

- Add runtime dependencies to the engine.
- Collect telemetry.
- Move features from the MIT licence to a paid licence. Everything released under MIT stays MIT.

## Changes to this document

Changes to this document go through a pull request, like any other change.
