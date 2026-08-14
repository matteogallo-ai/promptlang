/**
 * `@promptlang/yaml-parser` — public API.
 *
 * The primary error class is `YamlParseError`. It is also re-exported as
 * `ConfigParseError` for backwards compatibility with the pre-extraction
 * name used inside PromptLang core (v1.0.x). The alias may be dropped in
 * v2.0 of the package; prefer `YamlParseError` in new code.
 */

export { parseYaml, YamlParseError } from "./parser";
export type { YamlValue } from "./parser";

// Backwards-compat alias: existing PromptLang / Praxis code imports
// `ConfigParseError`. Because it is `export { X as Y }` of the same
// class, `instanceof ConfigParseError` and `instanceof YamlParseError`
// resolve to the same identity.
export { YamlParseError as ConfigParseError } from "./parser";
