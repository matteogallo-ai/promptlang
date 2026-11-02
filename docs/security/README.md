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
