# PromptLang

**The typed language for production-grade LLM prompts.**

Write, version, test, and deploy your LLM prompts as first-class code.
Compile to TypeScript or Python. Bring your own API key. Zero dependencies.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-626%20passing-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)
[![Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![CI](https://github.com/matteogallo-ai/promptlang/actions/workflows/ci.yml/badge.svg)](https://github.com/matteogallo-ai/promptlang/actions)
[![@promptlang/yaml-parser](https://img.shields.io/npm/v/@promptlang/yaml-parser.svg?label=%40promptlang%2Fyaml-parser)](https://www.npmjs.com/package/@promptlang/yaml-parser)

---

## Why PromptLang

Today, LLM prompts live as strings scattered across Python and TypeScript
codebases. No type safety. No tests. No versioning. When a prompt breaks
in production, you find out from a customer complaint.

PromptLang treats prompts as first-class typed code:

- **Type-safe** inputs and outputs, verified at compile-time
- **Native tests and evals** in the same file as the prompt
- **Semantic versioning** with breaking-change tracking
- **AI-powered linter** that invokes Claude to catch semantic issues static
  analysis cannot see (vague instructions, prompt injection risks, token
  inefficiencies) — nothing else in the ecosystem does this
- **Compile to TypeScript OR Python** from the same source of truth
- **Multi-provider runtime** (Anthropic, OpenAI, Ollama, or your own client)
  with automatic fallback via `RoutingClient`
- **Zero external dependencies** — Bun + `fetch` + your own API keys

---

## Quick example

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

Compile it:

```bash
bun run cli compile classify-ticket.prompt --out ./generated --emit-tsconfig
```

Use it:

```typescript
import { classify_ticket } from "./generated/classify-ticket";
import { AnthropicClient } from "promptlang/runtime";

const client = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY! });
const category = await classify_ticket({ ticket: "..." }, client);
```

---

## Comparison

| Feature                          | LangChain | LangSmith | W&B Weave | **PromptLang** |
| -------------------------------- | :-------: | :-------: | :-------: | :------------: |
| Typed I/O                        |    ❌     |    ❌     |    ❌     |       ✅       |
| Native tests                     |    ❌     |   SaaS    |   SaaS    |     ✅ CLI     |
| SemVer for prompts               |    ❌     |    ❌     |    ❌     |       ✅       |
| **AI-powered linter**            |    ❌     |    ❌     |    ❌     |  ✅ **unique** |
| Multi-provider fallback          |  Partial  |    ❌     |    ❌     |       ✅       |
| Compile to TypeScript **and** Python | ❌     |    ❌     |    ❌     |       ✅       |
| Static analysis (SonarQube-style)|    ❌     |    ❌     |    ❌     |       ✅       |
| Open source, zero SaaS           |    ✅     |    ❌     |    ❌     |       ✅       |

---

## Installation

Currently in alpha distribution — clone the repo:

```bash
git clone https://github.com/matteogallo-ai/promptlang.git
cd promptlang && bun install
bun run cli --help
```

An npm package will be published in a 1.x point release. For now, use the
CLI via `bun run cli <command>`.

---

## AI-Powered Linting

PromptLang can invoke a real LLM to semantically analyze your prompts at build time.
Nothing else in the ecosystem does this.

Static analysis catches structural issues (missing tests, unbounded templates, prompt
injection risks). The AI linter catches semantic issues that static tools cannot see:

- Vague instructions like "be careful" that don't tell the model what to do
- Missing format specs where structured output is expected but not constrained
- Conflicting instructions ("one-sentence summary" + "detailed key points")
- Undefined business terms ("premium user" without a definition)
- Hallucination risks (invitations to guess vs. refuse)
- Token inefficiencies (verbose phrasing that could be shorter)

### Usage

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run cli analyze docs/examples/ --ai
```

The AI linter runs in parallel (3 prompts at a time by default) and returns
confidence-scored issues alongside the static analysis output.

### Cost

The AI linter uses Claude Haiku 4.5 by default (~$0.001 per prompt analyzed).
Running the linter on 10 prompts costs approximately $0.01. Costs are yours —
bring your own API key.

---

## Python target

PromptLang compiles to Python as well as TypeScript:

```bash
bun run cli compile docs/examples/classify-ticket.prompt --out ./generated --target python
```

This generates:

- `classify_ticket.py` — typed Python async function
- `promptlang_runtime.py` — self-contained runtime (no external deps for mocking)
- `__init__.py` — barrel export

### Usage

```python
import asyncio
import os
from generated.classify_ticket import classify_ticket, Category
from generated.promptlang_runtime import AnthropicClient

async def main():
    client = AnthropicClient(api_key=os.environ["ANTHROPIC_API_KEY"])
    result: Category = await classify_ticket(
        {"ticket": "The submit button crashes"},
        client,
    )
    print(result)

asyncio.run(main())
```

Requires Python 3.10+ and `httpx` for real API calls (`pip install httpx`).
The `MockClient` works with no dependencies for local testing.

---

## Project configuration

For multi-file projects, create a `promptlang.yaml` at the project root:

```yaml
name: my-project
version: 1.0.0
defaults:
  model: claude-opus-4.7
  temperature: 0.3
sources:
  - path: ./prompts
compile:
  target: typescript
  out: ./generated
  emit_tsconfig: true
```

Then use imports across files:

```
import "shared/classify.prompt" as Classify

chain full_workflow(input: string) -> string {
  step category = Classify.classify_ticket(input)
  ...
}
```

Bootstrap a new project:

```bash
bun run cli init
bun run cli install
bun run cli compile
```

Once the registry is populated (`.promptlang/manifest.json` + `integrity.json`),
`promptlang check` verifies that no imported prompt has been silently modified
since it was last resolved. See [`docs/yaml-support.md`](docs/yaml-support.md)
for the exact YAML subset supported.

---

## Available runtime providers

The compiled TypeScript imports `PromptClient` from `promptlang/runtime`. Three
provider clients ship with PromptLang — pick the one that matches your stack.

### Anthropic

```typescript
import { AnthropicClient } from "promptlang/runtime";
import { classify_ticket } from "./generated/classify-ticket";

const client = new AnthropicClient({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const category = await classify_ticket(
  { ticket: "The submit button crashes on iOS 17" },
  client
);
```

### OpenAI

```typescript
import { OpenAIClient } from "promptlang/runtime";
import { classify_ticket } from "./generated/classify-ticket";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY!,
  // organization: "org-abc123",   // optional
});

const category = await classify_ticket({ ticket: "..." }, client);
```

### Ollama (local)

```typescript
import { OllamaClient } from "promptlang/runtime";
import { classify_ticket } from "./generated/classify-ticket";

// No API key required — Ollama runs locally.
const client = new OllamaClient({
  baseURL: "http://localhost:11434", // default
});

const category = await classify_ticket({ ticket: "..." }, client);
```

### Routing (automatic fallback)

```typescript
import { AnthropicClient, OpenAIClient, RoutingClient } from "promptlang/runtime";
import { classify_ticket } from "./generated/classify-ticket";

const client = new RoutingClient({
  primary: new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  fallbacks: [new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! })],
  onFallback: (err, i) => console.warn(`Fallback #${i}:`, err.message),
});

const category = await classify_ticket({ ticket: "..." }, client);
```

---

## Working out of the repository

The generated TypeScript uses `import { … } from "promptlang/runtime"`. This
import resolves within this repository via the `package.json` `exports` field.
In an **external project** it will produce `TS2307: Cannot find module 'promptlang/runtime'`
until the npm package is published.

**Workaround** — pass `--emit-tsconfig` to `compile`. It writes a `tsconfig.json`
with a `paths` mapping that points directly at the local runtime source:

```bash
bun run cli compile src/prompts/ --out ./generated --emit-tsconfig
bunx tsc --project ./generated/tsconfig.json --noEmit
```

---

## Documentation

| Document                                              | Description                                        |
| ----------------------------------------------------- | -------------------------------------------------- |
| [docs/syntax-reference.md](docs/syntax-reference.md)  | Complete `.prompt` language reference              |
| [docs/architecture.md](docs/architecture.md)          | Technical design, pipeline, design decisions       |
| [docs/migration-guide.md](docs/migration-guide.md)    | Migration guide 0.x → 1.0                          |
| [docs/yaml-support.md](docs/yaml-support.md)          | YAML subset supported by `promptlang.yaml`         |
| [docs/benchmarks.md](docs/benchmarks.md)              | Measured performance numbers on the reference machine |
| [docs/roadmap.md](docs/roadmap.md)                    | Public milestone roadmap                           |
| [docs/examples/](docs/examples/)                      | Annotated `.prompt` examples                       |

---

## Packages

PromptLang is developed as a Bun workspace. The main `promptlang`
package lives in `src/`. First-party companion packages live under
`packages/` and are published under the `@promptlang/` scope on npm.

| Package | Location | Version | Description |
| --- | --- | --- | --- |
| [`@promptlang/yaml-parser`](https://www.npmjs.com/package/@promptlang/yaml-parser) | `packages/yaml-parser/` | 1.0.0 (published on npm in v1.2.0) | Zero-dependency minimal YAML parser. Extracted from PromptLang core in v1.1.0 so sibling projects (like [Praxis](https://github.com/matteogallo-ai/praxis)) can reuse it via `bun add @promptlang/yaml-parser`. |

Each package has its own `README.md`, `CHANGELOG.md`, and independent
SemVer track.

---

## Roadmap post-1.0

- npm package publication (`npm install promptlang`)
- Remote package registry (currently local-only)
- Streaming responses in the runtime
- More provider clients (Google Gemini, Mistral, Cohere)
- IDE extensions (VS Code syntax highlighting, LSP)
- MCP server integration

See [`docs/roadmap.md`](docs/roadmap.md) for the full plan and the story of
what was built in the 11 alpha releases.

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
coding standards, and the PR checklist. If you're unsure where to start, look for
issues tagged `good first issue`.

---

## License

MIT © Matteo Gallo — see [LICENSE](LICENSE).
