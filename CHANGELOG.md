# Changelog

All notable changes to PromptLang will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
