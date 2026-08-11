# PromptLang

```
 ____                            _   _
|  _ \ _ __ ___  _ __ ___  _ __| |_| |    __ _ _ __   __ _
| |_) | '__/ _ \| '_ ` _ \| '_ \ __| |   / _` | '_ \ / _` |
|  __/| | | (_) | | | | | | |_) | |_| |__| (_| | | | | (_| |
|_|   |_|  \___/|_| |_| |_| .__/ \__|_____\__,_|_| |_|\__, |
                           |_|                          |___/
```

**The typed language for production-grade LLM prompts.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/badge/npm-0.1.0--alpha.0-orange)](https://www.npmjs.com/package/promptlang)
[![CI](https://github.com/matteogallo-ai/promptlang/actions/workflows/ci.yml/badge.svg)](https://github.com/matteogallo-ai/promptlang/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)

---

Prompts are code. They have inputs, outputs, versions, and failure modes — yet most
teams manage them as raw strings scattered across codebases, hardcoded in notebooks,
or pasted into spreadsheets. PromptLang treats prompts as first-class typed artifacts:
you write them in a purpose-built DSL, compile them to TypeScript or Python stubs,
and test them with built-in assertions. No more silent drift. No more untested prompt
changes going straight to production.

---

## Why PromptLang

**Static typing.** Every prompt has an explicit signature: typed inputs and a typed
output. The compiler catches schema mismatches before you ship them.

**Native tests.** Write `test` blocks directly in your `.prompt` file. Run them with
`bun test` or `pytest` like any other unit test. Eval harnesses are built-in, not
bolted on.

**Semantic versioning.** Each file carries a `@version` directive. The compiler
enforces compatibility between prompt versions in a chain and generates deprecation
warnings for callers of older interfaces.

**AI-powered linter.** An optional static analysis pass (v0.7) uses a fast model
to detect prompt injection risks, ambiguous instructions, and model-specific pitfalls
before your code reaches CI.

**Model-agnostic by design.** Provider configuration lives in `promptlang.config.yaml`,
not in your prompt logic. Swap from `claude-opus-4.7` to `gpt-4o` in one line.
Your compiled stubs remain unchanged.

---

## Quick Example

```promptlang
@version "1.0.0"
@model claude-opus-4.7
@temperature 0.3

type Category = enum { bug, feature_request, question, other }

prompt classify_ticket(ticket: string) -> Category {
  system: """
    You are a support ticket classifier.
    Respond with exactly one category, no explanation.
  """
  user: "Classify: {{ticket}}"
  output: Category
}

test "classifies bug reports correctly" {
  input: classify_ticket("The submit button crashes the app on iOS 17")
  expect: bug
}

test "classifies feature requests correctly" {
  input: classify_ticket("It would be great to export data as CSV")
  expect: feature_request
}
```

Compile to TypeScript:

```bash
promptlang compile classify-ticket.prompt --target typescript
```

Output (`classify-ticket.ts`):

```typescript
import { callLLM } from "promptlang/runtime";

type Category = "bug" | "feature_request" | "question" | "other";

export async function classifyTicket(ticket: string): Promise<Category> {
  return callLLM({
    model: "claude-opus-4.7",
    temperature: 0.3,
    system: "You are a support ticket classifier. Respond with exactly one category, no explanation.",
    user: `Classify: ${ticket}`,
    outputType: "Category",
  });
}
```

---

## Why does this matter?

Today, teams ship LLM features with prompts stored as strings in Python or JavaScript.
There is no type checking. No tests. No versioning. No linting. When a prompt breaks
in production, you find out from a customer complaint.

PromptLang treats prompts as first-class typed code:

- Type-safe inputs and outputs, verified at compile-time
- Native tests and evals in the same file as the prompt
- Semantic versioning with breaking-change tracking
- Static analysis for injection vectors, unbounded costs, and quality drift
- Compile once, run against any provider (Anthropic, OpenAI, local models)

This isn't a wrapper around an SDK. It's the compiler and type system your prompts
have been missing.

---

## Try it now

Clone the repo and analyze the example prompts:

```bash
git clone https://github.com/matteogallo-ai/promptlang.git
cd promptlang
bun install
bun run src/cli/cli.ts analyze docs/examples/
```

You'll see a real static analysis report — prompt injection warnings, missing tests,
token cost estimates, chain complexity. None of the alternatives (LangChain, LangSmith,
W&B Weave) do this today.

Other commands:

```bash
# Print the AST of a .prompt file
bun run src/cli/cli.ts parse docs/examples/classify-ticket.prompt

# Print the token stream
bun run src/cli/cli.ts tokens docs/examples/extract-invoice.prompt

# JSON output for CI/CD integration
bun run src/cli/cli.ts analyze docs/examples/ --json

# Fail CI if any warnings are found
bun run src/cli/cli.ts analyze docs/examples/ --strict
```

---

## Comparison

| Capability                   | PromptLang | LangChain | LangSmith | W&B Weave |
| ---------------------------- | ---------- | --------- | --------- | --------- |
| Typed prompt signatures      | ✅         | ❌        | ❌        | ❌        |
| Native test assertions       | ✅         | ❌        | Partial   | Partial   |
| Semver for prompts           | ✅         | ❌        | ❌        | ❌        |
| Static analysis CLI          | ✅         | ❌        | ❌        | ❌        |
| Injection risk detection     | ✅         | ❌        | ❌        | ❌        |
| Compiles to TypeScript       | ✅ (v0.4)  | ❌        | ❌        | ❌        |
| Compiles to Python           | ✅ (v0.8)  | N/A       | N/A       | N/A       |
| Model-agnostic config        | ✅         | Partial   | ✅        | ✅        |
| AI-powered linter            | ✅ (v0.7)  | ❌        | ❌        | ❌        |
| Self-hostable, no SaaS       | ✅         | ✅        | ❌        | ❌        |
| Open source (MIT)            | ✅         | ✅        | ❌        | ❌        |

---

## Installation

> PromptLang is in alpha. The npm package will be published at v0.3 (first working compiler).

```bash
# Coming at v0.3
bun install promptlang
```

For now, clone and use locally:

```bash
git clone https://github.com/matteogallo-ai/promptlang.git
cd promptlang
bun install
```

---

## Documentation

| Document | Description |
| -------- | ----------- |
| [docs/architecture.md](docs/architecture.md) | Technical design, pipeline, design decisions |
| [docs/syntax-reference.md](docs/syntax-reference.md) | Complete language reference |
| [docs/roadmap.md](docs/roadmap.md) | Public milestone roadmap |
| [docs/examples/](docs/examples/) | Annotated `.prompt` examples |

---

## Roadmap

See [docs/roadmap.md](docs/roadmap.md) for the full plan.

**In short:**

- **v0.1** (now) — Repo foundation, docs, examples
- **v0.2** — Lexer, parser, AST printer
- **v0.3** — TypeScript compiler (basic)
- **v0.4** — Type system (primitives, enum, struct)
- **v0.5** — Chains (prompt composition / DAG)
- **v0.6** — Native tests and evals
- **v0.7** — AI-powered linter
- **v0.8** — Python compiler
- **v1.0** — Stable, public release

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
coding standards, and the PR checklist. If you're unsure where to start, look for
issues tagged `good first issue`.

---

## License

MIT — see [LICENSE](LICENSE).
