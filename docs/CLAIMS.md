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
| AI-powered linter | partial | `src/analyzer/ai/ai-linter.ts` | `src/analyzer/ai/ai-linter.test.ts` | analyzes a single prompt with 1 vague-instruction issue | Plumbing is tested with a mocked client only; no live-run artefact exists, so its findings are not a measured quality. |
| Multi-provider fallback | partial | `src/runtime/providers/routing-client.ts` | `src/runtime/providers/routing-client.test.ts` | calls fallback[0] when primary fails | Generated code sends one model name to every provider, so an Anthropic → OpenAI fallback sends a Claude model ID to OpenAI and fails. |
| Compile to TypeScript **and** Python | shipped | `src/compiler/compiler.ts`, `src/compiler/python/python-compiler.ts` | `src/compiler/python/python-compiler.test.ts` | generated Python parses with ast.parse (classify-ticket) | The TypeScript half is covered by the Typed I/O test. |
| Static analysis (SonarQube-style) | shipped | `src/analyzer/analyzer.ts` | `src/analyzer/analyzer.test.ts` | detects prompt-injection-risk on an undelimited user template | Six deterministic rules; see `docs/syntax-reference.md` Section 7. |
| Multi-provider runtime | shipped | `src/runtime/providers/` | `src/runtime/providers/response-validation.test.ts` | Anthropic, OpenAI and Ollama clients parse a well-formed response | Tested against mocked `fetch`; the request shapes are pinned per client in each client's own test file. |
| No third-party runtime dependencies | shipped | `package.json` | `tests/v1-stability.test.ts` | no third-party runtime dependencies (only first-party @promptlang/* allowed) | Runtime code uses Bun and `fetch` only. |
| Open source, zero SaaS | shipped | `package.json` | `tests/v1-stability.test.ts` | no third-party runtime dependencies (only first-party @promptlang/* allowed) | MIT licence; the test pins that no third-party service SDK is a runtime dependency. |
