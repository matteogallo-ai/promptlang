# Migration Guide — PromptLang 0.x → 1.0

PromptLang 1.0 is **fully backward compatible** with the 0.x line. If you have
`.prompt` files written against v0.9, they continue to work in v1.0 without
any changes. The generated TypeScript and Python output is byte-identical to
what v0.9 produced.

If you are on v0.9, upgrading is a no-op: run `bun install` again against the
1.0 tag and continue.

---

## What changed

- **API is now stable.** Starting with v1.0.0, PromptLang commits to
  [semantic versioning](https://semver.org/):
  - MINOR releases (1.x) add features without breaking existing code.
  - PATCH releases (1.0.x) fix bugs without changing behavior.
  - MAJOR releases (2.0) may introduce breaking changes with a documented
    migration path.
- **Documentation consolidated.** README has a new hero, a comparison table
  against LangChain / LangSmith / W&B Weave, and a linked table of contents
  for `docs/`.
- **New**: [`docs/migration-guide.md`](migration-guide.md) (this file).
- **New**: [`docs/benchmarks.md`](benchmarks.md) with measured performance on
  the reference machine.

## What did NOT change

- All `.prompt` syntax from v0.9 works identically.
- All CLI commands work identically (`parse`, `tokens`, `analyze`, `compile`,
  `init`, `install`, `list`, `check`, `version`).
- Generated TypeScript output is byte-identical (same header, same imports,
  same function signatures).
- Generated Python output is byte-identical.
- Runtime API (`PromptClient`, `MockClient`, `AnthropicClient`,
  `OpenAIClient`, `OllamaClient`, `RoutingClient`) is stable — the same
  constructors, options, and error types.
- `promptlang.yaml` schema is unchanged.
- `.promptlang/manifest.json` on-disk format is unchanged (still `version: 1`).

---

## For users of very early versions (v0.1 → v0.4)

If you started with v0.4 or earlier (before the Python compiler and AI
linter), you may want to:

1. **Regenerate your compiled files.** Bug fixes and small ergonomic
   improvements have accumulated across 11 alpha versions. Re-running
   `bun run cli compile ...` picks them up.
2. **Adopt `promptlang.yaml` (v0.9+)** for cleaner multi-file projects. Run
   `bun run cli init` in your project root to scaffold one, then
   `bun run cli install` to populate `.promptlang/manifest.json` and
   `integrity.json`.
3. **Enable the AI linter** for semantic issue detection:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   bun run cli analyze <path> --ai
   ```
4. **Consider the Python target** if any of your consumers are Python
   services:
   ```bash
   bun run cli compile <path> --out ./generated --target python
   ```
   The same `.prompt` file compiles to both TypeScript and Python without
   modification.

---

## What's next in 1.x

The 1.x line focuses on distribution and ecosystem, not language changes:

- **npm package publication** — `npm install promptlang` will work as a
  first-class dependency. This is the highest-priority 1.x item.
- **Additional provider clients** — Google Gemini, Mistral, Cohere.
- **Streaming responses** — `PromptClient.stream()` companion to
  `.complete()`.
- **IDE integrations** — VS Code syntax highlighting; a Language Server
  Protocol implementation for hover types, go-to-definition, and diagnostics.
- **Remote package registry** — the current registry is local-only; a
  remote layer will make `dependencies:` in `promptlang.yaml` resolve to a
  hosted index.
- **MCP server integration** — expose compiled prompts as MCP tools.

**Breaking changes are reserved for 2.0** with a proper migration path
published ahead of time. If you find something that feels like a breaking
change in 1.x, that's a bug — please open an issue.

---

## Uninstalling / vendoring

Because PromptLang has **zero external dependencies** at runtime, you can
vendor the generated `.ts` / `.py` files into your codebase and delete
PromptLang entirely once you have compiled. Your production runtime only
needs the tiny `promptlang/runtime` module (a few hundred lines of pure
TypeScript with no imports beyond `fetch`).

This is a deliberate architectural choice: PromptLang is a compile-time
tool. It does not require you to depend on it at runtime unless you want
to keep regenerating stubs.
