import type { TypeExpression } from "../ast/nodes";
import type { OutputSchema, OutputSpec } from "../runtime/output";

/**
 * `type` as the runtime checks it. A reference to a type the file declares
 * stays a `ref`, so recursive types are finite; one it does not declare (an
 * imported type) is `unchecked`.
 */
function outputSchema(
  type: TypeExpression,
  registry: ReadonlyMap<string, TypeExpression>
): OutputSchema {
  switch (type.kind) {
    case "PrimitiveType":
      return { kind: type.name };
    case "EnumType":
      return { kind: "enum", values: type.values };
    case "StructType":
      return {
        kind: "struct",
        fields: Object.fromEntries(
          type.fields.map((f) => [
            f.name,
            { optional: f.optional, type: outputSchema(f.type, registry) },
          ])
        ),
      };
    case "TypeReference":
      return registry.has(type.name)
        ? { kind: "ref", name: type.name }
        : { kind: "unchecked", name: type.name };
  }
}

/** The output schema of `type` with the definitions of every declared type it reaches. */
export function outputSpec(
  type: TypeExpression,
  registry: ReadonlyMap<string, TypeExpression>
): OutputSpec {
  const defs: Record<string, OutputSchema> = {};
  const visit = (s: OutputSchema): void => {
    if (s.kind === "ref" && !(s.name in defs)) {
      defs[s.name] = outputSchema(registry.get(s.name)!, registry);
      visit(defs[s.name]!);
    } else if (s.kind === "struct") for (const f of Object.values(s.fields)) visit(f.type);
  };
  const root = outputSchema(type, registry);
  visit(root);
  return { root, defs };
}
