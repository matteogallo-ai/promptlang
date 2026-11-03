# Claims register

Every capability that the README advertises is listed here with the module that
implements it, the test that proves it, and its status. `scripts/check-claims.ts`
(CI job `claims`) enforces this file:

- every `shipped` row's test is run by name and must pass (a skipped test does not count);
- every row of the README comparison table must be a claim below, and its
  PromptLang cell must start with `✅` (shipped), `Partial` or `Roadmap`, matching the status;
- every bold bullet of the README "Why PromptLang" delivered list must be a `shipped` claim.

Statuses: `shipped` (implemented and tested), `partial` (implemented with a stated
limitation; never shown as ✅), `roadmap` (not implemented).

The "Test name" column is passed, regex-escaped, to `bun test --test-name-pattern`,
which matches it as a substring of the test's full name (describe blocks included).
At least one matching test must pass.

| Claim | Status | Module | Test file | Test name | Notes |
| ----- | ------ | ------ | --------- | --------- | ----- |
| Typed I/O | shipped | `src/compiler/code-generator.ts` | `src/compiler/compiler.test.ts` | generated code compiles within a project with promptlang paths mapping (classify-ticket) | Generated TypeScript type-checks under `strict`. |
| Native tests | shipped | `src/testing/runner.ts`, `src/cli/commands/test.ts` | `src/cli/commands/test.test.ts` | a failing test exits 1 and shows the failed assertion | `promptlang test` runs `test` blocks against the generated TypeScript: `mock:` responses by default (no network), `--live` against Anthropic after a cost estimate and approval; a failed call is reported as no verdict (exit 3), labelled configuration error or provider failure, not as a failed assertion. Assertions: equality, `contains`, `matches`, `schema`. A test calling an unknown prompt is a compile error. `eval` blocks are not executed. |
| SemVer for prompts | shipped | `src/semver/`, `src/registry/resolver.ts`, `src/cli/commands/semver-check.ts` | `tests/demo.test.ts` | bun run demo plays the whole SemVer scenario | `@version` must be SemVer 2.0.0; `import ... requires "<range>"` raises `VersionMismatchError`; `semver-check` compares interfaces with a Git base and runs in CI on `docs/examples`. Per-rule tests: `src/semver/*.test.ts`, `src/cli/commands/semver-check.test.ts`. |
| AI-powered linter | shipped | `src/analyzer/ai/ai-linter.ts` | `src/analyzer/ai/ai-linter.test.ts` | analyzes a single prompt with 1 vague-instruction issue | The test uses a mocked client. One live run is committed (`runs/live/ai-linter-2026-11-02T16-19-27-163Z.json`): 5/5 calls to `claude-haiku-5-5` returned, 17 findings, $0.0038. One sample: the quality of the findings is not measured. |
| Multi-provider fallback | shipped | `src/runtime/providers/routing-client.ts` | `src/runtime/providers/routing-integration.test.ts` | Anthropic 500 falls back to OpenAI 200, which receives its own model name | Per-provider `modelMap` translates the generated `@model`; a provider with no mapping is skipped; `AuthenticationError` never falls back. Tested through the real clients with `fetch` mocked. |
| Compile to TypeScript **and** Python | shipped | `src/compiler/compiler.ts`, `src/compiler/python/python-compiler.ts` | `src/compiler/python/python-compiler.test.ts` | generated Python parses with ast.parse (classify-ticket) | The TypeScript half is covered by the Typed I/O test. |
| Static analysis (SonarQube-style) | shipped | `src/analyzer/analyzer.ts` | `src/analyzer/analyzer.test.ts` | detects prompt-injection-risk on an undelimited user template | Six deterministic rules; see `docs/syntax-reference.md` Section 7. |
| Multi-provider runtime | shipped | `src/runtime/providers/` | `src/runtime/providers/response-validation.test.ts` | Anthropic, OpenAI and Ollama clients parse a well-formed response | Tested against mocked `fetch`; the request shapes are pinned per client in each client's own test file. |
| Cost estimate and approval before paid calls | shipped | `src/cli/commands/analyze.ts`, `src/cli/commands/test.ts`, `src/cli/live.ts` | `src/cli/commands/analyze.test.ts` | prints the estimate, asks, and calls nothing when the answer is no | `analyze --ai` and `test --live` print the estimate and ask; `--yes` approves; without a terminal and without `--yes` they refuse. `test --live`: `src/cli/commands/test.test.ts` "prints the cost estimate before any call and stops when not approved". |
| Retry-After on 429 | shipped | `src/runtime/providers/retry.ts`, `src/runtime/providers/response.ts` | `src/runtime/providers/retry.test.ts` | waits the provider's Retry-After instead of the exponential backoff | Above 60 s the error is thrown without waiting. |
| Python runtime guards | shipped | `src/compiler/python/python-runtime-template.ts` | `src/compiler/python/python-runtime.test.ts` | a malformed 2xx body raises InvalidResponseError naming the field | Empty keys refused, typed HTTP errors, malformed responses raise `InvalidResponseError`. Needs `python3` on the test machine. No retries; `httpx` timeout and connection exceptions are not wrapped. |
| Workflow supply-chain rules | shipped | `scripts/check-workflows.ts` | `tests/workflows.test.ts` | every workflow pins actions by SHA, reads by default and justifies each write | Reads the parsed YAML of every `.yml`/`.yaml` workflow (block or flow style): every action is pinned to a full commit SHA with a version comment, or is a local workflow or a Docker image pinned by digest; the workflow token is `contents: read` (or `{}`); no job has `write-all`, and each job-level `write` is in a block-style `permissions:` with its own comment above it; no `pull_request_target`; no `github.event.*` or `github.head_ref` expression inside a `run:` script (values go through `env:`); a `run:` script calling `gh release create` or `gh release upload` names a `.sigstore.json` file, and its job, or a job it lists directly in `needs`, has an `actions/attest-build-provenance` step (the step's `if:` is not evaluated; releases made by other actions or through `gh api` are not recognised). The comment is checked for presence, not for what it says. CodeQL, OSV-Scanner and Scorecard are CI jobs, not tests, so they are not claims here. |
| No third-party runtime dependencies | shipped | `package.json` | `tests/stability.test.ts` | no third-party runtime dependencies (only first-party @promptlang/* allowed) | Runtime code uses Bun and `fetch` only. |
| Open source, zero SaaS | shipped | `package.json` | `tests/stability.test.ts` | no third-party runtime dependencies (only first-party @promptlang/* allowed) | MIT licence; the test pins that no third-party service SDK is a runtime dependency. |
