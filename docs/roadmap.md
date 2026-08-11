# Roadmap

PromptLang follows a milestone-based roadmap with two-week sprints. Each version
ships a working, testable slice of functionality — nothing is hidden behind feature
flags until it's ready.

---

## v0.1 — Foundation (current)

_Goal: repo is credible, documented, and ready to receive contributors._

- [x] Project structure and GitHub configuration
- [x] Architecture documentation
- [x] Full syntax reference
- [x] Annotated example `.prompt` files
- [x] CI pipeline (GitHub Actions + Bun)
- [ ] npm package placeholder registration

---

## v0.2 — Lexer + Parser

_Goal: a `.prompt` file can be parsed into an AST and pretty-printed back._

- [ ] Tokenizer (lexer) with full token set
- [ ] Recursive-descent parser for declarations and expressions
- [ ] AST node definitions with visitor pattern
- [ ] `promptlang parse <file>` CLI command (prints AST as JSON)
- [ ] Lexer and parser unit tests (>90% line coverage)

---

## v0.3 — TypeScript Compiler (basic)

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

## v0.5 — Chains (Prompt DAG)

_Goal: prompts can be composed into a directed acyclic graph._

- [ ] `chain` declaration syntax
- [ ] DAG cycle detection in semantic analysis
- [ ] Compiled chain: sequential async function calls in TypeScript
- [ ] Typed data flow: output type of step N must match input type of step N+1
- [ ] `promptlang viz <file>` CLI command: renders chain as ASCII DAG

---

## v0.6 — Native Tests and Evals

_Goal: `test` blocks execute as real unit tests via `bun test`._

- [ ] `test` block parsing and semantic analysis
- [ ] Test runner that compiles the prompt and evaluates assertions
- [ ] `expect`, `expect.<field>`, and `expect.matches` assertion forms
- [ ] `eval` block for running a prompt against a dataset (CSV/JSON)
- [ ] Test failure output with diff between expected and actual

---

## v0.7 — AI-Powered Linter

_Goal: optional static analysis powered by a fast model to catch prompt issues._

- [ ] Linter interface and rule plugin system
- [ ] Built-in rules: injection risk, ambiguous output format, missing system prompt
- [ ] Claude Haiku integration (configurable model)
- [ ] `promptlang lint <file>` CLI command
- [ ] `--strict` flag to fail CI on lint warnings
- [ ] Rule suppression via `// @promptlang-disable <rule>` comments

---

## v0.8 — Python Compiler

_Goal: compiled output targets Python as a first-class language._

- [ ] Python code generator: `prompt` → `async def` with type hints
- [ ] Python runtime stub (supports `anthropic` and `openai` SDK)
- [ ] `promptlang compile <file> --target python` CLI command
- [ ] Parity with TypeScript compiler for primitives, enums, structs, chains
- [ ] Example integration with FastAPI and LangChain-style usage

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
