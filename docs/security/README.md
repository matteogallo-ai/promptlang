# Supply-chain security records

## `scorecard-before.json`

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

## Fuzzing check

`scorecard-before.json` scores Fuzzing 0 ("project is not fuzzed"). In Scorecard v5.6.0,
`checks/raw/fuzzing.go` counts a TypeScript repository as fuzzed when a `*.ts` or `*.tsx`
file matches

```
(from\s+['"](fast-check|@fast-check/(ava|jest|vitest))['"]|require\(\s*['"](fast-check|@fast-check/(ava|jest|vitest))['"]\s*\))
```

and TypeScript is a prominent language of the repository (at least a quarter of the
average lines per language; GitHub reports TypeScript as the only one). The property
tests import `fc from "fast-check"`: `src/lexer/lexer.property.test.ts`,
`src/parser/parser.property.test.ts`, `src/semver/semver.property.test.ts`,
`packages/yaml-parser/tests/parser.property.test.ts` and `tests/support/property.ts`.
The same image run as `--local=<checkout> --checks=Fuzzing` on a checkout with these
files scores Fuzzing 10 and lists them as `TypeScriptPropertyBasedTesting` integrations
(local mode also walks untracked directories such as `node_modules`).
