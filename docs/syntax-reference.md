# Syntax Reference

Complete reference for the PromptLang DSL. This document describes the syntax as
it will exist at v1.0. Sections that are not yet implemented are marked with their
target milestone.

---

## Section 1 — File Metadata (Directives)

Every `.prompt` file begins with zero or more directives. Directives start with `@`
and configure file-level metadata. They must appear before any type or prompt
declarations.

```promptlang
@version "1.0.0"
@model claude-opus-4.7
@temperature 0.3
@max_tokens 512
@description "Classifies support tickets into predefined categories"
```

| Directive        | Type             | Required | Description                                            |
| ---------------- | ---------------- | -------- | ------------------------------------------------------ |
| `@version`       | semver string    | Yes      | File version. Used for compatibility checks in chains. |
| `@model`         | identifier       | No       | Default model for all prompts in this file.            |
| `@temperature`   | float 0.0–2.0    | No       | Sampling temperature. Default: provider default.       |
| `@max_tokens`    | integer          | No       | Maximum output tokens.                                 |
| `@description`   | string           | No       | Human-readable description for tooling and registries. |

**`@version` and semver compatibility**

When a prompt is referenced in a `chain`, the compiler checks that the `@version`
of the dependency satisfies the version range declared by the caller. This follows
npm-style semver semantics.

**Per-prompt model override**

The `@model` directive at file level is the default. Individual `prompt` blocks can
override it:

```promptlang
@model claude-opus-4.7     // file default

prompt fast_check(text: string) -> boolean {
  @model claude-haiku-4.5  // override for this prompt only
  user: "Is this text appropriate? Answer true or false.\n{{text}}"
  output: boolean
}
```

---

## Section 2 — Types

### Primitive types

| Type      | Description               | Example value     |
| --------- | ------------------------- | ----------------- |
| `string`  | UTF-8 text                | `"hello"`         |
| `number`  | IEEE 754 double           | `42`, `3.14`      |
| `boolean` | true / false              | `true`            |

### Enum types

```promptlang
type Sentiment = enum { positive, neutral, negative }

type Priority = enum { low, medium, high, critical }
```

Enum members are lowercase identifiers. The compiled TypeScript output uses a union
of string literals:

```typescript
type Sentiment = "positive" | "neutral" | "negative";
```

### Struct types

```promptlang
type Address = struct {
  street: string
  city: string
  country: string
  postal_code: string
}

type ExtractedInvoice = struct {
  amount: number
  currency: string
  invoice_date: string
  vendor: string
  line_items: string[]
}
```

Struct fields can be any type including other structs and arrays. Fields are separated
by newlines (commas are optional).

### Array types

```promptlang
type Keywords = string[]

type Contacts = struct {
  name: string
}[]
```

### Optional fields

```promptlang
type ParsedEmail = struct {
  subject: string
  body: string
  reply_to?: string   // optional: may be absent in output
}
```

Optional fields use the `?` suffix. The compiler emits `string | undefined` in
TypeScript and `Optional[str]` in Python.

### Type aliases

```promptlang
type TicketId = string
type Confidence = number   // expected range: 0.0–1.0
```

Simple aliases do not create new types in the compiled output — they are expanded
inline. Useful for documentation.

---

## Section 3 — Prompt Declarations

### Basic form

```promptlang
prompt <name>(<params>) -> <output-type> {
  system: """..."""
  user: "..."
  output: <output-type>
}
```

### Parameters

```promptlang
prompt summarize(text: string, max_words: number) -> string {
  system: "You are a concise summarizer."
  user: "Summarize in {{max_words}} words or fewer:\n\n{{text}}"
  output: string
}
```

Parameters are referenced in template strings with `{{name}}`. The compiler
validates that every `{{...}}` interpolation matches a declared parameter name.

### Template strings

PromptLang supports three string forms:

```promptlang
// Single-line
user: "Classify: {{ticket}}"

// Double-quoted multiline (escape sequences apply)
user: "First line\nSecond line with {{variable}}"

// Triple-quoted (raw, preserves whitespace, no escape processing except {{...}})
user: """
  Analyze the following document carefully.

  Document:
  ---
  {{document}}
  ---

  Return your analysis in JSON.
"""
```

Triple-quoted strings trim leading indentation relative to the opening `"""` to
avoid unintended indentation in the prompt.

### Output declaration

The `output:` field tells the compiler which type to parse the model response into.
For primitive types, the compiler generates direct coercion. For enums and structs,
it generates a parser that validates the model's JSON output against the type schema.

```promptlang
prompt extract(text: string) -> Invoice {
  system: "Extract invoice data. Respond with valid JSON only."
  user: "{{text}}"
  output: Invoice   // compiler generates JSON → Invoice parser
}
```

### Per-prompt model directives

```promptlang
prompt fast_triage(ticket: string) -> Priority {
  @model claude-haiku-4.5
  @temperature 0.1
  system: "You are a ticket triager. Respond with one priority level."
  user: "{{ticket}}"
  output: Priority
}
```

---

## Section 4 — Chains (Prompt DAG)

_Available from v0.5_

A `chain` composes multiple prompts into a directed acyclic graph. The compiler
validates that output types flow correctly between steps.

```promptlang
chain summarize_and_classify(raw_text: string) -> Category {
  step summary = summarize(text: raw_text, max_words: 100)
  step category = classify_ticket(ticket: summary)
  return category
}
```

**Compiled TypeScript output:**

```typescript
export async function summarizeAndClassify(rawText: string): Promise<Category> {
  const summary = await summarize(rawText, 100);
  const category = await classifyTicket(summary);
  return category;
}
```

### Parallel steps

Steps that do not depend on each other can be declared parallel:

```promptlang
chain analyze(document: string) -> AnalysisResult {
  parallel {
    step sentiment = classify_sentiment(text: document)
    step topics = extract_topics(text: document)
    step entities = extract_entities(text: document)
  }
  step result = combine_analysis(
    sentiment: sentiment,
    topics: topics,
    entities: entities
  )
  return result
}
```

The compiler emits `Promise.all()` for parallel steps in TypeScript.

### Cross-file composition

```promptlang
@version "1.0.0"
import { classify_ticket } from "./classify-ticket.prompt"
import { extract_entities } from "./extract-entities.prompt"

chain enrich_ticket(raw: string) -> EnrichedTicket {
  step category = classify_ticket(ticket: raw)
  step entities = extract_entities(text: raw)
  step result = merge_ticket_data(
    raw_text: raw,
    category: category,
    entities: entities
  )
  return result
}
```

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
