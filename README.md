# PromptLang

**The typed language for production-grade LLM prompts.**

Write your LLM prompts as typed, first-class code and compile them to
TypeScript or Python. Bring your own API key. No third-party runtime dependencies.

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/matteogallo-ai/promptlang/badge)](https://scorecard.dev/viewer/?uri=github.com/matteogallo-ai/promptlang)
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
- **Native tests**: `promptlang test` runs `test` blocks against the generated code,
  on recorded `mock:` responses by default or on the provider with `--live`
- **SemVer for prompts**: `@version` is validated, imports can require a version
  range, and `promptlang semver-check` fails when a prompt's interface changed more
  than its version says
- **Multi-provider runtime** (Anthropic, OpenAI, Ollama, or your own client)
- **Multi-provider fallback**: `RoutingClient` tries providers in order, translating
  the model name per provider (`modelMap`), and never falls back on a bad key
- **AI-powered linter**: `analyze --ai` sends each prompt to Claude for a semantic
  review; one live run is committed, its quality is not measured
- **No third-party runtime dependencies**: Bun + `fetch` + your own API keys

Not delivered, and labelled as such everywhere in this repository (see
[`docs/CLAIMS.md`](docs/CLAIMS.md)):

- **`eval` blocks**: parsed, not executed

---

## Quick example

```promptlang
@version "1.0.0"
@model claude-opus-5-5

type Category = enum { bug, feature_request, question, other }

prompt classify_ticket(ticket: string) -> Category {
  system: """
    You are a support ticket classifier.
    Respond with exactly one category, no explanation.
  """
  user: """
    Classify the ticket between the <ticket> tags.
    <ticket>
    {{ticket}}
    </ticket>
  """
  output: Category
}

// `promptlang test` replays `mock:` through the generated code;
// `promptlang test --live` asks the model instead.
test "classifies bug reports correctly" {
  input: classify_ticket("The submit button crashes the app on iOS 17")
  mock: "bug"
  expect: bug
}

test "classifies feature requests correctly" {
  input: classify_ticket("It would be great to export data as CSV")
  mock: "feature_request"
  expect: feature_request
}
```

Test it, then compile it (the `promptlang` CLI runs on Bun ≥ 1.2.20):

```bash
npx promptlang test classify-ticket.prompt
```

```bash
npx promptlang compile classify-ticket.prompt --out ./generated
```

Use it:

```typescript
import { classify_ticket } from "./generated/classify-ticket";
import { AnthropicClient } from "@promptlang/core/runtime";

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
| Native tests                     |    ❌     |   SaaS    |   SaaS    | ✅ (mock or live; no evals) |
| SemVer for prompts               |    ❌     |    ❌     |    ❌     |       ✅       |
| AI-powered linter                |    ❌     |    ❌     |    ❌     | ✅ (one live run; quality not measured) |
| Multi-provider fallback          |  Partial  |    ❌     |    ❌     | ✅ (per-provider model map) |
| Compile to TypeScript **and** Python | ❌     |    ❌     |    ❌     |       ✅       |
| Static analysis (SonarQube-style)|    ❌     |    ❌     |    ❌     |       ✅       |
| Open source, zero SaaS           |    ✅     |    ❌     |    ❌     |       ✅       |

---

## Installation

```bash
npm install @promptlang/core
```

The library (`@promptlang/core`: tokenize, parse, compile, analyze) and the runtime
(`@promptlang/core/runtime`: the provider clients the generated code calls) are ESM
for Node ≥ 20 and Bun. The `promptlang` CLI needs Bun ≥ 1.2.20. CI installs the
packed tarball into an empty project, imports both entry points from Node, runs
this quick example with the installed CLI and type-checks the generated code against
the installed declarations (`scripts/consumer-test.ts`). No version of
`@promptlang/core` is on npm before 2.0.0.

To work on PromptLang itself, one command from a fresh clone to the example tests
passing (CI runs it on every pull request, `fresh-clone` job):

<!-- fresh-clone:start -->
```bash
git clone https://github.com/matteogallo-ai/promptlang.git && cd promptlang && bun install --frozen-lockfile && bun run cli test docs/examples
```
<!-- fresh-clone:end -->

---

## Tests

`test` blocks run with `promptlang test <files or directories>`:

```promptlang
test "extracts the total" {
  input: extract_invoice(pdf_text: "Total due: 1,250.00 EUR")
  mock: """{"amount": 1250, "currency": "EUR", "invoice_date": "2026-08-11", "vendor": "Acme"}"""
  expect.amount: 1250
  expect.currency matches: "^[A-Z]{3}$"
  expect.vendor contains: "Acme"
  expect schema
}
```

- **Assertions**: `expect: v` and `expect.field: v` (equality), `contains: "s"`,
  `matches: "regex"`, and `expect schema` (the output conforms to the declared
  type: enum members, required fields, field types, no undeclared fields).
- **Mock mode (default)**: each test's `mock:` response goes through the generated
  TypeScript, so request building and output parsing are what is tested. It does
  not measure the model: the mock is written by hand. A test without `mock:` fails
  in this mode.
- **Live mode** (`--live`, Anthropic models, `ANTHROPIC_API_KEY`): prints a cost
  estimate (every call at its full `max_tokens`, input approximated at 3 characters
  per token, chain steps charged with earlier steps' outputs, no retries: the client
  makes none) and asks before calling;
  `--yes` approves without asking. Models without a recorded price are refused.
- `--json` for tools; exit 0 when every test passes, 1 on a failure, 2 on usage errors,
  3 when a call failed and left a test without a verdict. The report says which
  kind: a **configuration error** (authentication, a rejected request, an unknown
  model: fix the file or the key) or a **provider failure** (timeout, network, rate
  limit, server overload, malformed response: retry later).
- A test whose `input` calls a prompt or chain that the file does not declare is a
  compile error, in `compile` and in `test`. `eval` blocks are parsed, and `compile`
  and `test` warn that they are not executed.

---

## Versioning

- `@version` must be SemVer 2.0.0 (`1.4.0`, `2.0.0-rc.1`); anything else is a parse error.
- `import "./sentiment.prompt" as S requires "^1.0.0"`: `install` and `check` fail
  with `VersionMismatchError` when the imported file's `@version` is outside the range.
- `promptlang semver-check [--base <ref>]` compares each `.prompt` file with its version
  at a Git ref (default `origin/main`, else the latest tag). Removing or retyping a
  parameter, adding a required one, changing the output type or the `@model` requires a
  major bump; optional additions a minor; text-only changes a patch. CI runs it on
  `docs/examples`. Full rules: [`docs/syntax-reference.md`](docs/syntax-reference.md) Section 6.

`bun run demo` plays the whole story in a temporary Git repository: an incompatible
change released as 1.1.0 is rejected, 2.0.0 passes, a consumer pinned to `^1.0.0`
fails cleanly, and the tests still pass ([`docs/examples/demo/`](docs/examples/demo/)).

---

## AI-Powered Linting

PromptLang can send each prompt to an LLM for a semantic review at build time.
It looks for six kinds of defect that static rules cannot see:

- Vague instructions like "be careful" that don't tell the model what to do
- Missing format specs where structured output is expected but not constrained
- Conflicting instructions ("one-sentence summary" + "detailed key points")
- Undefined business terms ("premium user" without a definition)
- Hallucination risks (invitations to guess vs. refuse)
- Token inefficiencies (verbose phrasing that could be shorter)

**Measured on a labelled corpus** (`evals/linter/`, 120 cases;
[`docs/SYSTEM_CARD.md`](docs/SYSTEM_CARD.md)), on the test split with
`claude-haiku-5-5`: it finds almost every designed defect (recall 44/45 and
45/45 over two runs) but reports about four categories per prompt, so most of
its findings are false alarms (precision 20%, 95% CI 15–26%) and it flags every
clean prompt (15/15). Read its findings as leads to check, not as defects; the
six static rules of `promptlang analyze` do not depend on the model.

### Usage

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run cli analyze docs/examples/ --ai
```

The AI linter runs in parallel (3 prompts at a time by default) and returns
confidence-scored issues alongside the static analysis output.

### Cost

`--ai` prints a cost estimate for your files and asks before any call; `--yes`
approves without asking.

Each analyzed prompt is one request to Claude Haiku 5.5 (by default) with
`max_tokens: 4096`, which leaves room for its adaptive thinking. At list prices
($0.10 / $0.50 per million input / output tokens, prompts up to 100K tokens) the
three example files (four prompts) cost about $0.01 if every call used its full
`max_tokens`. This is an estimate from request sizes, not a measurement. The
committed live run (five prompts) used 5,557 input and 6,517 output tokens:
$0.0038. Costs are yours — bring your own API key.

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

Requires Python 3.11+ (generated files import `typing.NotRequired`) and `httpx` for real API calls (`pip install httpx`).
`promptlang_runtime.py` checks what the TypeScript runtime checks on a response: an
empty key is refused, HTTP errors raise `AuthenticationError`, `RateLimitError`,
`InvalidRequestError` or `ServerError`, and a malformed response raises
`InvalidResponseError` (all subclasses of `PromptClientError`). It sends Anthropic API
version 2026-10-21, without `temperature`. Unlike the TypeScript runtime, it does not
retry, and a timeout or a connection failure raises `httpx`'s own exception.
The `MockClient` works with no dependencies for local testing.

---

## Project configuration

For multi-file projects, create a `promptlang.yaml` at the project root:

```yaml
name: my-project
version: 1.0.0
defaults:
  model: claude-opus-5-5
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

The compiled TypeScript imports `PromptClient` from `@promptlang/core/runtime`. Three
provider clients ship with PromptLang — pick the one that matches your stack.

### Anthropic

```typescript
import { AnthropicClient } from "@promptlang/core/runtime";
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
import { OpenAIClient } from "@promptlang/core/runtime";
import { classify_ticket } from "./generated/classify-ticket";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY!,
  // organization: "org-abc123",   // optional
});

const category = await classify_ticket({ ticket: "..." }, client);
```

### Ollama (local)

```typescript
import { OllamaClient } from "@promptlang/core/runtime";
import { classify_ticket } from "./generated/classify-ticket";

// No API key required — Ollama runs locally.
const client = new OllamaClient({
  baseURL: "http://localhost:11434", // default
});

const category = await classify_ticket({ ticket: "..." }, client);
```

### Routing (fallback across providers)

The generated code puts the file's `@model` in every request. Give each provider
that uses other names a `modelMap` from that model to its own; a provider whose map
has no entry for the requested model is skipped rather than sent a name it cannot
serve. An `AuthenticationError` stops the routing at once.

```typescript
import { AnthropicClient, OpenAIClient, RoutingClient } from "@promptlang/core/runtime";
import { classify_ticket } from "./generated/classify-ticket";

const client = new RoutingClient({
  primary: new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY! }),
  fallbacks: [
    {
      client: new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY! }),
      modelMap: { "claude-opus-5-5": "gpt-5" },
    },
  ],
  onFallback: (err, i) => console.warn(`Fallback #${i}:`, err.message),
});

const category = await classify_ticket({ ticket: "..." }, client);
```

---

## Compiling against a checkout

The generated TypeScript imports `@promptlang/core/runtime`. With the package
installed that resolves through its `exports`. To compile against a local checkout
instead, pass `--emit-tsconfig`: it writes a `tsconfig.json` whose `paths` mapping
points at the checkout's runtime source.

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
| [docs/RELEASING.md](docs/RELEASING.md)                | How a tag becomes an npm release, and its setup    |
| [docs/release-notes/](docs/release-notes/)            | Notes for each release                             |
| [docs/examples/](docs/examples/)                      | Annotated `.prompt` examples                       |

---

## Packages

PromptLang is developed as a Bun workspace. The main package,
`@promptlang/core` (the CLI binary is `promptlang`), lives in `src/`. First-party companion packages live under
`packages/` and are published under the `@promptlang/` scope on npm.

| Package | Location | Version | Description |
| --- | --- | --- | --- |
| [`@promptlang/yaml-parser`](https://www.npmjs.com/package/@promptlang/yaml-parser) | `packages/yaml-parser/` | 1.0.0 (on npm since PromptLang v1.2.0) | Zero-dependency minimal YAML parser. Extracted from PromptLang core in v1.1.0 so sibling projects (like [Praxis](https://github.com/matteogallo-ai/praxis)) can reuse it via `bun add @promptlang/yaml-parser`. |

Each package has its own `README.md`, `CHANGELOG.md`, and independent
SemVer track.

---

## Roadmap

In progress:

- **npm publication** of `@promptlang/core`

Not scheduled:

- `eval` execution (datasets, metrics, thresholds)
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
do not parse. Both headline features were then implemented, with the scope stated
in the [Tests](#tests) and [Versioning](#versioning) sections.

What changed in response:

- every README capability is now listed in [`docs/CLAIMS.md`](docs/CLAIMS.md)
  with its test, and CI (`claims`) fails if the README shows an unshipped one as ✅;
- CI (`stale-narrative`) rejects forward-looking release talk and untracked TODOs in code and docs;
- Biome and knip run in CI; dead code they reported was removed;
- the package is `@promptlang/core` and its entry point exports the compiler API;
- the rules followed for every change are in
  [`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md).

What the maintainer does:

I design the specifications and acceptance criteria. A coding agent implements; an independent reviewer agent and a separate orchestrating model audit every delivery against written standards (docs/ENGINEERING_STANDARDS.md). I make the calls, and since November 2026 nothing merges until I pass a comprehension check on the changed code.

Design decisions are recorded in [`docs/adr/`](docs/adr/).

### What I'd do differently

- **Write the claims table first.** The audit found headline features marked ✅
  with no code behind them. A README line backed by a named test from the start
  (`docs/CLAIMS.md`) would have made that impossible instead of caught late.
- **Small commits from the first day.** Up to v1.2.0 each milestone is one large
  commit, which nobody can review; the 400-line limit came after.
- **Measure the model-backed feature before calling it a feature.** The AI linter
  shipped tested on fake clients, with one live run on five prompts and no measure
  of its findings; a labelled corpus with precision,
  recall and intervals (`evals/linter/`) is what says whether it works.
- **Put a cap in code before the first paid call,** not an estimate and a promise
  ([ADR 0004](docs/adr/0004-spending-cap.md)).
- **Require a comprehension check from the start.** Code I did not write and
  cannot explain is code I cannot maintain.

---

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup,
coding standards, and the PR checklist. If you're unsure where to start, look for
issues tagged `good first issue`.

---

## License

MIT © Matteo Gallo — see [LICENSE](LICENSE).
