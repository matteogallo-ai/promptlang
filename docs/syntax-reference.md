# Syntax Reference

Reference for the `.prompt` language as the current parser and compilers implement
it. The formal grammar is [`src/parser/grammar.md`](../src/parser/grammar.md). Forms
that parse but have no effect are marked **parsed only**; capabilities that do
not exist are listed at the end, so nothing below describes behaviour the code does
not have.

---

## Section 1 — File layout

A file is, in order: `import` lines, metadata directives, then declarations
(`type`, `prompt`, `chain`, `test`, `eval`). Comments are `// line` and
`/* block */`. A file with no declarations (imports and metadata alone) is
rejected by `promptlang compile`, because neither compiler emits code for imports.

```promptlang
import "shared/categories.prompt" as Categories

@version "1.0.0"
@model claude-haiku-4-5
@temperature 0.3
@max_tokens 512
@description "Classifies support tickets"
```

### Directives

| Directive | Value | Effect today |
| --- | --- | --- |
| `@version` | string | Copied into the generated `<prompt>_meta.version`. Optional; **not validated** as SemVer. |
| `@model` | identifier (may contain `-` and `.`) | Model name sent in every request from this file. Without it the generated code sends `model: ""`. |
| `@temperature` | number | Copied into each request. No range check. Anthropic rejects a non-default `temperature` on Claude 4.7 and later (HTTP 400), so omit it for those models. |
| `@max_tokens` | number | Copied into each request. |
| `@description` | string | Kept in the AST; not emitted. |
| `@breaking_changes` | string | **Parsed only.** |
| `@migration_from` | two strings | **Parsed only.** |

Directives apply to the whole file; there is no per-prompt override.

### Imports

```promptlang
import "shared/x.prompt" as Alias
```

The path is a plain string (no `{{…}}`). It is resolved relative to the importing
file first, then against each `sources[].path` in `promptlang.yaml`. Imports feed
`promptlang install` / `check` (dependency graph, cycle detection, integrity
hashes). A chain cannot call an imported prompt: `Alias.name(...)` does not
parse.

---

## Section 2 — Types

| Form | Example | TypeScript | Python |
| --- | --- | --- | --- |
| Primitive | `string`, `number`, `boolean`, `date` | `string`, `number`, `boolean`, `string` | `str`, `float`, `bool`, `str` |
| Enum | `enum { bug, question }` | string-literal union | `Literal[...]` |
| Struct | `struct { name: string, reply_to?: string }` | `interface` with `reply_to?: string` | `TypedDict` with `NotRequired[str]` |
| Named type | `type TicketId = string` | `export type TicketId = string;` | `TicketId = str` |

```promptlang
type Category = enum { bug, feature_request, question, other }

type Ticket = struct {
  subject: string,
  body: string,
  reply_to?: string,
}
```

Array types (`string[]`) are not supported.

---

## Section 3 — Prompts

```promptlang
prompt classify_ticket(ticket: string) -> Category {
  system: """
    You are a support ticket classifier.
    Respond with exactly one category name.
  """
  user: "Classify this ticket:\n---\n{{ticket}}\n---"
  output: Category
}
```

- Parameters are `name: Type`, comma-separated.
- Sections: `system:`, `user:`, `assistant:` (each a string) and `output:` (a type).
  Messages are sent in the order written.
- Strings are `"double-quoted"` (with `\n`, `\"` escapes) or `"""triple-quoted"""`.
  Triple-quoted content is sent as written, indentation included.
- `{{name}}` interpolates a parameter. The static rule `unbounded-template` warns when
  `name` is not a declared parameter.

### Generated output handling

| Output type | Generated code does |
| --- | --- |
| `string` | returns the trimmed response text |
| `number` | `Number(raw)`; throws if the result is `NaN` |
| `boolean` | accepts `true` / `false` (case-insensitive); throws otherwise |
| enum | throws unless the trimmed text is one of the members |
| struct | `JSON.parse` (`json.loads` in Python) and a cast; field types are **not** validated |

---

## Section 4 — Chains

```promptlang
chain summarize_and_translate(document: string, target_language: Language) -> string {
  step english_summary = summarize(document: document, max_words: 100)
  step translated = translate(text: english_summary, target_language: target_language)
  return translated
}
```

- A chain is one or more `step name = call(...)` lines and a final `return`.
- A step calls a prompt (or chain) **declared in the same file**, with named
  (`key: value`) or positional arguments. Arguments may be chain parameters, earlier
  step names, `step.field` member access, or literals.
- The compiler rejects a reference to an undefined variable or to a step declared
  later. It does not check that a called prompt exists in the file, and it does not
  check argument types between steps (on the TypeScript target, `tsc` does).
- Not supported: `parallel { }` blocks, calls to imported prompts.

---

## Section 5 — Tests and evals (parsed only)

Both blocks are parsed and kept in the AST. **No command executes them**, and both
compilers ignore them. The static rule `missing-tests` uses `test` blocks to decide
whether a prompt has tests.

```promptlang
test "classifies bug reports" {
  input: classify_ticket(ticket: "The app crashes on login")
  expect: bug
}

test "extracts the total" {
  input: extract_invoice(document: "Total: 120 EUR")
  expect.total: 120
}

eval "classification accuracy" {
  dataset: "./data/tickets.jsonl"
  prompt: classify_ticket
  metric: accuracy
  threshold: 0.9
}
```

`expect:` and `expect.<field>:` take a literal (string, number, `true`/`false`) or an
identifier. Comparison operators and regular expressions are not part of the syntax.
An `eval` block has exactly the four fields shown, in that order.

---

## Section 6 — Versioning

`@version` is stored as a string and copied into the generated metadata. There is no
SemVer validation, no version constraint on imports and no breaking-change check.
This is the "SemVer for prompts" item in [`roadmap.md`](roadmap.md).

---

## Section 7 — Static analysis

`promptlang analyze <file|dir>` runs six deterministic rules (`--json` for machine
output, `--strict` to exit 1 on warnings):

| Rule | Severity | Reports |
| --- | --- | --- |
| `missing-tests` | warning | a prompt with no `test` block calling it |
| `unbounded-template` | warning | `{{var}}` where `var` is not a parameter |
| `prompt-injection-risk` | warning | a `user` section that interpolates a variable and contains no delimiter (`---`, triple backticks, `<tag>`, `<BEGIN>`/`<END>`, `[[ ]]`) |
| `token-cost-estimate` | info | a prompt whose static text is estimated above 500 tokens |
| `chain-complexity` | info | a chain with more than 5 steps |
| `duplicate-prompts` | warning | the same prompt name declared in several files |

`analyze --ai` additionally sends each prompt to Claude (default `claude-haiku-4-5`,
key from `ANTHROPIC_API_KEY`). Its plumbing is tested with a mocked client only; see
[`CLAIMS.md`](CLAIMS.md). There are no suppression comments and no custom-rule API.

---

## Section 8 — Project configuration (`promptlang.yaml`)

```yaml
name: my-project
version: 1.0.0
description: Support tooling prompts
defaults:
  model: claude-haiku-4-5
  temperature: 0.3
  max_tokens: 1024
sources:
  - path: ./prompts
compile:
  target: typescript       # or python
  out: ./generated
  emit_tsconfig: false
linter:
  ai:
    enabled: false
    model: claude-haiku-4-5
    concurrency: 3
dependencies:
  - name: shared-templates
    version: ^1.0.0
    path: ./vendor/shared-templates
```

`sources` and `compile` are used by `compile`, `install`, `list` and `check`.
`defaults` is validated but not read by the compiler (use `@model` and friends).
`dependencies[].version` is stored, not checked. The accepted YAML subset is in
[`yaml-support.md`](yaml-support.md).

---

## Section 9 — Compiled output

`promptlang compile <file|dir> --out <dir> [--target typescript|python]`. Any
other `--target` value (including `py` or `ts`) is an error and writes nothing.

### TypeScript (excerpt for `classify-ticket.prompt`)

```typescript
// AUTO-GENERATED by PromptLang v<version> — do not edit manually.
import type { PromptClient, PromptRequest } from "promptlang/runtime";

export type Category = "bug" | "feature_request" | "question" | "other";

export const classify_ticket_meta = {
  name: "classify_ticket",
  version: "1.0.0",
  model: "claude-opus-5-5",
} as const;

export interface ClassifyTicketInput {
  ticket: string;
}

export async function classify_ticket(
  input: ClassifyTicketInput,
  client: PromptClient
): Promise<Category> { /* builds the request, calls client.complete, validates the enum */ }
```

Plus an `index.ts` re-exporting every compiled file. `promptlang/runtime` resolves
only through a `paths` mapping (`--emit-tsconfig` writes one).

### Python (excerpt)

```python
from .promptlang_runtime import PromptClient, PromptRequest

Category = Literal["bug", "feature_request", "question", "other"]

class ClassifyTicketInput(TypedDict):
    ticket: str

async def classify_ticket(input: ClassifyTicketInput, client: PromptClient) -> Category: ...
```

Plus `__init__.py` and a generated `promptlang_runtime.py` (its HTTP clients need
`httpx`; `MockClient` needs nothing).

---

## Not supported

Array types · per-prompt directives · `parallel` steps · calls to imported prompts ·
type checking between chain steps · executing `test`/`eval` · comparison or regex
assertions · `@version` validation and import version constraints · rule suppression
comments · custom analyzer rules · model aliases in config · single-quoted strings.
