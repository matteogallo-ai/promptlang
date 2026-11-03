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
@model claude-haiku-5-5
@max_tokens 512
@description "Classifies support tickets"
```

### Directives

| Directive | Value | Effect today |
| --- | --- | --- |
| `@version` | string | Optional. Must be a SemVer 2.0.0 version (`1.0.0`, `2.1.0-rc.1`, `1.0.0+build.5`); anything else is a parse error at the string's line and column. Copied into the generated `<prompt>_meta.version`. |
| `@model` | identifier (may contain `-` and `.`) | Model name sent in every request from this file. Without it the generated code sends `model: ""`. |
| `@temperature` | number | Copied into each request. No range check. Sent to OpenAI and Ollama only: `AnthropicClient` uses API version 2026-10-21, which rejects `temperature` on every model, so the Anthropic client leaves it out. |
| `@max_tokens` | number | Copied into each request. |
| `@description` | string | Kept in the AST; not emitted. |
| `@breaking_changes` | string | **Parsed only.** |
| `@migration_from` | two strings | **Parsed only.** |

Directives apply to the whole file; there is no per-prompt override.

### Imports

```promptlang
import "shared/x.prompt" as Alias
import "shared/categories.prompt" as Categories requires "^1.2.0"
```

The path is a plain string (no `{{…}}`). It is resolved relative to the importing
file first, then against each `sources[].path` in `promptlang.yaml`. Imports feed
`promptlang install` / `check` (dependency graph, cycle detection, integrity
hashes). A chain cannot call an imported prompt: `Alias.name(...)` does not
parse.

#### Version constraints (`requires`)

`requires "<range>"` makes `install` and `check` fail with a
`VersionMismatchError` unless the imported file's `@version` satisfies the range:

```
prompts/app.prompt:1:1: import "./lib.prompt" requires "^1.0.0", got 2.0.0. Update the requires range, or import a version of the file that satisfies it.
```

An imported file with no `@version` never satisfies a range. A malformed range is
a parse error at the range string. Supported range syntax, every version written
in full as `MAJOR.MINOR.PATCH`:

| Range | Means |
| --- | --- |
| `1.2.3` or `=1.2.3` | exactly 1.2.3 |
| `^1.2.3` | `>=1.2.3 <2.0.0`; for `0.x`, `^0.2.3` is `>=0.2.3 <0.3.0` and `^0.0.3` is `>=0.0.3 <0.0.4` |
| `~1.2.3` | `>=1.2.3 <1.3.0` |
| `>`, `>=`, `<`, `<=` | the comparison, by SemVer precedence |
| `>=1.2.0 <2.0.0` | space-separated constraints must all hold |

A pre-release (`2.0.0-rc.1`) satisfies a range only if the range itself names a
pre-release of the same `MAJOR.MINOR.PATCH`. Not supported (parse error): `||`,
partial versions (`^1.2`), wildcards (`1.x`), hyphen ranges (`1.0.0 - 2.0.0`).

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

- Parameters are `name: Type`, comma-separated; `name?: Type` is optional. An
  omitted optional parameter is absent from the generated input type
  (`title?: string` / `NotRequired[str]`) and `{{name}}` renders as the empty string.
- Sections: `system:`, `user:`, `assistant:` (each a string) and `output:` (a type).
  Messages are sent in the order written.
- Strings are `"double-quoted"` (with `\n`, `\"` escapes) or `"""triple-quoted"""`.
  Triple-quoted content is sent as written, indentation included.
- `{{name}}` interpolates a parameter. The static rule `unbounded-template` warns when
  `name` is not a declared parameter. A parameter whose type is a struct declared in
  the same file (directly or through an alias) is inserted as compact JSON. Strings,
  booleans, `null` and nesting are the same text in TypeScript and Python; numbers
  are printed by each language (`3.0` in Python for a `float`, `3` in TypeScript).
  A parameter whose type comes from an imported file is inserted as the target
  language prints it.

### Generated output handling

The generated function passes the trimmed response text to `parseOutput`
(`parse_output` in Python) with a schema derived from the declared type, and raises
`InvalidOutputError` when the answer does not conform (in Python, a `ValueError`
subclass). Its `errors` list every mismatch as `path: problem`; its message names
them without quoting the answer, which is on `output`: values are described by
their kind, and fields the type does not declare are counted, not named. At most 10
errors are kept, each cut to 500 characters. Both languages apply the same rules and
produce the same messages, except at the edges: each strips the answer with its own
whitespace rule (`trim()`, `str.strip()`), which differ on a few control and format
characters.

| Output type | Accepted answer |
| --- | --- |
| `string` | any text |
| `number` | decimal notation (`42`, `-1.5e3`), finite; not `0x10` or `Infinity` |
| `boolean` | `true` / `false`, case-insensitive |
| enum | one of the members, exactly |
| `date` | a real calendar day as `YYYY-MM-DD` (`2024-02-30` is refused) |
| struct | JSON, one surrounding code fence allowed; every field checked at every depth, required fields present, no field the type does not declare |

A field whose type is imported from another file is not checked. Python follows a
recursive type to a few hundred levels and TypeScript to several thousand, less when
the call is already deep in the stack; an answer nested deeper is refused with `output: nested too deeply to check`.

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

## Section 5 — Tests and evals

`test` blocks are run by `promptlang test`; `eval` blocks are parsed only: no command
executes them, and `compile` and `test` print a warning for each one.

```promptlang
test "classifies bug reports" {
  input: classify_ticket(ticket: "The app crashes on login")
  mock: "bug"
  expect: bug
  expect schema
}

test "extracts the total" {
  input: extract_invoice(document: "Total: 120 EUR")
  mock: """{"total": 120, "currency": "EUR"}"""
  expect.total: 120
  expect.currency matches: "^[A-Z]{3}$"
  expect.currency contains: "EU"
}

eval "classification accuracy" {
  dataset: "./data/tickets.jsonl"
  prompt: classify_ticket
  metric: accuracy
  threshold: 0.9
}
```

### `test` blocks

- `input:` must call a prompt or chain declared in the same file, with positional
  or named arguments that are literals (string, number, `true`/`false`) or
  identifiers (passed as their name, for enum values). An unknown callee, an unknown
  or duplicated argument, a missing required parameter or too many positional
  arguments is a compile error at the call, raised by `compile` (both targets) and
  by `test`.
- `mock:` (optional) is the raw model response that mock mode replays. Every model
  call the test makes receives it, including each step of a chain.
- At least one assertion:

| Assertion | Passes when |
| --- | --- |
| `expect: v` / `expect.field: v` | the output (or its field) equals the literal; an identifier is compared as its name |
| `expect contains: "s"` / `expect.field contains: "s"` | the value is a string containing `s` |
| `expect matches: "re"` / `expect.field matches: "re"` | the value is a string matching the JavaScript regular expression; an invalid pattern is a parse error |
| `expect schema` | the whole output conforms to the declared output type: enum member, required fields present, field types (`date` as `YYYY-MM-DD`), no undeclared fields |

### `promptlang test <paths> [--json] [--live [--yes]]`

Each file is compiled to TypeScript and its generated functions are called, so the
request building and output parsing under test are the shipped ones. An error the
generated code raises (an enum value outside the type, malformed JSON) fails the test
with its message.

- **Mock mode** (default): no network. A test without `mock:` fails with a message
  saying so. Mock tests check the code path, not the model's answers.
- **Live mode** (`--live`): calls Anthropic with `ANTHROPIC_API_KEY`, using the file's
  `@model`, without retries. Before any call it prints an estimate per file (input ≈
  prompt and argument characters ÷ 3, plus, for a chain, every earlier step's full
  output; output = calls × `@max_tokens`, default 1024) priced
  from a table of Claude models, each call on the rate card its own prompt length
  selects (Claude Haiku 5.5 bills five times its rate for a prompt over 100K
  tokens), and asks for confirmation; `--yes` approves without
  asking and is required without a terminal. A model missing from the price table is
  refused. `mock:` is ignored.
- `--json` prints `{ ok, mode, usage, files: [{ file, error?, results }] }`.
- Exit codes: `0` every test passed, `1` a test failed or a file has an error, `3` a call
  failed (any `PromptClientError`) and left a test without a verdict, `2` usage
  error, missing key, unpriced model, or a declined estimate. On exit 3 each such test
  reads `configuration error` (authentication, a request the provider rejects such
  as a `@max_tokens` it refuses, an unknown model, or a call that would pass the
  approved estimate and is not sent: fix the file, the key or the approval) or
  `provider failure` (timeout, network, rate limit, server overload, malformed
  response: retry later); `--json` carries it as `providerError: { kind, message }`
  with `kind` `"configuration"` or `"provider"`.

An `eval` block has exactly the four fields shown, in that order.

---

## Section 6 — Versioning

`@version` is validated as SemVer 2.0.0 when the file is parsed, and imports can
constrain it with `requires` (Section 1).

`promptlang semver-check [paths] [--base <git-ref>] [--json]` compares each
`.prompt` file with its text at a Git ref (default `origin/main`, otherwise the
most recent tag) and fails when `@version` did not move by at least what the
changes require. The interface of a prompt or chain is its parameters (name, type,
optional or not), its output type, and, for a prompt, the file's `@model`.

| Change | Required bump |
| --- | --- |
| Required parameter added; parameter removed; parameter type changed; optional parameter made required | major |
| Output type changed, including an enum gaining or losing a value; output struct field removed, retyped, made optional or required; required output field added | major |
| `@model` changed; prompt or chain removed; prompt replaced by a chain of the same name | major |
| Optional parameter added; required parameter made optional; optional output field added; prompt or chain added | minor |
| Message text changed; `@temperature` or `@max_tokens` changed; chain steps changed | patch |
| Whitespace, comments, declaration order, parameter order | none |

Struct output fields are compared at any depth: adding an optional field to a
nested struct is minor and is reported with a dotted path (`inner.b`). Types are
compared by structure: renaming `type Category` to `type Kind` with the
same values is not a change. Below 1.0.0 the check reads bumps as `^` does: at
0.0.z every bump counts as breaking; at 0.y.z a minor bump (`0.2.x → 0.3.0`)
counts as breaking and a patch bump as compatible. A lower version fails. From a
pre-release, a later pre-release or the release itself (`2.0.0-rc.1 → 2.0.0-rc.2`)
satisfies any change. Build metadata alone is not a bump. A file absent at the base
is reported as `new` and passes; a file deleted since the base is not reported.

Exit codes: `0` every file is versioned correctly, `1` at least one file is not (or
does not parse), `2` usage or Git error. Rationale:
[ADR 0002](adr/0002-prompt-interface.md), [ADR 0003](adr/0003-semver-check.md).

```text
semver-check against main (c978b607e120)
  FAIL   prompts/a.prompt  1.0.0 → 1.1.0
         major bump required: a major change needs at least 2.0.0, got 1.1.0
         - major: p: parameter 'x' removed
```

---

## Section 7 — Static analysis

`promptlang analyze <file|dir>` runs six deterministic rules (`--json` for machine
output, `--strict` to exit 1 on warnings):

| Rule | Severity | Reports |
| --- | --- | --- |
| `missing-tests` | warning | a prompt with no `test` block calling it |
| `unbounded-template` | warning | `{{var}}` where `var` is not a parameter |
| `prompt-injection-risk` | warning | a message section of any role that inserts a text parameter (`string`, `date`, a struct with a text field, or a type the file does not declare) outside a delimiter pair enclosing it: `<tag>`…`</tag>`, `---` lines, a code fence, `<BEGIN>`/`<END>`, `[[ ]]`. Numbers, booleans and enums are not flagged: that relies on the caller's type checker, as nothing checks them at run time. A delimiter is not escaping: a value containing the closing delimiter still closes it. Not recognised as delimiters: HTML comments; an unclosed tag such as `<br>` is matched with a later `</br>` |
| `token-cost-estimate` | info | a prompt whose static text is estimated above 500 tokens |
| `chain-complexity` | info | a chain with more than 5 steps |
| `duplicate-prompts` | warning | the same prompt name declared in several files |

`analyze --ai` additionally sends each prompt to Claude (default `claude-haiku-5-5`,
key from `ANTHROPIC_API_KEY`). It first prints a cost estimate (one call per prompt,
each at its full `max_tokens`, no retries) and asks before calling; `--yes` approves
without asking, and without a terminal `--yes` is required. Declining exits 2 with
no call made; a missing key keeps the static results (exit as without `--ai`). Its plumbing is tested with a mocked client only; see
[`CLAIMS.md`](CLAIMS.md). There are no suppression comments and no custom-rule API.

---

## Section 8 — Project configuration (`promptlang.yaml`)

```yaml
name: my-project
version: 1.0.0
description: Support tooling prompts
defaults:
  model: claude-haiku-5-5
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
    model: claude-haiku-5-5
    concurrency: 3
dependencies:
  - name: shared-templates
    version: ^1.0.0
    path: ./vendor/shared-templates
```

`sources` and `compile` are used by `compile`, `install`, `list` and `check`.
`defaults` is validated but not read by the compiler (use `@model` and friends).
`linter` is validated but not read by `analyze`: `--ai` turns the AI linter on, and
it runs on `claude-haiku-5-5`, 3 prompts at a time.
`dependencies[].version` is stored, not checked. The accepted YAML subset is in
[`yaml-support.md`](yaml-support.md).

---

## Section 9 — Compiled output

`promptlang compile <file|dir> --out <dir> [--target typescript|python]`. Any
other `--target` value (including `py` or `ts`) is an error and writes nothing.

### TypeScript (excerpt for `classify-ticket.prompt`)

```typescript
// AUTO-GENERATED by PromptLang v<version> — do not edit manually.
import type { PromptClient, PromptRequest } from "@promptlang/core/runtime";

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

Plus an `index.ts` re-exporting every compiled file. `@promptlang/core/runtime` resolves
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
assertions · rule suppression
comments · custom analyzer rules · model aliases in config · single-quoted strings.
