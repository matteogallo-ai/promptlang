# PromptLang

**A typed language for LLM prompts.**

Write your LLM prompts as typed, first-class code and compile them to
TypeScript or Python. Bring your own API key. No third-party runtime dependencies.

![`bun run demo`: semver-check catches an incompatible change released as a minor, passes it as 2.0.0, a consumer pinned to ^1.0.0 then fails cleanly, and the prompt tests pass on mock responses](docs/media/demo.gif)

<sub>`bun run demo`, recorded as it runs ([`docs/media/demo.tape`](docs/media/demo.tape)).</sub>

[![@promptlang/core](https://img.shields.io/npm/v/@promptlang/core.svg?label=%40promptlang%2Fcore)](https://www.npmjs.com/package/@promptlang/core)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/matteogallo-ai/promptlang/badge)](https://scorecard.dev/viewer/?uri=github.com/matteogallo-ai/promptlang)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)
[![Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![CI](https://github.com/matteogallo-ai/promptlang/actions/workflows/ci.yml/badge.svg)](https://github.com/matteogallo-ai/promptlang/actions)
[![@promptlang/yaml-parser](https://img.shields.io/npm/v/@promptlang/yaml-parser.svg?label=%40promptlang%2Fyaml-parser)](https://www.npmjs.com/package/@promptlang/yaml-parser)

---

## Why PromptLang

LLM prompts usually live as untyped strings in application code, with no tests and
no versions. PromptLang treats them as typed code:

- **Typed I/O**: typed inputs and outputs; generated TypeScript and Python check each answer against its declared type
- **Compile to TypeScript and Python** from the same source
- **Static analysis (SonarQube-style)**: six deterministic rules, from prompt-injection risk to token cost
- **Native tests**: `promptlang test` runs `test` blocks on recorded `mock:` responses, or on the provider with `--live`
- **SemVer for prompts**: `semver-check` fails when a prompt's interface changed more than its `@version` says
- **Multi-provider runtime** (Anthropic, OpenAI, Ollama, or your own client)
- **Multi-provider fallback**: `RoutingClient` tries providers in order, with a model map per provider
- **AI-powered linter**: a reviewer aid, not a gate: its findings beat chance (p ≈ 6e-10) but it flags every clean prompt ([`docs/ai-linter.md`](docs/ai-linter.md))
- **No third-party runtime dependencies**: Bun or Node, `fetch` and your own API keys

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

Test it, then compile it (the `promptlang` CLI runs on Bun ≥ 1.2.20). Name the scoped
package: the unscoped `promptlang` package on npm is not this project.

```bash
npx @promptlang/core test classify-ticket.prompt
```

```bash
npx @promptlang/core compile classify-ticket.prompt --out ./generated
```

Use it from Bun (`bun use.ts`). The generated files are TypeScript source, and
Node does not run them as they are (`ERR_UNKNOWN_FILE_EXTENSION` before Node 22.18,
`ERR_MODULE_NOT_FOUND` from 22.18): under Node, transpile them first. The library
and the runtime themselves run on Node ≥ 20.

```typescript
import { classify_ticket } from "./generated/classify-ticket";
import { AnthropicClient } from "@promptlang/core/runtime";

const client = new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY! });
const category = await classify_ticket({ ticket: "..." }, client);
```

### Delimited values

Generated TypeScript and Python rewrite a string inserted between delimiters, the
same way byte for byte, with the pairs `prompt-injection-risk` recognises around
its placeholder, so that the value cannot close or reopen them:

- `<name>` … `</name>` (and `<BEGIN>`/`<END>`): a `<` that starts `<name` or `</name`, in any ASCII
  case and with ASCII whitespace around the `/`, becomes `&lt;` (`</TICKET>` → `&lt;/TICKET>`); `<tickets>`
  is left alone.
- `[[` … `]]`: `[[` becomes `[ [`, `]]` becomes `] ]`.
- A code fence: a run of three or more backticks gets a space between each.
- `---` lines: a line of three or more dashes, spaced or not (`- - -` is the same
  Markdown rule), gets a `\` before its first dash.

The ends of a value are rewritten too, since it can sit next to another value or
to the template's own text: a trailing `<` that could still grow into `<name` or
`</name` becomes `&lt;`; a `[`, `]` or run of backticks at either end gets a space
on its outer side, the backticks spaced as well; a first or last line made only
of dashes gets the `\`.

- **Scope.** These exact forms, for text: strings, and JSON-typed values once
  serialized. A number or a boolean is formatted by each language (`true` /
  `True`).
- **Known limit.** Unicode look-alikes (`＜/ticket>`) and the template's own text
  are not rewritten. A `<` written in the template right before a placeholder
  (`<{{email}}>`) lets a value starting with `/ticket>` close the tag:
  `prompt-injection-risk` warns about it. How well a model respects delimiters is
  not measured.
- **Next step.** An adversarial eval against a live model (paid, not run).

---

## Comparison

Each cell is checked against [`docs/CLAIMS.md`](docs/CLAIMS.md) by the `claims` CI job.
Other tools are not scored: nothing here tests them. One prompt written in both
PromptLang and BAML, each difference sourced: [docs/comparison-baml.md](docs/comparison-baml.md).

| Feature                              | PromptLang |
| ------------------------------------ | :--------: |
| Typed I/O                            | ✅ |
| Native tests                         | ✅ (mock or live; no evals) |
| SemVer for prompts                   | ✅ |
| AI-powered linter                    | ✅ (reviewer aid, not a gate; precision ~30% human-reviewed, 18–45%) |
| Multi-provider fallback              | ✅ (per-provider model map) |
| Compile to TypeScript **and** Python | ✅ |
| Static analysis (SonarQube-style)    | ✅ |
| Open source, zero SaaS               | ✅ |

---

## Installation

```bash
npm install @promptlang/core
```

The library and the runtime (`@promptlang/core/runtime`) are ESM for Node ≥ 20 and
Bun; the `promptlang` CLI needs Bun ≥ 1.2.20. CI installs the packed tarball in an
empty project and runs the quick example with it (`scripts/consumer-test.ts`). The
only version on npm before 2.0.0, `0.0.0-stage`, is an empty placeholder (two files,
no code) published while publishing was set up; it is not a release.

From a fresh clone to the example tests passing (CI job `fresh-clone`):

<!-- fresh-clone:start -->
```bash
git clone https://github.com/matteogallo-ai/promptlang.git && cd promptlang && bun install --frozen-lockfile && bun run cli test docs/examples
```
<!-- fresh-clone:end -->

---

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/usage.md](docs/usage.md) | Tests, versioning, the Python target, `promptlang.yaml`, provider clients and routing |
| [docs/ai-linter.md](docs/ai-linter.md) | The AI linter: what it looks for, its measured precision, cost |
| [docs/syntax-reference.md](docs/syntax-reference.md) | The `.prompt` language |
| [docs/architecture.md](docs/architecture.md) | Pipeline and design decisions; ADRs in [docs/adr/](docs/adr/) |
| [docs/CLAIMS.md](docs/CLAIMS.md) | Every advertised capability → module → test → status |
| [docs/SYSTEM_CARD.md](docs/SYSTEM_CARD.md) | Intended use, measured performance, known limits |
| [docs/migration-guide.md](docs/migration-guide.md) | Upgrading from 2.x to 3.0.0 |
| [docs/how-this-was-built.md](docs/how-this-was-built.md) | History, audits, and what I'd do differently |
| [docs/roadmap.md](docs/roadmap.md) | What is not scheduled: `eval` execution, a remote registry, streaming |
| [docs/RELEASING.md](docs/RELEASING.md), [docs/release-notes/](docs/release-notes/) | How a tag becomes an npm release; notes per release |

`@promptlang/yaml-parser` (`packages/yaml-parser/`, on npm) is the zero-dependency
YAML parser PromptLang uses, published on its own SemVer track.

---

## How this was built

Built with coding agents: I write the specs, review the pull requests and their tests, and answer for what gets merged. Details: [docs/how-this-was-built.md](docs/how-this-was-built.md).

Contributions: [CONTRIBUTING.md](CONTRIBUTING.md). MIT © Matteo Gallo, see [LICENSE](LICENSE).
