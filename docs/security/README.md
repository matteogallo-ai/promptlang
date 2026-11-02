# Supply-chain security records

## `scorecard-before.json`: the score before

[OpenSSF Scorecard](https://github.com/ossf/scorecard) on `main` at `28c9223`, before
the supply-chain changes (Dependabot, pinned actions, CodeQL, OSV-Scanner,
Scorecard workflow). Overall score 4.8/10. Produced with:

```bash
GITHUB_AUTH_TOKEN=$(gh auth token) docker run --rm -e GITHUB_AUTH_TOKEN \
  ghcr.io/ossf/scorecard@sha256:c0a21a1c33a2d8819937d0a8a62e6f4189c800639abd9f0bfbe61c90c71fae90 \
  --repo=github.com/matteogallo-ai/promptlang --format=json --show-details
```

The image is Scorecard v5.6.0. `gcr.io/openssf/scorecard:stable` refused the pull
(registry billing error), so the same release was taken from `ghcr.io`, pinned by
digest. The file is the command's output, reformatted by Biome; the token is passed
through the environment and appears nowhere in it.

`.github/workflows/scorecard.yml` publishes the score on each push to `main` and
weekly; the README badge reads it. Until that workflow has run once on `main`, the
badge shows no score.

## `scorecard-after.json`: the score check by check

The result published by `scorecard.yml` for `main` at `b3270b7` (2026-11-02),
read from `https://api.scorecard.dev/projects/github.com/matteogallo-ai/promptlang`:
**6.6/10**. Scorecard weighs each check (Critical 10, High 7.5, Medium 5, Low 2.5)
and leaves out the checks scored -1. The live value is the README badge; this file
records one run so that the explanations below can be checked against it.

| Check | Score | Why |
| ----- | ----- | --- |
| Binary-Artifacts | 10 | No binary file is tracked. |
| Branch-Protection | 3 | `main` has a ruleset: pull request, required checks, no force-push, no deletion. Scorecard's higher tiers ask for approving reviews and code-owner review, which a single maintainer cannot give to their own pull requests. |
| CI-Tests | 10 | Every merged pull request ran CI. |
| CII-Best-Practices | 0 | The project is not registered on bestpractices.dev. |
| Code-Review | 0 | Low by nature on a solo repository: Scorecard counts changesets approved by someone other than their author, and there is no second maintainer. Each change is reviewed by an independent agent and by the maintainer, which Scorecard cannot see and does not count. |
| Contributors | 0 | Low by nature on a solo repository: Scorecard counts contributors from at least three distinct organisations. One author scores 0. |
| Dangerous-Workflow | 10 | No `pull_request_target`, no untrusted input in `run:`; `tests/workflows.test.ts` keeps it so. |
| Dependency-Update-Tool | 10 | `.github/dependabot.yml`. |
| Fuzzing | 0 | No fuzzing or property-based tests detected. |
| License | 10 | `LICENSE` is the MIT text; GitHub reports its SPDX id as `MIT`. |
| Maintained | 0 | The repository was created on 2026-08-11; Scorecard scores 0 for its first 90 days, whatever the activity. |
| Packaging | -1 | Scorecard has detected no successful run of a publishing workflow: `release.yml` has never published. |
| Pinned-Dependencies | 10 | Every action is pinned by commit SHA; `tests/workflows.test.ts` keeps it so. |
| SAST | 8 | CodeQL runs on every pull request; the commits merged before it existed are still in the window Scorecard reads. |
| Security-Policy | 10 | `SECURITY.md`. |
| Signed-Releases | -1 | No GitHub Release has assets, and Scorecard skips releases without assets. |
| Token-Permissions | 10 | Workflow tokens are read-only by default; each write is per job and commented. |
| Vulnerabilities | 10 | No known vulnerability; OSV-Scanner checks `bun.lock` in CI. |

## `ruleset-main.json`: the ruleset for `main`

The current `main` ruleset with six more required checks: `semver-check`,
`osv-scanner`, `package (node 20)`, `package (node lts/*)`, `analyze
(javascript-typescript)`, `analyze (actions)`, and a `code_scanning` rule that
blocks a merge on a CodeQL alert of high severity or above. `tests/ruleset.test.ts`
fails if a required check is not a check that pull requests run, so a renamed job
cannot leave a check that never reports and blocks every merge. The maintainer
applies it:

```bash
gh api -X PUT repos/matteogallo-ai/promptlang/rulesets/26384704 \
  --input docs/security/ruleset-main.json
```
