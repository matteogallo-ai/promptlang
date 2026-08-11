# Changelog

All notable changes to PromptLang will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
