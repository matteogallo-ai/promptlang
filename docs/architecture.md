# Architecture

This document describes the technical design of PromptLang: why it exists, how it
works, and the reasoning behind key decisions. It is a living document — updated as
the implementation evolves.

---

## Vision

Prompts are the most critical, least disciplined artifacts in AI engineering. A
single character change in a system prompt can silently degrade output quality across
thousands of requests. Yet most teams manage prompts as raw strings — no types, no
tests, no version history that means anything to a compiler.

PromptLang's thesis is that prompts should be treated with the same rigor as any
other typed interface. A prompt has inputs, an output type, a model contract, and
observable behavior that can be asserted. All of these should be expressible in code
and verifiable by a compiler and test runner.

The goal is not to replace LangChain or LangSmith. It is to occupy the layer they
left empty: a **typed language** for authoring prompts, analogous to what TypeScript
did for JavaScript.

---

## Pipeline

A `.prompt` file is transformed in stages:

```
.prompt source file
      │
      ▼
┌─────────────┐
│    Lexer    │  text → token stream
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Parser    │  tokens → Concrete Syntax Tree (CST)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  AST Builder│  CST → Abstract Syntax Tree (AST)
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│ Semantic Analysis│  type checking, scope resolution,
│                  │  DAG cycle detection, version compat
└──────┬───────────┘
       │
       ├──────────────────┐
       ▼                  ▼
┌────────────┐    ┌────────────────┐
│ TS Compiler│    │ Python Compiler│   code generators
└──────┬─────┘    └───────┬────────┘
       │                  │
       ▼                  ▼
  .ts stub file     .py stub file
```

Each stage is a pure function: given an input, it either returns a successful result
or a structured list of diagnostics (errors + warnings). There is no global mutable
state between stages.

---

## Component status (v1.0)

| Component | Status | Since |
| --------- | :----: | ----- |
| Lexer                        | ✅ | v0.2  |
| Parser + AST                 | ✅ | v0.3  |
| Static analyzer (6 rules)    | ✅ | v0.3.1 |
| TypeScript compiler          | ✅ | v0.4  |
| Chain compilation (DAG)      | ✅ | v0.5  |
| `--emit-tsconfig` bridge     | ✅ | v0.5.1 |
| Multi-provider runtime       | ✅ | v0.6  |
| AI-powered linter            | ✅ | v0.7  |
| Python compiler              | ✅ | v0.8  |
| Project config + registry    | ✅ | v0.9  |
| CLI (parse/tokens/analyze/compile/init/install/list/check/version) | ✅ | v0.3.1 → v0.9 |
| Streaming responses          | 🚧 | planned 1.x |
| npm package                  | 🚧 | planned 1.x |
| Remote package registry      | 🚧 | planned 1.x |
| VS Code extension + LSP      | 🚧 | planned 1.x |

---

## Modules

### `src/lexer/` ✅ implemented (v0.2)

Converts raw source text into a flat token stream. Each token carries its kind, raw
text, and source position (line + column). The lexer handles:

- Keywords: `prompt`, `chain`, `test`, `eval`, `type`, `enum`, `struct`
- Directives: `@version`, `@model`, `@temperature`
- Literals: strings (single, double, triple-quoted), numbers, booleans
- Template interpolations: `{{...}}` inside string literals
- Comments: `//` line comments, `/* */` block comments (stripped from output)
- Whitespace: preserved in positions, discarded from token stream

The lexer is implemented as a hand-written state machine. No regex-based tokenizer is
used — this gives precise error recovery and clean position tracking.

### `src/parser/` ✅ implemented (v0.3)

Hand-written recursive descent parser. Consumes the filtered token stream (NEWLINE,
COMMENT_LINE, and COMMENT_BLOCK tokens are discarded) and produces a typed AST directly.
One parse method per grammar rule; no intermediate CST.

Grammar highlights (full EBNF in `src/parser/grammar.md`):

```
Program       = Metadata* Declaration*
Metadata      = "@version" | "@model" | "@temperature" | "@max_tokens"
              | "@breaking_changes" | "@migration_from" | "@description"
Declaration   = TypeDecl | PromptDecl | ChainDecl | TestDecl | EvalDecl
TypeDecl      = "type" IDENT "=" TypeExpression
TypeExpression= PrimitiveType | EnumType | StructType | TypeReference
PromptDecl    = "prompt" IDENT "(" ParamList? ")" "->" TypeExpression "{" Section+ "}"
ChainDecl     = "chain" IDENT "(" ParamList? ")" "->" TypeExpression "{" Step+ "return" Expr "}"
TestDecl      = "test" StringLit "{" "input" ":" Expr Expectation+ "}"
EvalDecl      = "eval" StringLit "{" dataset prompt metric threshold "}"
```

Throws `ParserError` with line, column, expected type, and found type on any grammar
violation. Named arguments (`key: value`) are supported in call expressions.

### `src/ast/` ✅ implemented (v0.3)

AST node definitions. Each node is a plain TypeScript interface with a `kind`
discriminant, typed children, and `line`/`column` source positions. The AST discards
token-level noise (whitespace, comments) to keep analysis clean.

An `printAst()` utility in `src/ast/printer.ts` renders the tree as a human-readable
box-drawing string for debugging and the future `promptlang parse` CLI command.

### `src/compiler/` (TypeScript backend) ✅ implemented (v0.4)

Code generator that walks the AST and emits TypeScript source. Design goals:

- The generated code is **human-readable** — it should look like code a competent
  developer would write, not a macro expansion.
- Generated functions use `async/await` and return typed values.
- No runtime dependency on PromptLang internals beyond the thin `promptlang/runtime`
  package (model calls, output parsing).

### `src/compiler/python/` ✅ implemented (v0.8)

Python backend, mirroring the TypeScript compiler. Activated with `--target python`.

**Type mapping:**

| PromptLang | Python |
|------------|--------|
| `string` | `str` |
| `number` | `float` |
| `boolean` | `bool` |
| `date` | `str` (ISO 8601) |
| `enum { a, b }` | `Literal["a", "b"]` + `_NAME_VALUES` list for runtime validation |
| `struct { f: t }` | `class Name(TypedDict)` with `NotRequired[T]` for optional fields |
| TypeReference | referenced class name |

**Generated file structure per compile run:**
- `<name>.py` — async function(s) with `TypedDict` inputs and runtime validation
- `__init__.py` — `from .module import *` barrel
- `promptlang_runtime.py` — autonomous runtime with `PromptClient` (ABC), `MockClient`, `AnthropicClient` (httpx), `OpenAIClient` (httpx)

**Template compilation:** `{{var}}` → `{input['var']}` inside f-strings. Literal `{` and `}` that aren't part of a `{{...}}` pattern are doubled (`{{`/`}}`) to be safe in f-string context.

**Naming conventions:** functions and variables use `snake_case`; input types use `PascalCase + Input`; meta constants use `SCREAMING_SNAKE_CASE + _META`; enum value lists use `_NAME_VALUES`.

### `src/analyzer/` ✅ implemented (v0.3+)

Static analysis pass that runs against the parsed AST. Two tiers:

**Static rules** (`src/analyzer/rules/`) — no model required. Run on every `analyze` call:

| Rule | What it checks |
|------|---------------|
| `missing-tests` | Prompts with zero test blocks |
| `unbounded-template` | Template variables in non-user sections (cost risk) |
| `prompt-injection-risk` | Undelimited `{{var}}` in user section |
| `token-cost-estimate` | Prompts with likely token cost > threshold |
| `chain-complexity` | Chains with too many steps |
| `duplicate-prompts` | Identical prompt bodies across files |

**AI rules** (`src/analyzer/ai/`) — opt-in via `--ai` flag. Invokes Claude Haiku to detect semantic issues:

Six semantic categories detected:
- `VAGUE_INSTRUCTIONS` — non-actionable phrases without concrete criteria
- `MISSING_FORMAT_SPEC` — structured output expected but format not constrained
- `CONFLICTING_INSTRUCTIONS` — contradictory or ambiguous requirements
- `UNDEFINED_TERMS` — business terms used without definition
- `POTENTIAL_HALLUCINATION_RISK` — instruction invites guessing vs. refusing
- `TOKEN_INEFFICIENCY` — verbose phrasing that could be shortened

**Meta-prompt design**: `AI_LINTER_SYSTEM_PROMPT` instructs Claude to respond with a strict JSON schema (`{"issues": [...]}`) with no surrounding text. The parser in `issue-parser.ts` strips markdown fences and returns a `ai:parse-failure` issue if the response is malformed.

**Concurrency**: `AiLinter` processes prompts in configurable batches (default 3 at a time) using `Promise.allSettled`. A failing API call for one prompt does not block others.

**Injectable client**: `AiLinter` accepts a custom `PromptClient` via `AiLinterOptions.client`. This is how all tests bypass the network — no `fetch` mocking required.

### `src/linter/` (placeholder)

Reserved for a future pluggable rule registry. Rule authoring today lives in
`src/analyzer/rules/` (static) and `src/analyzer/ai/` (LLM-driven); the
placeholder namespace will host user-defined rules once we ship a public rule
API in a 1.x release.

### `src/config/` ✅ implemented (v0.9)

Owns the project-level `promptlang.yaml` configuration.

- `yaml-parser.ts` — a hand-written minimal YAML parser (mappings, sequences,
  scalars, comments) with **zero external dependencies**. See
  [`docs/yaml-support.md`](yaml-support.md) for the exact supported subset.
- `config.ts` — layers a validation + defaults pass on top of the parser and
  produces the fully typed `PromptLangConfig` interface. Required fields
  (`name`, `version`) throw `ConfigValidationError`; unknown values for
  `compile.target` are rejected explicitly.

### `src/registry/` ✅ implemented (v0.9)

Manages the `.promptlang/` on-disk registry. Three collaborating modules:

- `resolver.ts` — turns raw import paths (`import "shared/x.prompt" as X`)
  into absolute filesystem paths. Lookup order: relative-to-file first, then
  each `sources[*].path` from `promptlang.yaml`. `resolveGraph()` walks the
  full transitive import graph and rejects circular imports with a stack
  trace of the cycle.
- `integrity.ts` — SHA-256 hashing of every `.prompt` file. Line endings are
  normalized (CRLF→LF) so cross-platform hashes match. `verifyIntegrity`
  returns the list of mismatches (or missing files) since the last
  `install`.
- `registry.ts` — orchestrator. `install()` runs the resolver + integrity
  hashing and writes `manifest.json` (resolved graph, sorted for stable
  diffs) and `integrity.json`. `check()` re-verifies without re-resolving.

**On-disk layout produced by `install`:**

```
.promptlang/
├── manifest.json     # { version: 1, files: [...], imports: [{from, to, alias}] }
├── integrity.json    # { "<absolute-path>": "<sha256-hex>", ... }
└── cache/            # reserved for v1.0+ (remote registry cache)
```

The manifest is intentionally a plain, sorted JSON file so it diffs cleanly
in code review and can be committed to source control.

### `src/runtime/` ✅ implemented (v0.6)

The runtime package that compiled stubs import at runtime. It is the only part
of PromptLang that makes network calls.

**Core types** (`types.ts`, `client.ts`):

- `PromptRequest` — model, messages, temperature, max_tokens
- `PromptResponse` — content string, normalized usage (input/output tokens)
- `PromptClient` — the interface every provider implements: `complete(request): Promise<PromptResponse>`

**Error hierarchy** (`errors.ts`):

All runtime errors extend `PromptClientError → Error`. Sub-classes:

| Class | Retried? | When |
|-------|----------|------|
| `AuthenticationError` | Never | 401 |
| `RateLimitError` | Yes | 429 |
| `ServerError` | Yes | 5xx |
| `InvalidRequestError` | Never | 400 |
| `TimeoutError` | Yes | AbortController fires |
| `NetworkError` | Yes | Low-level fetch failure |
| `ConnectionError` | Yes | ECONNREFUSED (Ollama) |
| `NotFoundError` | Never | 404 (Ollama model missing) |
| `AllProvidersFailedError` | — | All RoutingClient providers failed |

**Provider clients** (`providers/`):

- `AnthropicClient` — POST `/v1/messages`; separates system messages into the top-level `system` field; max_tokens defaults to 1024.
- `OpenAIClient` — POST `/v1/chat/completions`; messages forwarded unchanged; normalizes `prompt_tokens`/`completion_tokens` to `input_tokens`/`output_tokens`.
- `OllamaClient` — POST `/api/chat`; no auth; maps `options.temperature` / `options.num_predict`; `stream: false`; pedagogical errors for ECONNREFUSED and 404.
- `RoutingClient` — tries `primary`, then each `fallback` in order; `AuthenticationError` short-circuits without trying fallbacks; aggregates all errors in `AllProvidersFailedError`.

All provider clients use a shared `withRetry` utility (exponential backoff, configurable `maxRetries` and `retryDelay`).

**MockClient** (`client.ts`) — for local development and unit tests; accepts a queue of `PromptResponse[]` or a function `(req) => PromptResponse`.

**Design invariants:**
- Tests never make real HTTP calls; all provider tests spy on `globalThis.fetch`.
- Zero external dependencies — uses the `fetch` global provided by Bun.
- Streaming responses are not implemented; planned as a 1.x feature
  (`PromptClient.stream()` companion to `.complete()`).

### `src/cli/` ✅ implemented (v0.3.1 → v0.9)

Command-line interface. Subcommands:

| Command                                    | Since | Description                        |
| ------------------------------------------ | ----- | ---------------------------------- |
| `promptlang parse <file>`                  | v0.2  | Print AST as JSON                  |
| `promptlang compile <file> --target ts`    | v0.3  | Compile to TypeScript              |
| `promptlang compile <file> --target py`    | v0.8  | Compile to Python                  |
| `promptlang init`                          | v0.9  | Scaffold a new project             |
| `promptlang install`                       | v0.9  | Resolve imports and write registry |
| `promptlang list [--json]`                 | v0.9  | List all prompts in the project    |
| `promptlang check`                         | v0.9  | Verify integrity + import resolution |
| `promptlang test <file>`                   | v0.6  | Run test blocks                    |
| `promptlang eval <file> --data <csv>`      | v0.6  | Run eval block against dataset     |
| `promptlang lint <file>`                   | v0.7  | Run linter rules                   |
| `promptlang viz <file>`                    | v0.5  | Render chain as ASCII DAG          |

---

## Design Decisions

### TypeScript as the implementation language

TypeScript gives us strong types for the AST, exhaustiveness checking on node
discriminants, and a modern async story via Bun. The alternative was Rust (faster,
but harder to contribute to and iterate on) or Go (simpler, but weaker type system
for tree-structured data). TypeScript is also the primary compile target, which
means the compiler can dogfood its own output types.

### Recursive descent parser, no parser generator

Using a parser generator (ANTLR, PEG.js, tree-sitter) would reduce boilerplate but
add an opaque dependency and make it harder to produce good error messages. A
hand-written recursive descent parser has full control over error recovery, position
tracking, and incremental parsing. The PromptLang grammar is simple enough that the
parser is not the bottleneck — clarity is more valuable than brevity here.

### Separate Lexer and Parser stages

A single-pass scanner/parser would be faster but harder to test and extend. Keeping
the lexer as a pure text→tokens transform means it can be tested in isolation and
reused by tooling (syntax highlighting, LSP) without pulling in the parser.

### Compiling to TypeScript AND Python

The two languages cover the majority of the AI engineering market. TypeScript targets
Node/Bun backend teams, Next.js apps, and serverless edge functions. Python targets
data scientists, ML engineers, and FastAPI/Django backends. A single `.prompt`
source can target both without modification — the compiler handles language-specific
idioms (async/await patterns, type hint syntax, package conventions).

### Model-agnostic prompt declarations

Provider and model configuration lives in `promptlang.config.yaml`, not in the
`.prompt` file (the `@model` directive in the file is a default, overridable by
config). This means the same prompt file can be tested against GPT-4o and
Claude simultaneously, and switching providers doesn't require editing prompt logic.
It also makes the language portable for teams that want to vendor-neutral their stack.

### MIT license

Maximizes adoption. Teams that build internal tooling on top of PromptLang should
not be required to open-source it. Enterprise adopters often cannot use copyleft
(LGPL/GPL) tools due to legal policy. MIT is the industry standard for developer
tools that want broad adoption.

### Bun as the runtime and test runner

Bun is measurably faster than Node for cold-start CLI tools (the use case here) and
provides native TypeScript execution without a separate transpile step. The `bun test`
runner is compatible with Jest-style assertions, making it easy for contributors
familiar with Jest to write tests without learning a new API.

### No dependency on LangChain

PromptLang is intentionally positioned as a layer *below* orchestration frameworks,
not alongside them. The compiled output is plain TypeScript/Python with a thin
runtime — it can be called from LangChain, LangGraph, or directly, without
framework coupling. Depending on LangChain in the compiler would create version
coupling and make PromptLang less portable.

---

## Non-Goals

**PromptLang is not a runtime inference engine.** It compiles to code that calls
existing provider APIs. It does not run models locally or implement any inference.

**PromptLang is not a SaaS product.** There is no hosted service, no telemetry, no
account required. It runs entirely in your local environment and CI pipeline.

**PromptLang is not a full replacement for LangChain.** It covers the prompt
authoring and testing layer. It does not implement agent loops, vector store
integrations, document loaders, or memory management. Those concerns belong in
the orchestration layer above the compiled stubs.

**PromptLang is not a visual prompt builder.** The source format is text, not a
GUI. This is a deliberate choice: text is diffable, reviewable in PRs, and
composable with standard developer tooling.

---

## Comparison with Adjacent Tools

### LangChain

LangChain is an orchestration framework, not a language. It provides Python and
TypeScript libraries for chaining LLM calls, managing memory, and integrating tools.
PromptLang is complementary: compiled stubs can be called *from* LangChain. The key
difference is that LangChain prompts are runtime objects with no static type checking,
whereas PromptLang prompts are compiled to typed functions verified before execution.

### LangSmith

LangSmith is an observability and evaluation platform (SaaS). It captures traces,
datasets, and human feedback for LLM applications. PromptLang overlaps with
LangSmith's eval feature but operates earlier in the development loop: evals run
locally in CI without requiring a hosted service. PromptLang does not compete with
LangSmith's tracing or human feedback features.

### W&B Weave

Weave is a tracing and evaluation product from Weights & Biases, similar in scope
to LangSmith. It provides excellent dataset management and eval visualization but
requires a W&B account and does not offer a typed prompt authoring format.
PromptLang's eval output format is designed to be exportable to Weave and LangSmith
for teams that use those platforms for longitudinal tracking.

---

## Future: Incremental Compilation and LSP

The architecture is designed to support incremental compilation (only re-compile
files whose AST has changed) and a Language Server Protocol (LSP) implementation
for IDE support. Both require the lexer and parser to be re-entrant and for the
semantic analysis pass to operate on individual file ASTs with a shared symbol table.
These are post-v1.0 concerns but the current design does not foreclose them.
