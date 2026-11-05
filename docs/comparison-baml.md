# PromptLang and BAML, side by side

The same prompt written in both languages, then what each one documents for typing,
targets, tests, versioning, linting and runtime. Each BAML cell quotes or links the BAML
documentation; each PromptLang cell links this repository. The table states what each
documentation says; it does not rank them.

**Which BAML.** The BAML documentation at docs.boundaryml.com describes BAML v0 and says
so on every page: "This site documents BAML v0, the legacy DSL. BAML v1 is a separate,
fully featured programming language in public beta." This page compares PromptLang with
BAML v0. BAML v1 is not covered. Pages read on 2026-11-05; the BAML example below was
compiled with `baml-cli generate` from `@boundaryml/baml` 0.226.3.

## The same prompt

PromptLang, the README example ([`README.md`](../README.md#quick-example)):

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

test "classifies bug reports correctly" {
  input: classify_ticket("The submit button crashes the app on iOS 17")
  mock: "bug"
  expect: bug
}
```

BAML v0:

```baml
enum Category {
  Bug
  FeatureRequest
  Question
  Other
}

function ClassifyTicket(ticket: string) -> Category {
  client "anthropic/claude-opus-5-5"
  prompt #"
    {{ _.role("system") }}
    You are a support ticket classifier.
    Respond with exactly one category, no explanation.

    {{ _.role("user") }}
    Classify the ticket between the <ticket> tags.
    <ticket>
    {{ ticket }}
    </ticket>

    {{ ctx.output_format }}
  "#
}

test ClassifiesBugReports {
  functions [ClassifyTicket]
  args {
    ticket "The submit button crashes the app on iOS 17"
  }
  @@assert({{ this == "Bug" }})
}
```

Two differences come from BAML's rules, not from a choice made here. The enum values
start with a capital letter: with `bug`, `baml-cli generate` 0.226.3 fails with "Invalid
name for `enum value`: Must start with an uppercase letter." The function name starts
with a capital letter too ("must start with a capital letter!",
[function](https://docs.boundaryml.com/ref/baml/function)). `{{ ctx.output_format }}`
"Automatically generates format instructions based on return type" (same page);
PromptLang adds no format instructions to the prompt text.

## What each documents

| | PromptLang | BAML v0 |
|---|---|---|
| **Typing** | Primitives (`string`, `number`, `boolean`, `date`), enums, structs with optional fields, named types. Arrays are not supported. [syntax-reference §2](syntax-reference.md#section-2--types) | "`string`, `int`, `float`, `bool`", arrays ("Denoted with `[]` suffix"), "`map`: Key-value pairs", literals, classes. [function](https://docs.boundaryml.com/ref/baml/function) |
| **Checking the answer** | The generated code checks the answer against the declared type, in TypeScript and Python. [CLAIMS: Answers checked against the declared type](CLAIMS.md) | "JSON parsing errors are automatically corrected"; "Type mismatches are detected and reported". [function](https://docs.boundaryml.com/ref/baml/function) |
| **Targets** | TypeScript and Python. [CLAIMS: Compile to TypeScript and Python](CLAIMS.md) | `output_type` values in the examples: `python/pydantic`, `python/pydantic/v1`, `typescript`, `typescript/react`, `ruby/sorbet`, `go`, `rest/openapi`. [generator](https://docs.boundaryml.com/ref/baml/generator) |
| **Tests** | `test` blocks run through the generated TypeScript; `mock:` responses by default, no network; `--live` calls Anthropic after a cost estimate and approval. Assertions: equality, `contains`, `matches`, `schema`. [CLAIMS: Native tests](CLAIMS.md) | `test` blocks with `functions`, `args`, `@@assert` ("a hard guarantee") and `@@check`. [test](https://docs.boundaryml.com/ref/baml/test). Run from the playground or `baml-cli test`, which loads API keys from `.env` ("Set API keys for testing"). [baml-cli test](https://docs.boundaryml.com/ref/baml-cli/test). The pages read do not describe mocked responses. |
| **Versioning** | `@version` is SemVer 2.0.0; `import … requires "<range>"`; `semver-check` compares a file's interface with a Git base and requires the matching bump. [CLAIMS: SemVer for prompts](CLAIMS.md), [syntax-reference §6](syntax-reference.md#section-6--versioning) | The generator's `version` is the "Version of runtime to generate code for (should match the package @boundaryml/baml version)". [Upgrading BAML](https://docs.boundaryml.com/guide/development/upgrade-baml-versions). No page in the [documentation index](https://docs.boundaryml.com/llms.txt) covers versioning prompt files. |
| **Linting** | Six deterministic rules; an optional AI linter, a reviewer aid with 30% precision measured by a pre-registered human review (95% CI 18–45%). [CLAIMS: Static analysis, AI-powered linter](CLAIMS.md) | `baml-cli fmt` formats files; the page marks it "Beta Feature". [fmt](https://docs.boundaryml.com/ref/baml-cli/fmt). No linting page in the [documentation index](https://docs.boundaryml.com/llms.txt). |
| **Runtime** | Generated code calls a `PromptClient`: Anthropic, OpenAI, Ollama, and a routing client that falls back across providers. No third-party runtime dependencies. [CLAIMS: Multi-provider runtime, Multi-provider fallback, No third-party runtime dependencies](CLAIMS.md) | "the generated `baml_client` code is generated by your `baml_py` / `@boundaryml/baml` package dependency". [Upgrading BAML](https://docs.boundaryml.com/guide/development/upgrade-baml-versions). Clients with `fallback` ("if it fails, it will try the second client") and `retry_policy`. [fallback](https://docs.boundaryml.com/ref/llm-client-strategies/fallback), [retry_policy](https://docs.boundaryml.com/ref/llm-client-strategies/retry-policy) |

"The pages read do not describe" and "No page in the index" report what the pages
listed here say; they do not prove that BAML lacks the feature.
