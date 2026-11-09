# Changelog — @promptlang/yaml-parser

All notable changes to this package are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and versioning follows [SemVer 2.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] — 2026-11-03

### Security

- A `__proto__` mapping key is kept as an own data property. In 1.0.0 it was
  dropped (`__proto__: x` parsed to `{}`), and a nested mapping under it became
  the parent object's prototype, so a YAML document could set the prototype of
  the object `parseYaml` returns: keys the document never gave that object then
  read as if it had them.
  Upgrade from 1.0.0 if you parse YAML you do not write yourself.

### Fixed

- A backslash inside a single-quoted string is literal, as the YAML spec and
  this README say. It used to escape the next character while looking for
  comments and the key colon, so `dir: 'C:\'  # note` raised
  "Unterminated single-quoted string".

## [1.0.0] — 2026-08-14

Initial release. Extracted verbatim from PromptLang core
(`src/config/yaml-parser.ts`) as of PromptLang v1.0.0.

### Added

- Public API exports:
  - `parseYaml(source: string): YamlValue`
  - `class YamlParseError extends Error` (with `line: number`)
  - `type YamlValue` union
  - `ConfigParseError` — backwards-compat alias for `YamlParseError`,
    kept so PromptLang v1.0.x internal imports and early Praxis
    consumers do not have to change simultaneously. Will be removed in
    v2.0.

### Parser scope

- Supports: block-style mappings and sequences (2-space indent), quoted
  and unquoted scalars, integers, floats, booleans, null (`~` or
  `null`), and `#` comments.
- Rejects: anchors, aliases, block scalars (`|`, `>`), explicit type
  tags (`!!`), flow-style collections (`{}`, `[]`), and tab indentation.

### Guarantees

- Zero external runtime dependencies.
- Every rejected construct raises a `YamlParseError` with a line number.

### Notes

- Logic is identical to the parser shipped in PromptLang v1.0.0. No
  behavioral changes were made during extraction. Any future evolution
  happens here first; downstream consumers (PromptLang, Praxis) pick it
  up via SemVer.

[1.0.1]: https://github.com/matteogallo-ai/promptlang/tree/v2.0.0/packages/yaml-parser
[1.0.0]: https://github.com/matteogallo-ai/promptlang/tree/main/packages/yaml-parser
