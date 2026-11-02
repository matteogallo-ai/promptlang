# Migration Guide

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
