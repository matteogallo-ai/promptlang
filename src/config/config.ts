import { parseYaml, ConfigParseError, type YamlValue } from "./yaml-parser";

/**
 * Fully-resolved PromptLang project configuration.
 *
 * All optional fields have been filled with defaults so that consumers
 * (compile, install, check) do not need to re-check for missing values.
 */
export interface PromptLangConfig {
  name: string;
  version: string;
  description: string | null;
  defaults: {
    model: string;
    temperature: number;
    max_tokens: number;
  };
  sources: SourceEntry[];
  compile: {
    target: "typescript" | "python";
    out: string;
    emit_tsconfig: boolean;
  };
  linter: {
    ai: {
      enabled: boolean;
      model: string;
      concurrency: number;
    };
  };
  dependencies: DependencyEntry[];
}

export interface SourceEntry {
  path: string;
}

export interface DependencyEntry {
  name: string;
  version: string;
  path: string;
}

/** Default values applied to fields the user did not specify. */
export const CONFIG_DEFAULTS = {
  defaults: {
    model: "claude-opus-4.7",
    temperature: 0.3,
    max_tokens: 1024,
  },
  compile: {
    target: "typescript" as const,
    out: "./generated",
    emit_tsconfig: false,
  },
  linter: {
    ai: {
      enabled: false,
      model: "claude-haiku-4-5",
      concurrency: 3,
    },
  },
} as const;

/** The canonical filename for a PromptLang project config. */
export const CONFIG_FILENAME = "promptlang.yaml";

/**
 * Loads a `promptlang.yaml` from disk, parses it, validates required fields,
 * and applies defaults for any missing optional fields.
 *
 * @throws {ConfigParseError} on YAML syntax errors.
 * @throws {ConfigValidationError} on missing required fields or invalid values.
 * @throws {Error} if the file cannot be read.
 */
export async function loadConfig(path: string): Promise<PromptLangConfig> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new ConfigValidationError(`Config file not found: ${path}`);
  }
  const source = await file.text();
  return parseConfig(source, path);
}

/**
 * Parses a config source string and validates the result.
 * Exposed separately so tests and other callers can validate in-memory YAML.
 */
export function parseConfig(source: string, sourceName = CONFIG_FILENAME): PromptLangConfig {
  const raw = parseYaml(source);
  if (raw === null) {
    throw new ConfigValidationError(`${sourceName} is empty`);
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigValidationError(`${sourceName} must be a mapping at the top level`);
  }
  return validate(raw as Record<string, YamlValue>, sourceName);
}

/** Thrown when the config has a structural or value problem (not a YAML syntax problem). */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(
  raw: Record<string, YamlValue>,
  sourceName: string
): PromptLangConfig {
  const name = requireString(raw, "name", sourceName);
  const version = requireString(raw, "version", sourceName);

  const description = raw.description === undefined ? null : optionalString(raw, "description", sourceName);

  const defaults = readDefaults(raw.defaults, sourceName);
  const sources = readSources(raw.sources, sourceName);
  const compile = readCompile(raw.compile, sourceName);
  const linter = readLinter(raw.linter, sourceName);
  const dependencies = readDependencies(raw.dependencies, sourceName);

  return { name, version, description, defaults, sources, compile, linter, dependencies };
}

function readDefaults(v: YamlValue | undefined, sourceName: string): PromptLangConfig["defaults"] {
  if (v === undefined || v === null) return { ...CONFIG_DEFAULTS.defaults };
  const obj = asMapping(v, "defaults", sourceName);
  return {
    model: obj.model === undefined ? CONFIG_DEFAULTS.defaults.model : requireString(obj, "defaults.model", sourceName, "model"),
    temperature:
      obj.temperature === undefined
        ? CONFIG_DEFAULTS.defaults.temperature
        : requireNumber(obj, "defaults.temperature", sourceName, "temperature"),
    max_tokens:
      obj.max_tokens === undefined
        ? CONFIG_DEFAULTS.defaults.max_tokens
        : requireNumber(obj, "defaults.max_tokens", sourceName, "max_tokens"),
  };
}

function readSources(v: YamlValue | undefined, sourceName: string): SourceEntry[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new ConfigValidationError(`${sourceName}: 'sources' must be a sequence`);
  }
  return v.map((item, i) => {
    const obj = asMapping(item, `sources[${i}]`, sourceName);
    const path = requireString(obj, `sources[${i}].path`, sourceName, "path");
    return { path };
  });
}

function readCompile(v: YamlValue | undefined, sourceName: string): PromptLangConfig["compile"] {
  if (v === undefined || v === null) return { ...CONFIG_DEFAULTS.compile };
  const obj = asMapping(v, "compile", sourceName);
  const rawTarget = obj.target === undefined ? CONFIG_DEFAULTS.compile.target : requireString(obj, "compile.target", sourceName, "target");
  if (rawTarget !== "typescript" && rawTarget !== "python") {
    throw new ConfigValidationError(
      `${sourceName}: 'compile.target' must be 'typescript' or 'python' (got '${rawTarget}')`
    );
  }
  const out = obj.out === undefined ? CONFIG_DEFAULTS.compile.out : requireString(obj, "compile.out", sourceName, "out");
  const emit_tsconfig =
    obj.emit_tsconfig === undefined
      ? CONFIG_DEFAULTS.compile.emit_tsconfig
      : requireBoolean(obj, "compile.emit_tsconfig", sourceName, "emit_tsconfig");
  return { target: rawTarget, out, emit_tsconfig };
}

function readLinter(v: YamlValue | undefined, sourceName: string): PromptLangConfig["linter"] {
  if (v === undefined || v === null) return { ai: { ...CONFIG_DEFAULTS.linter.ai } };
  const obj = asMapping(v, "linter", sourceName);
  if (obj.ai === undefined || obj.ai === null) return { ai: { ...CONFIG_DEFAULTS.linter.ai } };
  const ai = asMapping(obj.ai, "linter.ai", sourceName);
  return {
    ai: {
      enabled:
        ai.enabled === undefined
          ? CONFIG_DEFAULTS.linter.ai.enabled
          : requireBoolean(ai, "linter.ai.enabled", sourceName, "enabled"),
      model:
        ai.model === undefined
          ? CONFIG_DEFAULTS.linter.ai.model
          : requireString(ai, "linter.ai.model", sourceName, "model"),
      concurrency:
        ai.concurrency === undefined
          ? CONFIG_DEFAULTS.linter.ai.concurrency
          : requireNumber(ai, "linter.ai.concurrency", sourceName, "concurrency"),
    },
  };
}

function readDependencies(v: YamlValue | undefined, sourceName: string): DependencyEntry[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new ConfigValidationError(`${sourceName}: 'dependencies' must be a sequence`);
  }
  return v.map((item, i) => {
    const obj = asMapping(item, `dependencies[${i}]`, sourceName);
    return {
      name: requireString(obj, `dependencies[${i}].name`, sourceName, "name"),
      version: requireString(obj, `dependencies[${i}].version`, sourceName, "version"),
      path: requireString(obj, `dependencies[${i}].path`, sourceName, "path"),
    };
  });
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function asMapping(v: YamlValue, field: string, sourceName: string): Record<string, YamlValue> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    throw new ConfigValidationError(`${sourceName}: '${field}' must be a mapping`);
  }
  return v as Record<string, YamlValue>;
}

function requireString(
  obj: Record<string, YamlValue>,
  field: string,
  sourceName: string,
  key?: string
): string {
  const k = key ?? field;
  const value = obj[k];
  if (value === undefined) {
    throw new ConfigValidationError(`${sourceName}: missing required field '${field}'`);
  }
  if (typeof value !== "string") {
    throw new ConfigValidationError(
      `${sourceName}: '${field}' must be a string (got ${describeType(value)})`
    );
  }
  return value;
}

function optionalString(
  obj: Record<string, YamlValue>,
  field: string,
  sourceName: string,
  key?: string
): string | null {
  const k = key ?? field;
  const value = obj[k];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ConfigValidationError(
      `${sourceName}: '${field}' must be a string (got ${describeType(value)})`
    );
  }
  return value;
}

function requireNumber(
  obj: Record<string, YamlValue>,
  field: string,
  sourceName: string,
  key?: string
): number {
  const k = key ?? field;
  const value = obj[k];
  if (value === undefined) {
    throw new ConfigValidationError(`${sourceName}: missing required field '${field}'`);
  }
  if (typeof value !== "number") {
    throw new ConfigValidationError(
      `${sourceName}: '${field}' must be a number (got ${describeType(value)})`
    );
  }
  return value;
}

function requireBoolean(
  obj: Record<string, YamlValue>,
  field: string,
  sourceName: string,
  key?: string
): boolean {
  const k = key ?? field;
  const value = obj[k];
  if (value === undefined) {
    throw new ConfigValidationError(`${sourceName}: missing required field '${field}'`);
  }
  if (typeof value !== "boolean") {
    throw new ConfigValidationError(
      `${sourceName}: '${field}' must be true or false (got ${describeType(value)})`
    );
  }
  return value;
}

function describeType(v: YamlValue): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "sequence";
  if (typeof v === "object") return "mapping";
  return typeof v;
}

export { ConfigParseError };
