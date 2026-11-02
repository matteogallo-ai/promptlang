# PromptLang

**The typed language for production-grade LLM prompts.**

Write your LLM prompts as typed, first-class code and compile them to
TypeScript or Python. Bring your own API key. No third-party runtime dependencies.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
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

- **Typed I/O**: typed inputs and outputs; the generated TypeScript type-checks under `strict`
- **Compile to TypeScript and Python** from the same source of truth
- **Static analysis (SonarQube-style)**: six deterministic rules (missing tests, unbounded
  templates, prompt-injection risk, token cost, chain complexity, duplicates)
- **Multi-provider runtime** (Anthropic, OpenAI, Ollama, or your own client)
- **No third-party runtime dependencies**: Bun + `fetch` + your own API keys

Not delivered, and labelled as such everywhere in this repository (see
[`docs/CLAIMS.md`](docs/CLAIMS.md)):

- **Native tests**: `test` blocks are parsed but not executed
- **SemVer for prompts**: `@version` is not validated and imports carry no
  version constraint
- **Cross-provider fallback**: `RoutingClient` switches providers, but the
  generated code sends one model name to all of them
- **AI-powered linter**: the plumbing is tested with a mocked client only; there
  is no committed live run, so its findings are not a measured quality

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

// Parsed and kept in the AST; no command executes it (see Roadmap).
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

Each PromptLang cell is checked against [`docs/CLAIMS.md`](docs/CLAIMS.md) by the
`claims` CI job. The other columns reflect the maintainer's reading of those
tools' public documentation and are not tested here.

| Feature                          | LangChain | LangSmith | W&B Weave | **PromptLang** |
| -------------------------------- | :-------: | :-------: | :-------: | :------------: |
| Typed I/O                        |    ❌     |    ❌     |    ❌     |       ✅       |
| Native tests                     |    ❌     |   SaaS    |   SaaS    | Roadmap (in progress) |
| SemVer for prompts               |    ❌     |    ❌     |    ❌     | Roadmap (in progress) |
| AI-powered linter                |    ❌     |    ❌     |    ❌     | Partial (mocked tests only) |
| Multi-provider fallback          |  Partial  |    ❌     |    ❌     | Partial (same model name only) |
| Compile to TypeScript **and** Python | ❌     |    ❌     |    ❌     |       ✅       |
| Static analysis (SonarQube-style)|    ❌     |    ❌     |    ❌     |       ✅       |
| Open source, zero SaaS           |    ✅     |    ❌     |    ❌     |       ✅       |

---

## Installation

`@promptlang/core` is not on npm. Clone the repository:

```bash
git clone https://github.com/matteogallo-ai/promptlang.git
cd promptlang && bun install
bun run cli --help
```

Then run the CLI with `bun run cli <command>`.

---

## AI-Powered Linting

PromptLang can send each prompt to an LLM for a semantic review at build time.
Status: **partial**. The request/response plumbing is covered by tests that use a
mocked client; no live run has been committed, so nothing here measures how good
the findings are.

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

Each analyzed prompt is one request to Claude Haiku 4.5 (by default) with
`max_tokens: 1024`. At list prices ($1 / $5 per million input / output tokens) the
three example files (four prompts, ~2 200 input tokens) cost at most about $0.03.
This is an estimate from request sizes, not a measurement. Costs are yours —
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

Files can declare imports at the top:

```
import "shared/classify.prompt" as Classify
```

`install` resolves these imports into the project's dependency graph and
`check` verifies their hashes. Calling an imported prompt from a chain
(`Classify.classify_ticket(...)`) does not parse; chains can only call
prompts declared in the same file.

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

### Routing (fallback across providers)

> **Limitation.** The generated code puts the `@model` value in every request, so
> the fallback below sends a Claude model ID to OpenAI, which rejects it. Fallback
> works today only between clients that accept the same model name (for example
> two Anthropic clients with different keys or base URLs).

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

The generated TypeScript uses `import { … } from "promptlang/runtime"`. Inside
this repository that import resolves through the `paths` mapping in
`tsconfig.json`. In an **external project** it fails with
`TS2307: Cannot find module 'promptlang/runtime'`, because the package is not
published.

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
| [docs/benchmarks.md](docs/benchmarks.md)              | Timings produced by `bun run bench`                |
| [docs/CLAIMS.md](docs/CLAIMS.md)                      | Every advertised capability → module → test → status |
| [docs/ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md) | Rules every change in this repository follows |
| [docs/roadmap.md](docs/roadmap.md)                    | Public milestone roadmap                           |
| [docs/examples/](docs/examples/)                      | Annotated `.prompt` examples                       |

---

## Packages

PromptLang is developed as a Bun workspace. The main package,
`@promptlang/core` (not published to npm; the CLI binary is `promptlang`), lives in `src/`. First-party companion packages live under
`packages/` and are published under the `@promptlang/` scope on npm.

| Package | Location | Version | Description |
| --- | --- | --- | --- |
| [`@promptlang/yaml-parser`](https://www.npmjs.com/package/@promptlang/yaml-parser) | `packages/yaml-parser/` | 1.0.0 (published on npm in v1.2.0) | Zero-dependency minimal YAML parser. Extracted from PromptLang core in v1.1.0 so sibling projects (like [Praxis](https://github.com/matteogallo-ai/praxis)) can reuse it via `bun add @promptlang/yaml-parser`. |

Each package has its own `README.md`, `CHANGELOG.md`, and independent
SemVer track.

---

## Roadmap

In progress:

- **SemVer for prompts** — validate `@version`, version constraints on imports,
  and a `semver-check` command that detects breaking interface changes
- **Native tests** — execute `test` blocks with the mock client by default
- **Cross-provider fallback** — per-provider model mapping in `RoutingClient`
- **npm publication** of `@promptlang/core`

Not scheduled:

- Remote package registry (the registry is local-only)
- Streaming responses in the runtime
- More provider clients (Google Gemini, Mistral, Cohere)
- IDE extensions (VS Code syntax highlighting, LSP)
- MCP server integration

See [`docs/roadmap.md`](docs/roadmap.md) for the full list.

---

## How this was built

PromptLang was written mostly by a coding agent (Claude Code) working from the
maintainer's specifications, one milestone per release; the git history up to
v1.2.0 shows one large commit per milestone.

On 2026-11-02 an independent external audit compared the README with the code. It found
that the two headline features — "SemVer for prompts" and "Native tests" — were
marked ✅ but not implemented; that `src/index.ts` exported only a hard-coded
`VERSION = "0.1.0-alpha.0"` in v1.2.0; that the test badge double-counted the
workspace package's tests; that cross-provider fallback could not work; and that
the package could not be published under its name. A follow-up review of the
docs found that `parallel` steps and calls to imported prompts, both documented,
do not parse.

What changed in response:

- every README capability is now listed in [`docs/CLAIMS.md`](docs/CLAIMS.md)
  with its test, and CI (`claims`) fails if the README shows an unshipped one as ✅;
- CI (`stale-narrative`) rejects forward-looking release talk and untracked TODOs in code and docs;
- Biome and knip run in CI; dead code they reported was removed;
- the package is `@promptlang/core` and its entry point exports the compiler API;
- the rules followed for every change are in
  [`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md): agent output is
  reviewed by a second agent with fresh context, then audited by the maintainer.

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
coding standards, and the PR checklist. If you're unsure where to start, look for
issues tagged `good first issue`.

---

## License

MIT © Matteo Gallo — see [LICENSE](LICENSE).
