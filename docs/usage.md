# Using PromptLang

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

## Versioning

- `@version` must be SemVer 2.0.0 (`1.4.0`, `2.0.0-rc.1`); anything else is a parse error.
- `import "./sentiment.prompt" as S requires "^1.0.0"`: `install` and `check` fail
  with `VersionMismatchError` when the imported file's `@version` is outside the range.
- `promptlang semver-check [--base <ref>]` compares each `.prompt` file with its version
  at a Git ref (default `origin/main`, else the latest tag). Removing or retyping a
  parameter, adding a required one, changing the output type or the `@model` requires a
  major bump; optional additions a minor; text-only changes a patch. CI runs it on
  `docs/examples`. Full rules: [`docs/syntax-reference.md`](syntax-reference.md) Section 6.

`bun run demo` plays the whole story in a temporary Git repository: an incompatible
change released as 1.1.0 is rejected, 2.0.0 passes, a consumer pinned to `^1.0.0`
fails cleanly, and the tests still pass ([`docs/examples/demo/`](examples/demo/)).

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
`InvalidRequestError` or `ServerError`, a malformed response raises
`InvalidResponseError`, and an answer cut at `@max_tokens`, refused or empty raises
`IncompleteResponseError` (all subclasses of `PromptClientError`). It sends Anthropic API
version 2026-10-21, without `temperature`. Unlike the TypeScript runtime, it does not
retry, and a timeout or a connection failure raises `httpx`'s own exception.
The `MockClient` works with no dependencies for local testing.
