# @promptlang/yaml-parser

A **zero-dependency**, deterministic, line-aware YAML parser for the
YAML subset that config files and format registries actually need.

Extracted from PromptLang's core so it can be reused by sibling
projects (Praxis, and any future `@promptlang/*` package) without
pulling in a general-purpose YAML library.

## Install

```bash
bun add @promptlang/yaml-parser
# or: npm install @promptlang/yaml-parser
```

Zero runtime dependencies. Ships as TypeScript source — Bun executes it
directly; TypeScript / Node consumers with a bundler pick up the
declared `exports`.

## Usage

```ts
import { parseYaml, YamlParseError, type YamlValue } from "@promptlang/yaml-parser";

const value: YamlValue = parseYaml(`
name: my-project
version: 1.0.0
tags:
  - alpha
  - stable
`);

try {
  parseYaml("root: &anchor unsupported");
} catch (err) {
  if (err instanceof YamlParseError) {
    console.error(`YAML error at line ${err.line}: ${err.message}`);
  }
}
```

## API

The public surface is intentionally small.

### `parseYaml(source: string): YamlValue`

Parses `source` and returns a `YamlValue`. Throws `YamlParseError` on
any malformed or unsupported construct. Returns `null` for empty input.

### `class YamlParseError extends Error`

Thrown on any syntax or unsupported-construct error. Exposes a `line`
number (1-based) pointing to the offending line.

### `type YamlValue`

Union covering every value the parser can produce:

```ts
type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };
```

### `ConfigParseError` (deprecated alias)

Re-export of `YamlParseError` under the pre-extraction name. Kept for
backwards compatibility with PromptLang v1.0.x internal code and early
Praxis consumers. Will be removed in v2.0 — prefer `YamlParseError`.

## What is supported

- Block-style mappings (`key: value`) with 2-space indentation, nested
  arbitrarily.
- Block-style sequences (`- item`), including sequences of mappings
  (`- key: value` starts a mapping element).
- Scalars: unquoted strings, double-quoted (with `\n`, `\t`, `\r`,
  `\"`, `\\` escapes), single-quoted (with `''` escape), integers,
  floats, booleans (`true`/`false`), null (`~` or `null`).
- Comments (`#` from a whitespace boundary to end of line).

## What is NOT supported (all raise `YamlParseError`)

- Anchors and aliases (`&`, `*`)
- Block scalars (`|`, `>`)
- Explicit type tags (`!!str`, `!!int`, ...)
- Flow-style mappings/sequences (`{a: 1}`, `[1, 2]`)
- Tab characters for indentation

This is a deliberate scope choice — the goal is a small, auditable
parser for machine-authored config files, not a general-purpose YAML
runtime. If your input needs any of the above, use `js-yaml` or the
official `yaml` package instead.

## Provenance

Originally lived at `src/config/yaml-parser.ts` inside PromptLang.
Extracted to this package in PromptLang v1.1.0 (2026-08-14) so that
sibling projects — starting with [Praxis](https://github.com/matteogallo-ai/praxis)
v0.2 — can consume the same parser without vendoring a copy.

## License

MIT — © 2026 Matteo Gallo. See [LICENSE](./LICENSE).
