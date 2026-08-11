# Changelog

All notable changes to PromptLang will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
