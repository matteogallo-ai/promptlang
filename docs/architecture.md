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

### `src/compiler/typescript/`

Code generator that walks the AST and emits TypeScript source. Design goals:

- The generated code is **human-readable** — it should look like code a competent
  developer would write, not a macro expansion.
- Generated functions use `async/await` and return typed values.
- No runtime dependency on PromptLang internals beyond the thin `promptlang/runtime`
  package (model calls, output parsing).

### `src/compiler/python/`

Equivalent Python code generator (v0.8). Emits `async def` functions with PEP 484
type hints. Compatible with both `anthropic` and `openai` Python SDKs.

### `src/linter/`

Static analysis pass (v0.7). Runs after semantic analysis. Two categories of rules:

1. **Structural rules** — no model required. Examples: missing system prompt, unused
   parameter, `@version` missing.
2. **AI rules** — uses a configurable fast model (default: Claude Haiku). Examples:
   injection risk scoring, output format ambiguity, instruction clarity rating.

Rules are pluggable: third-party packages can register additional rules.

### `src/runtime/`

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
- Streaming is not implemented (v0.8+).

### `src/cli/`

Command-line interface (v0.2+). Subcommands:

| Command                                    | Since | Description                        |
| ------------------------------------------ | ----- | ---------------------------------- |
| `promptlang parse <file>`                  | v0.2  | Print AST as JSON                  |
| `promptlang compile <file> --target ts`    | v0.3  | Compile to TypeScript              |
| `promptlang compile <file> --target py`    | v0.8  | Compile to Python                  |
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
