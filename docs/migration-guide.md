# Migration Guide

## Unreleased changes (on `main`, not yet tagged)

These changes can break existing setups. The release that ships them picks its
version number by SemVer; see `CHANGELOG.md` under `[Unreleased]`.

- **Package name.** The package is `@promptlang/core` (the unscoped `promptlang`
  name on npm belongs to a third party). The CLI binary is still `promptlang`.
  Generated code still imports `promptlang/runtime`, resolved through a `paths`
  mapping (`compile --emit-tsconfig`).
- **Empty API keys are rejected.** `new AnthropicClient({ apiKey })` and
  `new OpenAIClient({ apiKey })` throw a `TypeError` when the key is undefined,
  empty or whitespace, instead of sending an unauthenticated request.
- **Malformed provider responses** raise `InvalidResponseError` (exported from the
  runtime) instead of an untyped `TypeError`.
- **Empty `.prompt` files** (no declarations, no imports) make `compile` exit 1.
- **`integrity.json` keys** are project-relative POSIX paths. Older files with
  absolute keys are migrated when read; re-run `promptlang install` to rewrite them.

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
(whose HTTP clients need `httpx`). Generated TypeScript imports `promptlang/runtime`,
which is not published, so it needs this repository's `src/runtime/` reachable
through a `paths` mapping; you cannot delete the checkout after compiling.
