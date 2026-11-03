# Changelog

All notable changes to PromptLang will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Property-based tests and fuzzing with fast-check (a devDependency) on the lexer,
  the parser, `src/semver` and `@promptlang/yaml-parser`; see `docs/CLAIMS.md`.
- Mutation testing with Stryker on `src/lexer`, `src/parser` and `src/semver`:
  `bun run mutation`, run locally, results in `docs/mutation/`.

### Fixed
- Lexer: a string ending in a backslash at end of input or line is reported as an
  unterminated string, not as the escape `'\undefined'` or an escaped newline.
- Parser: an `import` after a declaration reports that imports must come first, as one
  after metadata already did, instead of "Expected a declaration ... but found 'import'".
- `promptlang.yaml` (through `@promptlang/yaml-parser`): a `__proto__` key is kept as
  data instead of being dropped or replacing the object's prototype, and a backslash
  in a single-quoted string is literal.

### Changed
- `compile --emit-tsconfig` no longer writes `baseUrl`, which TypeScript 7 rejects
  (TS5102). A `--runtime-path` that is neither absolute nor starts with `./` or
  `../` (either separator) is written with a leading `./`, since `paths` entries
  without `baseUrl` must be relative. A tsconfig emitted by an earlier version
  keeps `baseUrl`: re-run `compile --emit-tsconfig` before moving to TypeScript 7
  (deleting the line alone leaves a non-relative `paths` entry, TS5090).
- The repository builds and type-checks with TypeScript 7 (`typescript` ^7.0.2).

## [2.0.0] - 2026-11-02

Remediation after the 2026-11-02 external audit, and the first release of
`@promptlang/core` on npm.

**Why 2.0.0 and not 1.3.0.** Code written against 1.2.0 breaks in at least these
ways, each of which SemVer reserves for a major version:
- the package name (`promptlang` → `@promptlang/core`) and its `exports` (TypeScript
  sources under `./src` → built `./dist` with `types`/`import` conditions), so every
  import of 1.2.0 stops resolving;
- generated code imports `@promptlang/core/runtime`, so 1.2.0 output must be
  recompiled;
- `@version` must be SemVer and `compile --target` must be `typescript` or
  `python`, so files and scripts that 1.2.0 accepted are rejected;
- `AnthropicClient` no longer sends `temperature`, so the same file samples
  differently.

### Claimed but not true (corrected)
- README marked **Native tests** and **SemVer for prompts** ✅; neither was
  implemented. Both are now implemented (see Added), with their scope in the README.
- README marked **Multi-provider fallback** ✅; generated code sends the same model
  name to every provider, so Anthropic → OpenAI fallback failed. Now true:
  `RoutingClient` maps the model per provider (see Added).
- README marked the **AI-powered linter** ✅ and "unique"; it was only tested with a
  mocked client and had never run against the API. Now `shipped` in
  `docs/CLAIMS.md` on one committed live run (`runs/live/`: 5/5 calls returned,
  $0.0038). It is one sample, not a measure of the findings' quality.
- The test badge said "626 passing": it counted `@promptlang/yaml-parser`'s 23
  tests twice (603 tests ran). Removed.
- `src/index.ts` exported only `VERSION = "0.1.0-alpha.0"` in v1.2.0.
- `docs/syntax-reference.md`, `docs/architecture.md`, `docs/migration-guide.md`,
  `docs/roadmap.md`, `docs/benchmarks.md`, `SECURITY.md` and `CONTRIBUTING.md`
  described syntax, commands, rules, config keys and pipeline stages that do not
  exist (e.g. `parallel` steps, cross-file chain calls, `promptlang test`,
  `defineRule`). All rewritten against the code.

### Changed
- **BREAKING:** package renamed `promptlang` → `@promptlang/core`; the CLI binary
  is still `promptlang`.
- `src/index.ts` exports `tokenize`, `parse`, `resolveGraph`, `resolveImport`,
  `compile`, `compilePython`, `analyze`, the error classes and AST types; `VERSION`
  is read from `package.json`.
- `.promptlang/integrity.json` keys are project-relative POSIX paths; legacy
  absolute keys are migrated on read.
- `.promptlang/manifest.json` (schema version 2) stores project-relative POSIX
  paths; version 1 manifests with absolute paths are migrated on read.
- `compile` rejects `.prompt` files with no declarations (exit 1).
- **BREAKING:** generated TypeScript imports `@promptlang/core/runtime` instead of
  `promptlang/runtime`, the package's real name; recompile existing output.
- **BREAKING:** `AnthropicClient` sends `anthropic-version: 2026-10-21` and never
  sends `temperature`, which that version rejects on every model. `@temperature`
  has no effect on Anthropic requests; OpenAI and Ollama still receive it. The key
  is still sent as `x-api-key`, which the API accepts on both versions.
- The examples are versioned 2.0.0 (their target model changed) and pass the
  project's own static analyzer: user input is delimited, with an untrusted-content
  instruction. Each example test has a `mock:` response.
- Examples, README, `init` template and the config default use `claude-opus-5-5`.
  They used `claude-opus-4.7`, which is not an Anthropic model ID (IDs use
  hyphens: `claude-opus-4-7`), and `classify-ticket.prompt` set `@temperature`,
  which Claude 4.7 and later reject.
- **BREAKING:** `compile --target` accepts only `typescript` or `python`. Any other
  value (e.g. `py`) used to produce TypeScript silently; it is now an error.
- `AnthropicClient` / `OpenAIClient` throw `TypeError` on an empty API key.
- The AI linter runs on `claude-haiku-5-5` (was `claude-haiku-4-5`, still active but
  ten times the price) with `max_tokens` 4096 and no `temperature`; `init` and the
  config default follow.
- The published package is built: ESM for Node ≥ 20 and Bun, with `.d.ts`
  declarations; `@promptlang/yaml-parser` is bundled in, so `@promptlang/core` has no
  runtime dependency. The CLI needs Bun ≥ 1.2.20.

### Security
- The AI linter wraps each analyzed section in `<untrusted_prompt>` delimiters,
  escapes delimiter tags found in the text, and tells the model to treat the
  delimited text as data. The prompt text used to be inserted bare.

### Added
- `@version` is validated as SemVer 2.0.0; an invalid value is a parse error
  positioned on the version string. **BREAKING** for files with non-SemVer values.
- `import "x.prompt" as X requires "<range>"`: `install` and `check` fail with
  `VersionMismatchError` when the imported `@version` does not satisfy the range
  (exact, `^`, `~`, `>`, `>=`, `<`, `<=`, space-separated AND).
- A syntax error in any file of the import graph is reported by `install` and
  `check` with the file path, instead of an uncaught exception.
- `promptlang semver-check [paths] [--base <ref>] [--json]`: compares each `.prompt`
  file's interface (parameters, output type, `@model`) with its version at a Git ref
  and exits 1 when `@version` was not bumped enough. CI runs it on `docs/examples`.
- `promptlang test <paths> [--json] [--live [--yes]]`: runs `test` blocks against the
  generated TypeScript, replaying `mock:` responses by default; `--live` calls
  Anthropic after printing an approximate cost estimate and getting approval.
- `RoutingClient` accepts `{ client, modelMap }` entries, so an Anthropic → OpenAI
  fallback sends OpenAI its own model name; a provider with no mapping for the
  requested model is skipped.
- HTTP clients read `Retry-After` on a 429 (seconds or HTTP-date) into
  `RateLimitError.retryAfter`, and retries wait that long instead of the backoff;
  above 60 s the error is thrown without waiting.
- Python runtime: empty keys are refused, HTTP errors and malformed responses raise
  typed `PromptClientError` subclasses (the names TypeScript uses), and the Anthropic
  client sends version 2026-10-21 without `temperature`.
- `analyze --ai` prints a cost estimate and asks before any call (`--yes` approves;
  required without a terminal). It makes no retries, so the estimate counts each
  call once.
- `promptlang test` exits 3 when a failed call (any `PromptClientError`) left a
  test without a verdict, so an outage is never reported as a failed assertion. The
  report labels each one a configuration error (authentication, rejected request,
  unknown model) or a provider failure (timeout, network, rate limit, server,
  malformed response).
- Test syntax: `mock: "..."`, `expect contains:`, `expect matches:`, `expect schema`.
- A test whose `input` calls a prompt or chain the file does not declare, or with
  arguments that do not match its parameters, is a compile error.
- `compile` and `test` warn that `eval` blocks are parsed but not executed, and that
  `@temperature` is not sent to Anthropic.
- `.github/workflows/release.yml`: a `v*` tag runs CI, then `npm publish --provenance`;
  see `docs/RELEASING.md`. CI packs the tarball, installs it into an empty project
  and uses it from Node 20 and the current LTS (`scripts/consumer-test.ts`).
- `bun run demo`: the SemVer scenario end to end in a temporary Git repository.
- Optional parameters: `name?: Type` in prompts and chains (`name?: T` in
  TypeScript, `NotRequired[T]` in Python; an omitted one interpolates as "").
- `InvalidResponseError` for provider 2xx bodies that are not JSON or lack the
  documented fields (not retried; `RoutingClient` still falls back).
- `docs/CLAIMS.md`, `scripts/check-claims.ts`, `scripts/check-stale-narrative.ts`,
  `benchmarks/bench.ts`; Biome and knip configuration; CI jobs for each.

### Fixed
- `resolveGraph` / `resolveImport` used `Bun.file` and failed under Node.
- The stale-narrative check missed "requires the v0.6 …" in a `.prompt` comment.
- Tests that spawn `tsc` had bun's 5 s default timeout and flaked on cold runners.
- Python type mapper fell through from primitive to enum on an unknown primitive.

### Removed
- Dead exports reported by knip, orphan `.gitkeep` files, empty `src/linter/` and
  `src/compiler/typescript/` directories, the placeholder `build` script.

### Tags
- `v0.5.0-alpha.0` was missing from `origin`; it is now pushed, on the commit it
  always pointed to (`f6765ae`). History is not rewritten.

## [1.2.0] — 2026-08-19

**npm publish release.**

`@promptlang/yaml-parser@1.0.0` is now officially published on the npm
registry. External consumers (starting with Praxis v1.1) can install it
directly:

```bash
bun add @promptlang/yaml-parser
# or: npm install @promptlang/yaml-parser
```

### Added

- `packages/yaml-parser/package.json` now carries every field required
  for a clean public publish: `publishConfig.access = "public"`,
  `repository.directory`, `keywords`, an explicit `files` allow-list
  (`src`, `README.md`, `CHANGELOG.md`, `LICENSE`), and `homepage` /
  `bugs` URLs pointing at this repo.
- npm version badge in the root `README.md`, next to the existing
  badges, so the published `@promptlang/yaml-parser` package is
  discoverable at a glance.

### Changed

- Root `package.json` version bumped to `1.2.0` to mark the milestone.
  No API of the main `promptlang` package changed in this release.

### Notes

- The package's public API is unchanged since v1.1.0 — same
  `parseYaml`, `YamlParseError`, and `YamlValue` exports as when the
  package was first extracted. This release is purely a distribution
  event: same code, now reachable through the npm registry rather than
  through the workspace `file:` protocol.
- Internal consumers of `@promptlang/yaml-parser` continue to resolve
  via the Bun workspace (`"workspace:*"`). External consumers should
  pin `^1.0.0`.
- `npm pack --dry-run` prints a 6-file tarball (~6.6 kB): `src/`,
  `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`. No tests,
  no config files, no secrets.

## [1.1.0] — 2026-08-14

**Structural refactor — the YAML parser is now a standalone package.**

No breaking API change for external PromptLang consumers: the CLI, the
compilers, and the runtime behave identically. Internal imports have
moved from `src/config/yaml-parser` to `@promptlang/yaml-parser`.

### Refactored

- The minimal YAML parser previously living at `src/config/yaml-parser.ts`
  has been extracted into its own npm package,
  [`@promptlang/yaml-parser`](./packages/yaml-parser/) v1.0.0. It is now
  a first-party workspace package under the new `packages/` folder.
- The primary error class was renamed `ConfigParseError` →
  `YamlParseError`. The old name is re-exported (both from the package
  and from `src/config/config.ts`) as a deprecated alias to keep
  existing callers working. Prefer `YamlParseError` in new code; the
  alias will be dropped in a future major release.

### Changed

- `package.json` root now declares Bun workspaces (`"workspaces":
  ["packages/*"]`) and consumes the extracted parser via
  `"@promptlang/yaml-parser": "workspace:*"`.
- Every internal PromptLang import that previously targeted
  `../../config/yaml-parser` now targets `@promptlang/yaml-parser`
  (5 files: `src/config/config.ts`, `src/cli/commands/install.ts`,
  `check.ts`, `compile.ts`, `list.ts`).
- `tests/v1-stability.test.ts` was relaxed to permit first-party
  `@promptlang/*` workspace packages as dependencies. Third-party
  runtime dependencies remain forbidden — the zero-external-dep
  promise holds unchanged in spirit.

### Fixed

- `tsconfig.json` — the pre-existing `types: ["bun-types"]` reference
  (a legacy package name that is no longer resolvable via `@types/bun`)
  was corrected to `types: ["bun"]`. This surfaced only when running
  `bunx tsc --noEmit` and is unrelated to the extraction, but is bundled
  in v1.1.0 because it blocked the acceptance criteria for this release.

### Migration guide

External API-level consumers of PromptLang need to do nothing. Internal
tooling (compiled prompts, custom CLI wrappers) that imported
`ConfigParseError` from `../../config/yaml-parser` should:

1. Update the import path to `@promptlang/yaml-parser`, and
2. Rename `ConfigParseError` → `YamlParseError` (or keep the alias for
   one more release cycle).

### Notes

- Sibling project [Praxis](https://github.com/matteogallo-ai/praxis)
  will replace its vendored copy of the parser with a proper `bun add
  @promptlang/yaml-parser` in its v0.2 release. That was the primary
  motivation for the extraction.

## [1.0.0] — 2026-08-14

**First stable release.** No new features from v0.9 — this release consolidates
11 alpha versions into a stable, documented, benchmark-verified API.

### Stability guarantees

Starting with v1.0.0, PromptLang commits to semantic versioning:

- MINOR versions (1.x) add features without breaking existing code.
- PATCH versions (1.0.x) fix bugs without changing behavior.
- MAJOR versions (2.0) may introduce breaking changes with a migration path.

### Documentation

- Consolidated README with new hero, comparison table (LangChain / LangSmith /
  W&B Weave / PromptLang), and quick example.
- New: [`docs/migration-guide.md`](docs/migration-guide.md) — 0.x → 1.0
  upgrade guide (spoiler: it is a no-op from v0.9).
- New: [`docs/benchmarks.md`](docs/benchmarks.md) — measured performance
  numbers on the reference machine (Apple M4, 16 GB, Bun 1.3.14).
- Updated: `docs/roadmap.md` with post-1.0 direction.
- Consolidated: `docs/architecture.md` marks every module as
  ✅ implemented and drops the "TBD" placeholders.

### What was built in 11 alpha releases

- **v0.1** — Foundation, structure, docs
- **v0.2** — Lexer (55 token types, hand-written tokenizer)
- **v0.3** — Recursive-descent parser with fully typed AST
- **v0.3.1** — CLI (`parse`, `tokens`, `analyze`, `compile`, `version`)
  + 6-rule static analyzer
- **v0.4** — TypeScript compiler (type-safe, executable output)
- **v0.5** — Chains (typed DAG composition of prompts)
- **v0.5.1** — Test honesty audit + `--emit-tsconfig` for out-of-project
  compilation
- **v0.6** — Multi-provider runtime (Anthropic, OpenAI, Ollama, RoutingClient)
- **v0.7** — AI-powered linter (Claude Haiku, opt-in `--ai`, 6 semantic rules)
- **v0.8** — Python compiler (idiomatic Python 3.10+ from the same source)
- **v0.9** — Project registry (`promptlang.yaml`, imports, SHA-256 integrity,
  `init` / `install` / `list` / `check`)

**603 tests total (596 feature + 7 stability regression). Zero external
dependencies. Zero regressions across 11 versions.**

## [0.9.0-alpha.0] — 2026-08-13

### Added
- `promptlang.yaml` project configuration file with `defaults`, `sources`,
  `compile`, `linter`, and `dependencies` sections.
- Minimal YAML parser (subset: mappings, sequences, scalars, comments).
  Zero external dependencies.
- Import system in `.prompt` files:
  `import "path/to/other.prompt" as Alias`.
- Local registry `.promptlang/` with `manifest.json` (resolved import graph)
  and `integrity.json` (SHA-256 hashes) for tamper detection.
- CLI commands: `init`, `install`, `list`, `check`.
- CLI `compile` now reads `promptlang.yaml` when `--out`, `--target`, and
  path arguments are omitted.
- `--config <path>` flag on `compile`, `install`, `list`, and `check` for
  alternative config files.
- New lexer tokens `IMPORT` and `AS`.
- New AST node `ImportDeclaration`.
- 68 new tests (596 total): `yaml-parser.test.ts` (23), `config.test.ts` (12),
  `resolver.test.ts` (9), `integrity.test.ts` (7), `parser.test.ts` additions
  (7), `cli.test.ts` additions (10).

### Notes
- Only a subset of YAML is supported (see `docs/yaml-support.md`).
- `dependencies` are declared but resolved only against local `path` values
  in v0.9. A remote package registry is planned for post-v1.0.
- Circular imports are detected and rejected at `install` / `check` time.
- `import` statements must appear at the top of the file, before any `@`
  metadata directives or declarations.

## [0.8.0-alpha.0] — 2026-08-12

### Added
- Python compiler backend: `promptlang compile --target python` generates
  idiomatic Python 3.10+ code with `Literal` types, `TypedDict` inputs,
  `async` functions, and runtime validation.
- `src/compiler/python/python-compiler.ts` — orchestrator (mirrors `compiler.ts`)
- `src/compiler/python/python-code-generator.ts` — generates prompt/type/chain declarations in Python
- `src/compiler/python/python-template-compiler.ts` — `{{var}}` → f-string with `input['var']`; literal braces doubled for f-string safety
- `src/compiler/python/python-type-mapper.ts` — PromptLang types → Python type hints (`str`, `float`, `bool`, `Literal[...]`, `TypedDict`)
- `src/compiler/python/python-runtime-template.ts` — autonomous `promptlang_runtime.py` source (PromptClient, MockClient, AnthropicClient, OpenAIClient)
- Generated `__init__.py` barrel export alongside `.py` files
- CLI flag `--target <typescript|python>` (default: `typescript`)
- `package.json` bumped to `0.8.0-alpha.0`
- 52 new tests (528 total); includes `py_compile` + `ast.parse` integration tests

### Notes
- Python integration tests are skipped if `python3` is not on PATH.
- Generated Python uses `from __future__ import annotations` and requires Python 3.10+.
- `httpx` is required only for real API calls (`pip install httpx`); `MockClient` has no external dependencies.
- `--emit-tsconfig` is silently ignored when `--target python` is used.

## [0.7.0-alpha.0] — 2026-08-12

### Added
- AI-powered linter: opt-in `--ai` flag on `promptlang analyze` invokes
  Claude Haiku to detect semantic issues (vague instructions, missing format
  specs, conflicting requirements, undefined terms, hallucination risks,
  token inefficiencies).
- `src/analyzer/ai/ai-linter.ts` — `AiLinter` class: concurrent analysis engine with configurable `PromptClient`, model, and concurrency limit (default 3).
- `src/analyzer/ai/issue-parser.ts` — Parses Claude's strict JSON response into typed `Issue[]`; handles markdown fences and malformed JSON gracefully.
- `src/analyzer/ai/prompts/analysis-prompt.ts` — Meta-prompt (`AI_LINTER_SYSTEM_PROMPT`) and `buildAnalysisUserMessage()` for structured prompt serialization.
- Report now separates static issues from AI-linter issues with a dedicated `🤖 AI-LINTER ISSUES` section in terminal output.
- JSON report now includes a top-level `ai_issues` field alongside the static `issues` field.
- 39 new tests (476 total): `ai-linter.test.ts` (14), `issue-parser.test.ts` (13), `analysis-prompt.test.ts` (9), `cli.test.ts` additions (3).

### Notes
- AI linter requires `ANTHROPIC_API_KEY` environment variable. Without it, `--ai` prints a clear error and falls back to static-only analysis.
- All tests use a mocked `PromptClient`. No real API calls are made in the test suite.
- Users are responsible for their own API costs when using `--ai`.
- Cross-provider AI linter support (OpenAI, Ollama) will land in v0.8+.

## [0.6.0-alpha.0] — 2026-08-11

### Added
- `src/runtime/providers/anthropic-client.ts` — `AnthropicClient`: HTTP client for the Anthropic Messages API with retry (exponential backoff), timeout (AbortController), and full error mapping.
- `src/runtime/providers/openai-client.ts` — `OpenAIClient`: HTTP client for the OpenAI Chat Completions API; normalizes `prompt_tokens`/`completion_tokens` to the shared `usage` interface.
- `src/runtime/providers/ollama-client.ts` — `OllamaClient`: HTTP client for local Ollama servers; maps `options.temperature` / `options.num_predict`; pedagogical `ConnectionError` on ECONNREFUSED, `NotFoundError` on 404 with `ollama pull` guidance.
- `src/runtime/providers/routing-client.ts` — `RoutingClient`: automatic fallback across providers; `AuthenticationError` is never retried via fallback; `AllProvidersFailedError` aggregates all errors.
- `src/runtime/errors.ts` — full error hierarchy: `PromptClientError`, `AuthenticationError`, `RateLimitError`, `ServerError`, `InvalidRequestError`, `TimeoutError`, `NetworkError`, `ConnectionError`, `NotFoundError`, `AllProvidersFailedError`.
- `src/runtime/providers/anthropic-client.test.ts` — 18 tests (headers, body, response parsing, retries, errors).
- `src/runtime/providers/openai-client.test.ts` — 15 tests.
- `src/runtime/providers/ollama-client.test.ts` — 17 tests.
- `src/runtime/providers/routing-client.test.ts` — 11 tests (fallback ordering, AuthenticationError short-circuit, `onFallback` callback, `AllProvidersFailedError`).
- `src/runtime/index.ts` — updated to re-export all provider classes, option types, and error classes.

### Notes
- No live API calls are made in tests. All provider tests spy on `globalThis.fetch`.
- API keys must be supplied by the user via environment variables. No key is hard-coded.
- Streaming responses are deferred to v0.8+.

## [0.5.1-alpha.0] — 2026-08-11

### Fixed
- `src/cli/commands/compile.ts` — args filter discarded index 0 when `--runtime-path` was absent (`runtimePathIdx === -1` → `runtimePathIdx + 1 === 0`); added `runtimePathIdx !== -1 &&` guard
- `src/compiler/compiler.test.ts` — replaced tsc integration tests that relied on `extends: "../tsconfig.json"` (inheriting the project's own paths mapping, making them pass trivially) with explicit `paths` mapping; added isolation test that documents the known TS2307 limitation when used outside the repo
- `src/compiler/chain-compiler.test.ts` — same tsc integration test fix as above

### Added
- `promptlang compile --emit-tsconfig` — opt-in flag that writes a `tsconfig.json` to `--out` with the correct `paths` mapping for `promptlang/runtime`; intended for local/alpha development before the package is published to npm
- `promptlang compile --runtime-path <path>` — overrides the default relative path to `src/runtime/index.ts` in the emitted tsconfig

### Known Limitations (alpha)
- `import { … } from "promptlang/runtime"` resolves only within this repository (via `package.json` `exports`). Use `--emit-tsconfig` in external projects until v1.0 is published to npm.

## [0.5.0-alpha.0] — 2026-08-11

### Added
- `src/compiler/chain-compiler.ts` — dedicated chain compilation module with:
  - `CallableRegistry` type: maps every prompt and chain name to its ordered parameter list
  - `buildCallableRegistry(program)` — builds the registry from an AST Program
  - `generateChain(decl, callableRegistry)` — compiles a `ChainDeclaration` to a TypeScript async function
  - Positional arg resolution: `summarize(article)` → `{ text: input.article }` by matching against the callee's parameter order via `CallableRegistry`
  - Named arg compilation: `translate(text: summary, target_lang: target)` → `{ text: summary, target_lang: input.target }`
  - Compile-time validation: undefined identifier references throw `CompilerError` with chain name + variable name in the message
  - Forward reference detection: step `a` referencing step `b` (defined later) throws `CompilerError` with "defined later" message
  - Member expression support in step expressions: `data.field` compiles correctly
- `src/compiler/chain-compiler.test.ts` — 39 tests (unit + integration + end-to-end):
  - Unit tests for 1-step, 2-step, 3-step chains; named args; positional args; param/step reuse; return type variations; interface generation
  - Error tests: undefined identifier, forward reference, unknown callee
  - Section header tests: `---- Chain ----` appears after `---- Prompt definitions ----`
  - Integration: compiles `docs/examples/summarize-and-translate.prompt` without error
  - Integration: generated TypeScript for the example compiles cleanly with `tsc --strict --noEmit`
  - End-to-end: spawns a child Bun process that imports the compiled chain and runs it with `MockClient`, verifying the correct orchestration of 2 LLM calls

### Changed
- `src/compiler/code-generator.ts` — removed the stub `generateChainDeclaration` function and its orphaned `compileExpression` / `compileCallArgs` helpers; chain compilation now lives entirely in `chain-compiler.ts`
- `src/compiler/compiler.ts` — wires in `buildCallableRegistry` and `generateChain` from `chain-compiler.ts`; chains now appear under a dedicated `// ---- Chain ----` section header instead of being mixed into `// ---- Prompt definitions ----`
- `docs/examples/summarize-and-translate.prompt` — removed test blocks using comparison operators (`> n`, `<= n`) and regex matchers that require the v0.6 test-eval engine (not yet implemented); replaced with minimal literal-assertion tests that the current parser accepts
- `package.json` — version bumped to `0.5.0-alpha.0`

## [0.4.0-alpha.0] — 2026-08-11

Entry reconstructed on 2026-11-02 from the tagged commit `d4c6f3e`; it was missing
from this file.

### Added
- `src/runtime/`: `PromptClient` interface, `PromptRequest` / `PromptResponse`
  types, `MockClient`.
- `src/compiler/`: `CompilerError`, type mapper, template compiler
  (`{{var}}` → `${input.var}`), code generator for types, prompts and chains,
  compiler orchestrator.
- `promptlang compile <file|dir|glob> [--out <dir>]`, generating an `index.ts` barrel.
- 83 tests (runtime, compiler, CLI compile, `tsc` integration); 309 in total.

### Changed
- `tsconfig.json` `paths` so `promptlang/runtime` resolves inside the repository;
  `package.json` `exports` for `./runtime`; version `0.4.0-alpha.0`.

## [0.3.1-alpha.0] — 2026-08-11

### Added
- `src/cli/cli.ts` — main CLI entry point with dispatcher; exports `main()` for testability; supports `parse`, `tokens`, `analyze`, `version`, `help` commands
- `src/cli/commands/parse.ts` — `promptlang parse <file>`: tokenizes + parses a `.prompt` file and prints a human-readable AST tree
- `src/cli/commands/tokens.ts` — `promptlang tokens <file>`: tokenizes a `.prompt` file and prints every token with line:col info
- `src/cli/commands/version.ts` — `promptlang version`: prints current version, repo URL, and license
- `src/cli/commands/analyze.ts` — `promptlang analyze <path>`: runs the full static analysis pipeline on one file, a directory, or a glob pattern; supports `--json` (machine-readable output) and `--strict` (exit 1 on warnings); gracefully skips files using future syntax (emits `[skip]` to stderr)
- `src/cli/output.ts` — ANSI color constants and `formatError()` for displaying lexer/parser errors with source context
- `src/analyzer/analyzer.ts` — `analyze()` engine and `Rule` / `Issue` / `AnalysisContext` interfaces
- `src/analyzer/report.ts` — `formatTerminalReport()` (colored, human-readable) and `formatJsonReport()` (CI-ready JSON)
- `src/analyzer/rules/missing-tests.ts` — Rule: flags prompts that have no `test` block referencing them
- `src/analyzer/rules/unbounded-template.ts` — Rule: flags `{{variable}}` references not declared as prompt parameters
- `src/analyzer/rules/prompt-injection-risk.ts` — Rule: flags user-role sections with undelimited template variables (injection vector)
- `src/analyzer/rules/token-cost-estimate.ts` — Rule: estimates token count (words × 1.3) and warns on prompts exceeding 500 tokens
- `src/analyzer/rules/chain-complexity.ts` — Rule: warns on chains exceeding 5 steps (high cyclomatic complexity)
- `src/analyzer/rules/duplicate-prompts.ts` — Rule: detects the same prompt name declared in multiple files
- `src/cli/cli.test.ts` — 27 tests covering all commands, flags, error paths, and exit codes
- `src/analyzer/analyzer.test.ts` — 24 tests: unit tests for each rule + integration tests against real example files

### Changed
- `package.json` — version bumped to `0.3.1-alpha.0`; added `bin.promptlang`, `scripts.cli`, `scripts.typecheck`
- `tsconfig.json` — added `resolveJsonModule: true` to support `import packageJson from "../../../package.json"`
- `README.md` — added "Why does this matter?" and "Try it now" sections with CLI usage examples; updated Comparison table with Static analysis and Injection risk detection rows

## [0.3.0-alpha.0] — 2026-08-11

### Added
- `src/ast/nodes.ts` — complete typed AST node interfaces (Program, all Metadata, TypeDeclaration, PromptDeclaration, ChainDeclaration, TestDeclaration, EvalDeclaration, all TypeExpression variants, all Expression variants, NamedArgument, Literal variants); every node carries `line` and `column` for downstream error reporting
- `src/ast/printer.ts` — `printAst()` tree-rendering utility for debugging and the future `promptlang parse` CLI
- `src/parser/grammar.md` — authoritative EBNF grammar reference for PromptLang v0.3
- `src/parser/errors.ts` — `ParserError` with `line`, `column`, `expected`, `found` fields and pedagogical messages
- `src/parser/parser.ts` — hand-written recursive descent parser (`Parser` class + `parse()` helper); implements the full v0.3 grammar:
  - All 7 metadata directives including `@description`
  - `type` declarations: primitive, enum, struct, TypeReference
  - Optional struct fields (`field?: type`)
  - `prompt` declarations with sections: `system`, `user`, `assistant`, `output`
  - `chain` declarations with `step` assignments and `return` expression
  - All expression forms: CallExpression, MemberExpression, Identifier, StringLiteral, NumberLiteral, BooleanLiteral
  - Named arguments in call expressions (`key: value` syntax)
  - `test` declarations with `expect` and `expect.<field>` clauses
  - `eval` declarations
  - Keywords usable in identifier positions (field names, parameter names, member properties)
  - Model names with dotted version suffixes (`claude-opus-4.7` → `ModelMetadata.value = "claude-opus-4.7"`)
- `src/parser/parser.test.ts` — 89 unit and integration tests (100% passing)

### Changed
- `src/lexer/token.ts` — added `AT_DESCRIPTION = "AT_DESCRIPTION"` to `TokenType`
- `src/lexer/lexer.ts` — added `description` to `AT_DIRECTIVES` to support `@description` metadata

## [0.2.0-alpha.0] — 2026-08-11

### Added
- `src/lexer/token.ts` — `TokenType` enum (55 token types) and `Token`/`Position` interfaces
- `src/lexer/errors.ts` — `LexerError` with line + column position
- `src/lexer/lexer.ts` — hand-written recursive state-machine lexer (`Lexer` class + `tokenize()` helper)
  - All metadata directives (`@version`, `@model`, `@temperature`, `@max_tokens`, `@breaking_changes`, `@migration_from`)
  - All declaration keywords, type keywords, and section keywords
  - Single-line strings with escape sequences (`\"`, `\\`, `\n`, `\t`, `\r`)
  - Triple-quoted strings (multi-line, no escape processing)
  - Template string detection (`{{...}}` → `TEMPLATE_STRING` token type)
  - Numeric literals (integers and decimals)
  - Identifiers with hyphen support for model names (e.g. `claude-opus-4.7`)
  - All punctuation and operators including `->` (ARROW)
  - Line comments (`//`) and block comments (`/* */`) emitted as tokens
  - Precise 1-indexed line + column tracking on every token
  - `LexerError` with position on: unterminated strings, unknown directives, illegal characters, `123abc` pattern
- `src/lexer/lexer.test.ts` — 91 unit and integration tests (100% passing)

## [0.1.0-alpha.0] — 2026-08-11

### Added
- Initial project structure
- Architecture documentation (`docs/architecture.md`)
- Syntax reference (`docs/syntax-reference.md`)
- Public roadmap (`docs/roadmap.md`)
- Example `.prompt` files: `classify-ticket`, `extract-invoice`, `summarize-and-translate`
- GitHub Actions CI workflow
- Contributing guide, Code of Conduct, Security policy
