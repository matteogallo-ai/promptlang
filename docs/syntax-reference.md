# Syntax Reference

Reference for the `.prompt` language as the current parser and compilers implement
it. The formal grammar is [`src/parser/grammar.md`](../src/parser/grammar.md). Forms
that parse but have no effect yet are marked **parsed only**; capabilities that do
not exist are listed at the end, so nothing below describes behaviour the code does
not have.

---

## Section 1 — File layout

A file is, in order: `import` lines, metadata directives, then declarations
(`type`, `prompt`, `chain`, `test`, `eval`). Comments are `// line` and
`/* block */`. A file with no declarations and no imports is rejected by
`promptlang compile`.

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
| `@temperature` | number | Copied into each request. No range check. |
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
hashes). A chain cannot call an imported prompt yet: `Alias.name(...)` does not
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

## Section 5 — Tests and Evals

_Available from v0.6_

### Test blocks

Test blocks live inside a `.prompt` file and run via `promptlang test` or `bun test`.

```promptlang
test "classifies bugs correctly" {
  input: classify_ticket("The submit button crashes on iOS 17")
  expect: bug
}

test "classifies feature requests correctly" {
  input: classify_ticket("Please add dark mode support")
  expect: feature_request
}
```

### Field-level assertions

For struct outputs:

```promptlang
test "extracts invoice amount" {
  input: extract_invoice("Invoice Total: 1,250 EUR\nDate: 2026-08-11\nVendor: Acme Corp")
  expect.amount: 1250
  expect.currency: "EUR"
  expect.vendor: "Acme Corp"
}
```

### Pattern matching assertions

```promptlang
test "summary is concise" {
  input: summarize(text: long_document, max_words: 50)
  expect.word_count: < 55        // numeric comparison
  expect: matches(/\.\s*$/)      // ends with a sentence
}
```

### Eval blocks (dataset-driven)

```promptlang
eval "ticket classification accuracy" {
  dataset: "./data/tickets.csv"   // columns: input, expected_category
  prompt: classify_ticket
  metrics: [accuracy, f1]
  threshold.accuracy: 0.90        // fail eval if accuracy < 90%
}
```

Run with: `promptlang eval classify-ticket.prompt`

---

## Section 6 — Versioning

_Available from v0.4_

Every `.prompt` file carries a `@version` directive using semver:

```promptlang
@version "2.1.0"
```

**Breaking change detection:**

When a prompt is imported in a chain, the compiler checks version compatibility.
Changing a parameter name or type is a breaking change (requires major version bump).
Adding an optional parameter is non-breaking (minor version bump).

```promptlang
// chain.prompt
import { classify_ticket } from "./classify-ticket.prompt" // requires ^1.0.0

// If classify-ticket.prompt @version is "2.0.0", compiler emits:
// Error: version mismatch — classify-ticket requires ^1.0.0, got 2.0.0
```

**Version metadata in compiled output:**

```typescript
// Generated by PromptLang v0.3 from classify-ticket.prompt@1.0.0
export const PROMPT_VERSION = "1.0.0";
```

---

## Section 7 — AI-Powered Linter

_Available from v0.7_

The linter runs as a separate pass after compilation. It does not block compilation
by default but can be configured to fail CI.

```bash
promptlang lint classify-ticket.prompt
promptlang lint classify-ticket.prompt --strict   # exit 1 on any warning
```

**Built-in rules:**

| Rule ID                    | Severity | Description                                      |
| -------------------------- | -------- | ------------------------------------------------ |
| `missing-system-prompt`    | warning  | Prompt has no `system:` field                    |
| `unconstrained-output`     | warning  | Output type is `string` with no format guidance  |
| `injection-risk`           | error    | User input interpolated directly in system prompt|
| `ambiguous-enum-labels`    | warning  | Enum members that models commonly confuse        |
| `overly-long-system-prompt`| info     | System prompt exceeds 1000 tokens                |
| `missing-version`          | error    | `@version` directive absent                      |

**Suppressing a rule:**

```promptlang
// @promptlang-disable injection-risk
system: "Classify: {{user_input}}"
```

**Custom rules** (plugin API, v0.7+):

```typescript
import { defineRule } from "promptlang/linter";

export default defineRule({
  id: "require-output-format",
  severity: "warning",
  check(node, context) {
    if (node.kind === "PromptDeclaration" && node.outputType.kind === "StringType") {
      context.report(node, "String output — add format instructions to system prompt");
    }
  },
});
```

---

## Section 8 — Configuration File

`promptlang.config.yaml` sits at the project root and configures global defaults,
provider credentials, and tooling behavior.

```yaml
version: "1"

providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
    default_model: claude-opus-4.7

  openai:
    api_key: ${OPENAI_API_KEY}
    default_model: gpt-4o

model_aliases:
  fast: anthropic/claude-haiku-4.5
  reasoning: openai/o3-mini
  default: anthropic/claude-opus-4.7

compile:
  default_target: typescript
  output_dir: ./generated

test:
  timeout_ms: 30000
  retry_on_failure: 2

linter:
  model: fast           # which alias to use for AI-powered rules
  rules:
    injection-risk: error
    missing-system-prompt: warning
    missing-version: error
```

**Model aliases** allow prompts to reference logical names (`fast`, `reasoning`)
that map to concrete provider/model pairs. This makes it easy to swap models across
an entire project by changing one line in the config.

---

## Section 9 — Compiled Output

### TypeScript

```promptlang
@version "1.0.0"
@model claude-opus-4.7
@temperature 0.3

type Category = enum { bug, feature_request, question, other }

prompt classify_ticket(ticket: string) -> Category {
  system: "You are a support ticket classifier. Respond with one category."
  user: "Classify: {{ticket}}"
  output: Category
}
```

Compiles to:

```typescript
// Generated by PromptLang v0.3 from classify-ticket.prompt@1.0.0
// Do not edit — regenerate with: promptlang compile classify-ticket.prompt

import { callLLM, parseEnum } from "promptlang/runtime";

export const PROMPT_VERSION = "1.0.0";

type Category = "bug" | "feature_request" | "question" | "other";

/**
 * @param ticket - string
 * @returns Promise<Category>
 * @promptlang classify-ticket.prompt@1.0.0
 */
export async function classifyTicket(ticket: string): Promise<Category> {
  const raw = await callLLM({
    model: "claude-opus-4.7",
    temperature: 0.3,
    system: "You are a support ticket classifier. Respond with one category.",
    user: `Classify: ${ticket}`,
  });
  return parseEnum(raw, ["bug", "feature_request", "question", "other"]);
}
```

### Python

```python
# Generated by PromptLang v0.8 from classify-ticket.prompt@1.0.0
# Do not edit — regenerate with: promptlang compile classify-ticket.prompt --target python

from typing import Literal
from promptlang.runtime import call_llm, parse_enum

PROMPT_VERSION = "1.0.0"

Category = Literal["bug", "feature_request", "question", "other"]


async def classify_ticket(ticket: str) -> Category:
    """
    :param ticket: str
    :returns: Category
    :promptlang: classify-ticket.prompt@1.0.0
    """
    raw = await call_llm(
        model="claude-opus-4.7",
        temperature=0.3,
        system="You are a support ticket classifier. Respond with one category.",
        user=f"Classify: {ticket}",
    )
    return parse_enum(raw, ["bug", "feature_request", "question", "other"])
```
