# Roadmap

This page lists what PromptLang does today and what it does not. A capability is
"delivered" only when it has a passing test listed in [`CLAIMS.md`](CLAIMS.md).
Release history is in [`CHANGELOG.md`](../CHANGELOG.md).

---

## Delivered

### Language and compiler

- [x] Lexer with line/column errors; single-line and triple-quoted strings; `{{var}}` templates
- [x] Recursive-descent parser and typed AST for `type`, `prompt`, `chain`, `test`, `eval`, `import`
- [x] Primitive, enum, struct (optional fields) and named types
- [x] TypeScript code generator: one async function per prompt, typed input and output
- [x] Python code generator (3.10+, `Literal` / `TypedDict`) with a bundled runtime module
- [x] `chain` compilation: sequential steps calling prompts declared in the same file,
      named and positional arguments, member access on step results, undefined
      identifiers and forward references rejected at compile time
- [x] `.prompt` files with no declarations rejected by `compile`

### Project tooling

- [x] `promptlang.yaml` project config, parsed by `@promptlang/yaml-parser`
- [x] `import "path" as Alias` resolution, circular import detection
- [x] `install` / `check`: `.promptlang/manifest.json` and a portable `integrity.json`
      (project-relative SHA-256 hashes)
- [x] CLI: `parse`, `tokens`, `analyze`, `compile` (`--target`, `--emit-tsconfig`), `init`,
      `install`, `list`, `check`, `version`
- [x] Six static analysis rules: missing tests, unbounded templates, prompt-injection
      risk, token cost estimate, chain complexity, duplicate prompts

### Runtime

- [x] `PromptClient` interface and deterministic `MockClient`
- [x] `AnthropicClient`, `OpenAIClient`, `OllamaClient`: timeout, bounded retries with
      exponential backoff on retryable errors only, typed error hierarchy,
      `InvalidResponseError` for malformed provider responses, empty API keys rejected
- [x] `@promptlang/core` entry point exporting `tokenize`, `parse`, `resolveGraph`,
      `resolveImport`, `compile`, `compilePython`, `analyze`, the error classes and AST types

---

## Partial

- **Multi-provider fallback** — `RoutingClient` tries providers in order and never falls
  back on `AuthenticationError`. Generated code sends the same `@model` value to every
  provider, so a fallback between providers with different model names fails.
- **AI-powered linter** (`analyze --ai`) — request building and response parsing are
  tested with a mocked client only. No live run is committed, so the quality of its
  findings is unmeasured. The analyzed prompt text is not delimited as untrusted
  content in the linter's request.

---

## In progress

- [ ] **SemVer for prompts** — `@version` validated as SemVer; version constraints on
      imports with a `VersionMismatchError`; `promptlang semver-check` comparing each
      prompt's interface (parameters, output schema, target model) against a git base
- [ ] **Native tests** — `promptlang test` executing `test` blocks with `MockClient` by
      default; a test referencing an unknown prompt becomes a compile error
- [ ] **Cross-provider fallback** — per-provider model mapping in `RoutingClient`;
      `retry-after` honoured on rate limits
- [ ] **npm publication** of `@promptlang/core` (ESM build, type declarations, Node
      consumer test)

---

## Not implemented, not scheduled

- `eval` blocks: parsed, not executed
- `parallel { ... }` steps in chains (not in the grammar)
- Calling an imported prompt from a chain (`Alias.prompt(...)`)
- Type checking of data flow between chain steps (the TypeScript target relies on `tsc`)
- DAG cycle detection for chains; `promptlang viz`
- Streaming responses
- Rule suppression comments; custom analyzer rules
- Cross-provider AI linter (OpenAI, Ollama)
- Remote package registry; multi-provider config with model aliases
- More provider clients (Google Gemini, Mistral, Cohere)
- IDE support (VS Code syntax highlighting, LSP)
- MCP server integration
