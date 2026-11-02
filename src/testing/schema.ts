import type { TypeExpression } from "../ast/nodes";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every way `value` fails to conform to `type`, as "path: problem" strings; empty
 * when it conforms. The generated code only checks enum membership and JSON
 * syntax, so `expect schema` needs this to say anything about struct outputs.
 * Structs are closed: a field the type does not declare is a mismatch, because a
 * model adding fields is usually a model not following the output instructions.
 */
export function schemaErrors(
  value: unknown,
  type: TypeExpression,
  types: ReadonlyMap<string, TypeExpression>,
  path = "output"
): string[] {
  switch (type.kind) {
    case "PrimitiveType":
      if (type.name === "date") {
        return typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))
          ? []
          : [`${path}: expected a YYYY-MM-DD date, got ${describe(value)}`];
      }
      if (type.name === "number" && typeof value === "number" && !Number.isFinite(value)) {
        return [`${path}: expected a finite number, got ${value}`];
      }
      return typeof value === type.name
        ? []
        : [`${path}: expected ${type.name}, got ${describe(value)}`];
    case "EnumType":
      return typeof value === "string" && type.values.includes(value)
        ? []
        : [`${path}: expected one of ${type.values.join(", ")}, got ${describe(value)}`];
    case "StructType": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [`${path}: expected an object, got ${describe(value)}`];
      }
      const record = value as Record<string, unknown>;
      const errors: string[] = [];
      for (const f of type.fields) {
        if (record[f.name] === undefined) {
          if (!f.optional) errors.push(`${path}.${f.name}: missing required field`);
        } else {
          errors.push(...schemaErrors(record[f.name], f.type, types, `${path}.${f.name}`));
        }
      }
      for (const key of Object.keys(record)) {
        if (!type.fields.some((f) => f.name === key))
          errors.push(`${path}.${key}: field not in the declared type`);
      }
      return errors;
    }
    case "TypeReference": {
      const target = types.get(type.name);
      return target
        ? schemaErrors(value, target, types, path)
        : [`${path}: type '${type.name}' is not declared in this file, cannot check it`];
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string")
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === "object") return "an object";
  return `${typeof value} ${String(value)}`;
}
