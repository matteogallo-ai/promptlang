# Releasing

`.github/workflows/release.yml` publishes to npm through npm trusted publishing:
the workflow authenticates with its OIDC token, and no npm token is stored anywhere.
A maintainer pushes the tag; no agent pushes, tags or publishes.

## What a release does

On a `v*` tag:

1. The whole CI workflow (`ci.yml`) runs on the tagged commit. This includes the
   `package` job: `npm pack --dry-run`, and `scripts/consumer-test.ts` on Node 20
   and the current LTS.
2. The `publish` job installs a pinned npm (`npm install -g npm@11.21.1`), prints
   `node --version` and `npm --version`, and stops if Node is below 22.14.0 or npm
   below 11.5.1, the trusted-publishing minimums. A manual dry run also runs this
   check.
3. If the tag differs from `v` + `package.json` `version`, the release stops.
4. It checks whether the `@promptlang/yaml-parser` version is on npm. Only an
   `E404` answer means "not on npm"; any other registry error stops the release
   before anything is published.
5. `npm pack` builds the `@promptlang/core` tarball once (`prepack` runs
   `scripts/build.ts` first, so it holds a fresh `dist/`). npm, the attestation and
   the GitHub Release all get these bytes.
6. `actions/attest-build-provenance` signs a SLSA build provenance for the tarball
   (Sigstore, short-lived certificate from the workflow's OIDC token) and stores it
   in the repository's attestations. The tarball and its bundle are then saved as
   the run's `release-assets` artifact. If either step fails, nothing has been
   published.
7. `npm publish <tarball> --provenance --access public` publishes `@promptlang/core`.
   npm exchanges the job's OIDC token for a short-lived publish credential; the
   job reads no secret, and `tests/workflows.test.ts` ("the release publishes
   through trusted publishing, with no npm token") fails if `release.yml` names one.
8. `@promptlang/yaml-parser` is published if step 4 found its version missing.
9. The `github-release` job creates the GitHub Release for the tag, with
   `docs/release-notes/<tag>.md` as its body and two assets: the tarball and its
   attestation bundle, `promptlang-core-<version>.tgz.sigstore.json`. Only that job can write to the
   repository's contents.

There is no GitHub Release without its signed attestation:
`scripts/check-workflows.ts` fails CI when a `run:` script calls `gh release create`
or `gh release upload` without naming a `.sigstore.json` file, or when its job (or
a job it needs directly) has no attestation step. An unsigned release would count 0
in the average Scorecard's Signed-Releases check takes over the last five releases
(releases with no assets are skipped). Scorecard reads the `.sigstore.json`
suffix as a signature (8/10); its 10/10 needs an `.intoto.jsonl` asset, which this
workflow does not produce. `@promptlang/yaml-parser` is not attached to the release.

A prerelease version (one with a `-`, such as `2.1.0-rc.1`) is published under the
`next` dist-tag, so `npm install @promptlang/core` keeps installing the last stable
version. A `concurrency` group keeps two releases from running at once.

Running the workflow by hand (**Actions → Release → Run workflow**) is always a dry
run: the tarball is packed, every `npm publish` gets `--dry-run`, and there is no
attestation and no GitHub Release, whatever the branch. Only a pushed tag publishes.
Locally, `npm publish --dry-run --access public` shows the same tarball.

## If a release stops halfway

npm refuses to publish a version twice, so re-running the `publish` job after
`@promptlang/core` is on npm fails at that step. Two cases:

- `publish` succeeded and `github-release` failed: re-run only the failed job
  (**Re-run failed jobs**). If it cannot download `release-assets`, use the
  commands below.
- `publish` failed after `@promptlang/core` was published (for example on
  `@promptlang/yaml-parser`): publish `@promptlang/yaml-parser` by hand if needed,
  then create the release from the run's artifact, which holds the published bytes:

  ```bash
  gh run download <run-id> --repo matteogallo-ai/promptlang -n release-assets -D release-assets
  gh release create v2.0.0 release-assets/*.tgz release-assets/*.tgz.sigstore.json \
    --verify-tag --title "PromptLang 2.0.0" --notes-file docs/release-notes/v2.0.0.md
  ```

## What the maintainer configures once

**GitHub environment `npm`** (Settings → Environments). The `publish` job runs in
it, so required reviewers set there gate every publish.

**A trusted publisher on each package** (npmjs.com → the package → **Settings** →
**Trusted Publisher** → **GitHub Actions**), for `@promptlang/core` and
`@promptlang/yaml-parser`, with:

| Field | Value |
|---|---|
| Organization or user | `matteogallo-ai` |
| Repository | `promptlang` |
| Workflow filename | `release.yml` |
| Environment name | `npm` |

Every field is case-sensitive. npm checks them against the job's OIDC token, so a
publish from another repository, workflow or environment is refused
(<https://docs.npmjs.com/trusted-publishers>). Provenance needs a GitHub-hosted
runner and `package.json` `repository.url`
(`git+https://github.com/matteogallo-ai/promptlang.git`) matching the repository,
case included (<https://docs.npmjs.com/generating-provenance-statements>).

Once a release has gone out this way, set each package's **Publishing access** to
**Require two-factor authentication and disallow tokens**: trusted publishing is
not a token, so releases keep working ("Your trusted publishers will continue to
work normally, as they use OIDC tokens"), and a leaked npm token can no longer
publish. Then revoke any npm token created for releases on npmjs.com, and delete
the `NPM_TOKEN` secret from the `npm` environment.

## Before tagging

- `CHANGELOG.md`: move `[Unreleased]` under the new version and date.
- Bump `package.json` `version` (and `packages/yaml-parser/package.json` if it
  changed). `bun run check:claims` and the `tests/stability.test.ts` tests must pass.
- Write the release notes as `docs/release-notes/<tag>.md` (for example
  `v2.0.0.md`). The release stops before publishing if the file is missing.

## Verifying a release

```bash
gh release download v2.0.0 --repo matteogallo-ai/promptlang
gh attestation verify promptlang-core-2.0.0.tgz --repo matteogallo-ai/promptlang \
  --signer-workflow matteogallo-ai/promptlang/.github/workflows/release.yml
gh attestation verify promptlang-core-2.0.0.tgz --repo matteogallo-ai/promptlang \
  --signer-workflow matteogallo-ai/promptlang/.github/workflows/release.yml \
  --bundle promptlang-core-2.0.0.tgz.sigstore.json
```

The first `verify` reads the attestation from GitHub, the second from the bundle
attached to the release. Both check that the tarball's SHA-256 was signed by
`release.yml` of this repository; without `--signer-workflow`, any workflow of the
repository would pass.
