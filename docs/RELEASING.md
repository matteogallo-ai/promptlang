# Releasing

`.github/workflows/release.yml` publishes to npm. A maintainer pushes the tag; no
agent pushes, tags or publishes.

## What a release does

On a `v*` tag:

1. The whole CI workflow (`ci.yml`) runs on the tagged commit. This includes the
   `package` job: `npm pack --dry-run`, and `scripts/consumer-test.ts` on Node 20
   and the current LTS.
2. If the tag differs from `v` + `package.json` `version`, the release stops.
3. `npm publish --provenance --access public` publishes `@promptlang/core`. `prepack`
   runs `scripts/build.ts` first, so the tarball holds a fresh `dist/`.
4. `@promptlang/yaml-parser` is published only if its `package.json` version is not
   on npm yet.

To see what would be published without publishing anything, run the workflow by
hand (**Actions → Release → Run workflow**). `dry_run` is checked by default: every
`npm publish` gets `--dry-run`. Locally, `npm publish --dry-run --access public`
shows the same tarball.

## What the maintainer configures once

**GitHub environment `npm`** (Settings → Environments). The `publish` job runs in
it, so required reviewers set there gate every publish.

Then one of the two credentials below.

### A. An npm access token (what `release.yml` uses as written)

- On npmjs.com, create a granular access token with **read and write** permission
  on the `@promptlang` scope (or on the packages `@promptlang/core` and
  `@promptlang/yaml-parser`). It must be allowed to publish without an interactive
  2FA prompt.
- Store it as the secret `NPM_TOKEN` of the `npm` environment. The workflow passes
  it as `NODE_AUTH_TOKEN`; `actions/setup-node` writes the matching `.npmrc`.
- Provenance still works with a token: the `publish` job has
  `permissions: id-token: write`. It runs on a GitHub-hosted runner, and
  `package.json` `repository.url` (`git+https://github.com/matteogallo-ai/promptlang.git`)
  matches the repository, case included. Those are npm's provenance requirements
  (<https://docs.npmjs.com/generating-provenance-statements>).

### B. Trusted publishing (no token)

npm's trusted publishing authenticates the workflow through OIDC and adds provenance
by default (<https://docs.npmjs.com/trusted-publishers>). It requires npm CLI ≥ 11.5.1
and Node ≥ 22.14.0. To use it:

- On npmjs.com, for each package: **Trusted Publisher → GitHub Actions**, with
  organization `matteogallo-ai`, repository `promptlang`, workflow filename
  `release.yml` and environment `npm`.
- In `release.yml`, upgrade npm before publishing (`npm install -g npm@latest`) and
  remove the two `NODE_AUTH_TOKEN` lines.

The setting lives on the package's own page on npmjs.com, which
`@promptlang/core` does not have before its first publish: that publish uses
option A.

## Before tagging

- `CHANGELOG.md`: move `[Unreleased]` under the new version and date.
- Bump `package.json` `version` (and `packages/yaml-parser/package.json` if it
  changed). `bun run check:claims` and the `v1-stability` tests must pass.
- Write the release notes under `docs/release-notes/`.
