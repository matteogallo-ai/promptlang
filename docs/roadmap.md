# Roadmap

PromptLang follows a milestone-based roadmap with two-week sprints. Each version
ships a working, testable slice of functionality — nothing is hidden behind feature
flags until it's ready.

---

## v0.1 — Foundation ✅

_Goal: repo is credible, documented, and ready to receive contributors._

- [x] Project structure and GitHub configuration
- [x] Architecture documentation
- [x] Full syntax reference
- [x] Annotated example `.prompt` files
- [x] CI pipeline (GitHub Actions + Bun)
- [ ] npm package placeholder registration

---

## v0.2 — Lexer ✅

_Goal: a `.prompt` file can be tokenized into a typed token stream._

- [x] Tokenizer (lexer) with full token set — 55 token types
- [x] `LexerError` with precise line + column on all error conditions
- [x] Single-line and triple-quoted strings with escape handling
- [x] Template string detection (`{{...}}` → `TEMPLATE_STRING`)
- [x] Hyphenated identifier support for model names (`claude-opus-4.7`)
- [x] Comments emitted as tokens (not discarded) for future formatter use
- [x] 91 unit tests — 100% passing

---

## v0.3 — Parser + AST ✅ (current)

_Goal: a token stream can be parsed into a fully typed Abstract Syntax Tree._

- [x] Hand-written recursive descent parser — no external parsing library
- [x] Complete typed AST interfaces with `line`/`column` on every node
- [x] All declaration types: `type`, `prompt`, `chain`, `test`, `eval`
- [x] All type expressions: primitive, enum, struct (with optional fields), TypeReference
- [x] All expression forms: call, member access, identifier, string/number/bool literals
- [x] Named arguments in call expressions (`key: value` syntax)
- [x] `expect` and `expect.<field>` assertion clauses in test blocks
- [x] All 7 metadata directives including `@description`
- [x] `ParserError` with line, column, expected, and found token types
- [x] AST printer (`printAst()`) for debugging and future CLI
- [x] `@description` lexer support added (`AT_DESCRIPTION` token type)
- [x] 89 unit and integration tests — 100% passing
- [x] 3 full integration tests covering all 3 example `.prompt` files

---

## v0.4 — TypeScript Compiler (basic)

_Goal: a simple prompt with string I/O compiles to a working TypeScript function._

- [ ] Code generator: `prompt` declaration → async TypeScript function
- [ ] Runtime stub (`src/runtime/`) for calling LLM APIs
- [ ] `promptlang compile <file> --target typescript` CLI command
- [ ] Support for Anthropic and OpenAI providers in the runtime
- [ ] End-to-end test: compile + execute against a live model

---

## v0.4 — Type System

_Goal: primitive types, enums, and structs are validated at compile time._

- [ ] Primitive types: `string`, `number`, `boolean`
- [ ] `enum` declarations with string member names
- [ ] `struct` declarations with typed fields
- [ ] Semantic analysis pass: type-check prompt I/O against declarations
- [ ] Compiler error messages with file + line info

---

## v0.5 — Chains (Prompt DAG) ✅

_Goal: prompts can be composed into a directed acyclic graph._

- [x] `chain` declaration compiles to a typed async TypeScript function
- [x] Positional and named argument resolution with `CallableRegistry`
- [x] Compile-time validation: undefined identifiers and forward references throw `CompilerError`
- [x] Member expression support in step arguments (`step.field`)
- [x] Dedicated `// ---- Chain ----` section in generated output
- [x] 39 tests: unit, error, integration, end-to-end runtime with `MockClient`
- [x] `--emit-tsconfig` flag on `compile` command: emits a `tsconfig.json` with correct `paths` mapping for `promptlang/runtime` (patch v0.5.1)
- [ ] DAG cycle detection (chains calling themselves recursively)
- [ ] Typed data flow: output type of step N must match input type of step N+1
- [ ] `promptlang viz <file>` CLI command: renders chain as ASCII DAG

---

## v0.6 — Multi-provider runtime ✅

_Goal: PromptLang is usable in production with real API keys._

- [x] `AnthropicClient` — HTTP client for Anthropic Messages API; retry + backoff + timeout
- [x] `OpenAIClient` — HTTP client for OpenAI Chat Completions API
- [x] `OllamaClient` — HTTP client for local Ollama servers (no auth required)
- [x] `RoutingClient` — automatic fallback across providers; `AuthenticationError` never retried
- [x] Full error hierarchy: `AuthenticationError`, `RateLimitError`, `ServerError`, `InvalidRequestError`, `TimeoutError`, `NetworkError`, `ConnectionError`, `NotFoundError`, `AllProvidersFailedError`
- [x] 61 tests — all using mocked `fetch`, no live API calls
- [ ] Streaming responses (deferred to v0.8+)

---

## v0.7 — Native Tests and Evals

_Goal: `test` blocks execute as real unit tests via `bun test`._

- [ ] `test` block parsing and semantic analysis
- [ ] Test runner that compiles the prompt and evaluates assertions
- [ ] `expect`, `expect.<field>`, and `expect.matches` assertion forms
- [ ] `eval` block for running a prompt against a dataset (CSV/JSON)
- [ ] Test failure output with diff between expected and actual

---

## v0.7 — AI-Powered Linter ✅

_Goal: optional static analysis powered by a fast model to catch prompt issues._

- [x] `AiLinter` class with injectable `PromptClient`, configurable model, and concurrent analysis
- [x] Meta-prompt engineered to detect 6 semantic issue categories via structured JSON output
- [x] `--ai` flag on `promptlang analyze`: runs AI linter in addition to static rules
- [x] Confidence-scored issues (high/medium/low) mapped to warning/info severity
- [x] Separate `🤖 AI-LINTER ISSUES` section in terminal report; `ai_issues` field in JSON output
- [x] Graceful fallback to static-only analysis when `ANTHROPIC_API_KEY` is absent
- [x] 39 new tests — all using mocked `PromptClient`, no live API calls
- [ ] Rule suppression via `// @promptlang-disable <rule>` comments (v0.8+)
- [ ] Cross-provider AI linter support (OpenAI, Ollama) — v0.8+

---

## v0.8 — Python Compiler ✅

_Goal: compiled output targets Python as a first-class language._

- [x] Python code generator: `prompt` → `async def` with type hints (`Literal`, `TypedDict`, `NotRequired`)
- [x] Python runtime (`promptlang_runtime.py`): `PromptClient`, `MockClient`, `AnthropicClient`, `OpenAIClient` (requires `httpx`)
- [x] `promptlang compile <file> --target python` CLI command
- [x] Parity with TypeScript compiler for primitives, enums, structs, chains
- [x] `__init__.py` barrel export generated alongside `.py` files
- [x] 52 new tests; py_compile + ast.parse integration
- [ ] Example integration with FastAPI and LangChain-style usage (v0.9+)

---

## v0.9 — Multi-Provider Configuration

_Goal: full provider configuration with model aliases and fallback chains._

- [ ] `promptlang.config.yaml` schema (providers, model aliases, retry policy)
- [ ] `@model` directive supports provider-scoped aliases: `anthropic/fast`, `openai/reasoning`
- [ ] Fallback chain: try primary model, fall back to secondary on error
- [ ] Environment variable injection for API keys
- [ ] Provider mock for offline testing

---

## v1.0 — Stable Public Release

_Goal: PromptLang is production-ready and publicly announced._

- [ ] API stability guarantee (no breaking changes without major version bump)
- [ ] Complete documentation site
- [ ] Published on npm
- [ ] VS Code extension: syntax highlighting and hover types for `.prompt` files
- [ ] Migration guide from raw string prompts
- [ ] Public announcement

---

## Beyond v1.0 (unscheduled)

Ideas tracked but not yet scheduled:

- Language server protocol (LSP) implementation for IDE support
- Remote eval: run evals against a hosted dataset
- Diff-aware CI: only re-run tests for prompts whose content changed
- Prompt marketplace: share and discover community prompts
- Fine-tune adapter: export prompt + eval data as a fine-tuning dataset
