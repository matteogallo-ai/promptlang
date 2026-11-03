# Migration Guide

## 2.x → 3.0.0

These changes break existing setups, hence the major version; the full list is in
`CHANGELOG.md` under `[3.0.0]`. Recompile every `.prompt` file and upgrade
`@promptlang/core` in the project that runs the output together: generated code
from 3.0.0 needs the 3.0.0 runtime.

**Compiling**

- **`compile` can refuse a folder that compiled before**, and then writes no file
  at all (exit 1): two sources that would produce the same output file (case
  ignored), or two modules that would export the same name (`sentiment` in two
  folders, `foo_bar` beside `fooBar`). Rename one, or compile them into different
  `--out` folders.
- **More names are compile errors**, each with its position: a reserved word where
  the generated code binds the name (`prompt delete`, a Python parameter `class`),
  a `-` outside `@model`, a Python name starting with `__`, a Python type, prompt
  or chain starting with `_promptlang_`, a type, prompt or chain named after what the generated module imports
  (`PromptClient`, `Promise`, Python's `TypedDict`, `str`...), a TypeScript prompt
  or chain named `globalThis` or `undefined`, a step, prompt or
  chain named `client`, and two declarations that generate the same name (a type
  `FooInput` beside a prompt `foo`). Rename the declaration; the list is in
  `docs/syntax-reference.md`.
- **Python modules are renamed** to importable names: `sentiment.v2.prompt` →
  `sentiment_v2.py`, `2x.prompt` → `_2x.py`, `class.prompt` → `class_.py`. Update
  the imports.
- **Generated headers have no `Generated at` timestamp**: a diff of the compiled
  output now shows only real changes.
- **`analyze --strict` may fail on a file that passed**: `prompt-injection-risk`
  reads every role and judges each placeholder by the delimiters around it.
  Enclose the input in a delimiter pair, or declare a value from a fixed list as
  an `enum`.

**Running generated code**

- **Every answer is checked against the declared output type.** An answer that
  does not conform raises `InvalidOutputError` (`prompt`, `errors`, `output`),
  where 2.x returned it cast to the type: a struct with an undeclared field or a
  field of the wrong type, a `number` not in decimal notation, a `date` that is
  not a real day. In Python it subclasses `ValueError`, so existing `except
  ValueError` blocks still catch it. In `promptlang test`, a `mock:` answer outside
  the type is now a failure: fix the mock.
- **Generated TypeScript imports `parseOutput` from `@promptlang/core/runtime` as
  a value**, so the runtime must be installed at run time, not only for types.
- **A struct parameter is inserted as JSON** (`{"plan":"pro","seats":3}`), where
  TypeScript sent `[object Object]` and Python a dict repr. A prompt that worked
  around this changes what it sends.
- **Incomplete answers raise `IncompleteResponseError`** (TypeScript and Python):
  an answer cut at `max_tokens`, refused, stopped early or with no text. 2.x
  returned the text as a success; an OpenAI `content: null` read as `""`. Catch it
  where you handled empty or truncated output; its `reason` says which case, and
  `usage` what was billed.
- **A 404 from `AnthropicClient` or `OpenAIClient` raises `NotFoundError`**, not
  `InvalidRequestError`. Code that caught `InvalidRequestError` for a missing
  model catches `NotFoundError`.
- **`RoutingClient` falls back only when a provider could not serve the request**
  (outage, rate limit, timeout, network, 404, malformed body). A 400, an
  `IncompleteResponseError` and any error that is not a `PromptClientError` are
  thrown at once, without trying the next provider.
- **`OpenAIClient` sends `max_completion_tokens`** instead of `max_tokens`, the
  field GPT-5 and the o-series require.

**Other**

- `semver-check` treats a removed or renamed declared type as a major change.
- `promptlang --version` prints the version, like `promptlang version`.

## 1.2.0 → 2.0.0

These changes break existing setups, hence the major version; the full list is in
`CHANGELOG.md` under `[2.0.0]`.

- **Install from npm.** `npm install @promptlang/core`. The library and runtime are
  ESM for Node ≥ 20 and Bun; the `promptlang` CLI needs Bun ≥ 1.2.20.
- **`@temperature` on Claude models.** `AnthropicClient` uses API version 2026-10-21,
  which rejects `temperature` on every model, so the client leaves it out and
  `compile` warns. Remove the line, or keep it for OpenAI and Ollama.

- **Package name.** The package is `@promptlang/core` (the unscoped `promptlang`
  name on npm belongs to a third party). The CLI binary is still `promptlang`.
  Generated code imports `@promptlang/core/runtime` (it imported `promptlang/runtime`):
  recompile, and install `@promptlang/core` in the project that runs the output.
- **Empty API keys are rejected** (TypeScript runtime). `new AnthropicClient({ apiKey })` and
  `new OpenAIClient({ apiKey })` throw a `TypeError` when the key is undefined,
  empty or whitespace, instead of sending an unauthenticated request.
- **Malformed provider responses** raise `InvalidResponseError` (exported from the
  TypeScript runtime) instead of an untyped `TypeError`. The generated Python
  runtime is unchanged.
- **`.prompt` files with no declarations** (empty, or only imports and metadata) make `compile` exit 1.
- **`integrity.json` keys** are project-relative POSIX paths. Older files with
  absolute keys are migrated when read, relative to the current checkout; if the
  checkout moved since the file was written, `check` reports those files as
  missing. Re-run `promptlang install` to rewrite the file in either case.
- **`manifest.json`** is schema version 2: `files`, `fromFile` and `resolvedPath`
  are project-relative POSIX paths. Version 1 files are read and converted;
  `install` rewrites them.

## 0.x → 1.0

1.0 kept the 0.9 `.prompt` syntax, CLI commands, runtime constructors and
`promptlang.yaml` schema. Generated files are not byte-for-byte reproducible
between runs or versions: each one carries a `Generated at` timestamp, the source
path and the generator version in its header.

If you started on v0.4 or earlier:

1. **Regenerate compiled files** with `bun run cli compile <path> --out <dir>` to pick
   up code-generator fixes.
2. **Adopt `promptlang.yaml`** for multi-file projects: `bun run cli init`, then
   `bun run cli install` to write `.promptlang/manifest.json` and `integrity.json`.
3. **Python target**: `bun run cli compile <path> --out ./generated --target python`.

## Vendoring compiled output

Generated Python is self-contained: it ships with a generated `promptlang_runtime.py`
(whose HTTP clients need `httpx`). Generated TypeScript imports `@promptlang/core/runtime`, so the project that runs it
depends on `@promptlang/core`; nothing else from the compiler is needed at runtime.
