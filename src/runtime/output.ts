/**
 * Runtime check of a model's answer against the prompt's declared output type.
 * Generated code calls `parseOutput` with a schema the compiler derives from the
 * `.prompt` types, so the value it returns has the type its signature claims.
 * `promptlang test`'s `expect schema` applies the same `outputErrors`.
 */
import { InvalidOutputError } from "./errors";

/** A declared type, as the compiler emits it: named types appear as `ref`s into `defs`. */
export type OutputSchema =
  | { kind: "string" | "number" | "boolean" | "date" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "struct"; fields: Readonly<Record<string, { optional: boolean; type: OutputSchema }>> }
  | { kind: "ref"; name: string }
  /** A type declared in another file: it cannot be checked from here. */
  | { kind: "unchecked"; name: string };

export interface OutputSpec {
  root: OutputSchema;
  defs: Readonly<Record<string, OutputSchema>>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Decimal notation only, as in Python: `Number` also reads `0x10`, `0b1` and `""`. */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * A real calendar day: `Date.parse` alone reads 2024-02-30 as March 1st. Year
 * 0000 is refused, as Python's `date` starts at year 1.
 */
function isDate(value: unknown): boolean {
  if (typeof value !== "string" || !ISO_DATE.test(value) || value.startsWith("0000")) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * What a value is, never the value itself: model output is untrusted, may hold
 * user data, and error messages reach logs.
 */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

/**
 * Every way `value` fails to conform, as "path: problem" strings; empty when it
 * conforms. Structs are closed: a field the type does not declare is a
 * mismatch, because a model adding fields is usually a model not following the
 * output instructions.
 */
export function outputErrors(
  value: unknown,
  schema: OutputSchema,
  defs: OutputSpec["defs"],
  path = "output"
): string[] {
  switch (schema.kind) {
    case "date":
      return isDate(value) ? [] : [`${path}: expected a YYYY-MM-DD date, got ${describe(value)}`];
    case "number":
      // JSON reads 1e400 or a 400-digit integer as Infinity.
      if (typeof value === "number" && !Number.isFinite(value))
        return [`${path}: expected a finite number, got a non-finite number`];
      return typeof value === "number" ? [] : [`${path}: expected number, got ${describe(value)}`];
    case "string":
    case "boolean":
      return typeof value === schema.kind
        ? []
        : [`${path}: expected ${schema.kind}, got ${describe(value)}`];
    case "enum":
      return typeof value === "string" && schema.values.includes(value)
        ? []
        : [`${path}: expected one of ${schema.values.join(", ")}, got ${describe(value)}`];
    case "struct": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return [`${path}: expected an object, got ${describe(value)}`];
      const record = value as Record<string, unknown>;
      const errors: string[] = [];
      for (const [name, field] of Object.entries(schema.fields)) {
        if (Object.hasOwn(record, name))
          errors.push(...outputErrors(record[name], field.type, defs, `${path}.${name}`));
        else if (!field.optional) errors.push(`${path}.${name}: missing required field`);
      }
      // Counted, not named: a field name comes from the model and could forge or
      // flood a log line.
      const extra = Object.keys(record).filter((k) => !Object.hasOwn(schema.fields, k)).length;
      if (extra > 0)
        errors.push(`${path}: ${extra} field${extra === 1 ? "" : "s"} not in the declared type`);
      return errors;
    }
    case "ref": {
      const target = Object.hasOwn(defs, schema.name) ? defs[schema.name] : undefined;
      return target
        ? outputErrors(value, target, defs, path)
        : [`${path}: type '${schema.name}' is not declared in this file, cannot check it`];
    }
    case "unchecked":
      return [];
  }
}

function resolve(schema: OutputSchema, defs: OutputSpec["defs"]): OutputSchema {
  const seen = new Set<string>();
  let s = schema;
  while (s.kind === "ref" && !seen.has(s.name) && Object.hasOwn(defs, s.name)) {
    seen.add(s.name);
    s = defs[s.name]!;
  }
  return s;
}

/** The body of a single surrounding Markdown code fence, or the text unchanged. */
function unfenced(raw: string): string {
  const m = /^```[\w-]*\r?\n([\s\S]*)\r?\n```$/.exec(raw);
  return m ? m[1]! : raw;
}

/**
 * Reads the model's (trimmed) text as the declared output type: text as is,
 * numbers and booleans from their spelling, structs as JSON (one surrounding
 * code fence allowed), each then checked by `outputErrors`. Throws
 * InvalidOutputError when the answer does not conform.
 */
export function parseOutput(prompt: string, raw: string, spec: OutputSpec): unknown {
  const root = resolve(spec.root, spec.defs);
  let value: unknown = raw;
  if (root.kind === "number") {
    // An answer that is not a number stays text, so the error says what it got.
    const n = Number(raw);
    value = DECIMAL.test(raw) && Number.isFinite(n) ? n : raw;
  } else if (root.kind === "boolean") {
    const lower = raw.toLowerCase();
    value = lower === "true" ? true : lower === "false" ? false : raw;
  } else if (root.kind === "struct") {
    try {
      value = JSON.parse(unfenced(raw));
    } catch {
      throw new InvalidOutputError(prompt, ["output: not valid JSON"], raw);
    }
  }
  let errors: string[];
  try {
    errors = outputErrors(value, root, spec.defs);
  } catch (error) {
    // A recursive type lets a hostile answer nest deeper than the call stack;
    // that answer is rejected like any other, not surfaced as a crash.
    if (!(error instanceof RangeError)) throw error;
    errors = ["output: nested too deeply to check"];
  }
  if (errors.length > 0) throw new InvalidOutputError(prompt, bounded(errors), raw);
  return value;
}

const MAX_ERRORS = 10;
const MAX_ERROR_LENGTH = 500;

/**
 * At most MAX_ERRORS errors of at most MAX_ERROR_LENGTH characters: an answer
 * can nest a recursive type thousands of levels deep, and the error reaches logs.
 */
function bounded(errors: readonly string[]): string[] {
  const shown = errors
    .slice(0, MAX_ERRORS)
    .map((e) => (e.length > MAX_ERROR_LENGTH ? `${e.slice(0, 250)}…${e.slice(-249)}` : e));
  const rest = errors.length - shown.length;
  return rest > 0 ? [...shown, `output: ${rest} more mismatches`] : shown;
}
