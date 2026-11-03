import type { TypeExpression } from "../ast/nodes";
import { outputSpec } from "../compiler/output-schema";
import { type OutputSchema, outputErrors } from "../runtime/output";

/**
 * A type the file does not declare is `unchecked` at run time, so answers of
 * imported types still flow; `expect schema` asserts conformance, so there it
 * must fail and say the type cannot be checked.
 */
function strict(s: OutputSchema): OutputSchema {
  if (s.kind === "unchecked") return { kind: "ref", name: s.name };
  if (s.kind !== "struct") return s;
  return {
    kind: "struct",
    fields: Object.fromEntries(
      Object.entries(s.fields).map(([n, f]) => [n, { optional: f.optional, type: strict(f.type) }])
    ),
  };
}

/**
 * Every way `value` fails to conform to `type`, as "path: problem" strings; empty
 * when it conforms. The same check the generated code runs on every answer
 * (`parseOutput`), so `expect schema` and production apply one set of rules.
 */
export function schemaErrors(
  value: unknown,
  type: TypeExpression,
  types: ReadonlyMap<string, TypeExpression>,
  path = "output"
): string[] {
  const spec = outputSpec(type, types);
  const defs = Object.fromEntries(Object.entries(spec.defs).map(([n, s]) => [n, strict(s)]));
  return outputErrors(value, strict(spec.root), defs, path);
}
