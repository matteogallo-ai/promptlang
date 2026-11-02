# Claims register

Every capability that the README advertises is listed here with the module that
implements it, the test that proves it, and its status. `scripts/check-claims.ts`
(CI job `claims`) enforces this file:

- every `shipped` row's test is run by name and must pass (a skipped test does not count);
- every ✅ in the README comparison table must name a `shipped` claim below;
- a `roadmap` or `partial` claim must not be shown as ✅ in the README.

Statuses: `shipped` (implemented and tested), `partial` (implemented with a stated
limitation; never shown as ✅), `roadmap` (not implemented).

The "Test name" column is matched literally against the test's full name.

| Claim | Status | Module | Test file | Test name | Notes |
| ----- | ------ | ------ | --------- | --------- | ----- |
| Typed I/O | shipped | `src/compiler/code-generator.ts` | `src/compiler/compiler.test.ts` | generated code compiles within a project with promptlang paths mapping (classify-ticket) | Generated TypeScript type-checks under `strict`. |
| Native tests | roadmap | `src/parser/parser.ts` (parsing only) | — | — | `test` blocks are parsed, then discarded by the compilers; nothing executes them. |
| SemVer for prompts | roadmap | — | — | — | `@version` is copied into the output as a string; it is not validated and imports carry no version constraint. |
| AI-powered linter | partial | `src/analyzer/ai/ai-linter.ts` | `src/analyzer/ai/ai-linter.test.ts` | analyzes a single prompt with 1 vague-instruction issue | Plumbing is tested with a mocked client only; no live-run artefact exists, so its findings are not a measured quality. |
| Multi-provider fallback | partial | `src/runtime/providers/routing-client.ts` | `src/runtime/providers/routing-client.test.ts` | calls fallback[0] when primary fails | Generated code sends one model name to every provider, so an Anthropic → OpenAI fallback sends a Claude model ID to OpenAI and fails. |
| Compile to TypeScript **and** Python | shipped | `src/compiler/compiler.ts`, `src/compiler/python/python-compiler.ts` | `src/compiler/python/python-compiler.test.ts` | generated Python parses with ast.parse (classify-ticket) | The TypeScript half is covered by the Typed I/O test. |
| Static analysis (SonarQube-style) | shipped | `src/analyzer/analyzer.ts` | `src/analyzer/analyzer.test.ts` | detects prompt-injection-risk in classify-ticket (no delimiters) | Six deterministic rules; see `docs/syntax-reference.md` Section 7. |
| Open source, zero SaaS | shipped | `package.json` | `tests/v1-stability.test.ts` | no third-party runtime dependencies (only first-party @promptlang/* allowed) | MIT licence; the test pins that no third-party service SDK is a runtime dependency. |
