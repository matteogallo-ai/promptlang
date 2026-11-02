import type { TypeExpression } from "../../ast/nodes";

/** Maps a PromptLang TypeExpression to a Python type hint string. */
export function mapPythonType(type: TypeExpression): string {
  switch (type.kind) {
    case "PrimitiveType":
      switch (type.name) {
        case "string":
          return "str";
        case "number":
          return "float";
        case "boolean":
          return "bool";
        case "date":
          return "str";
      }
      // Unreachable while PrimitiveType.name stays a closed union; without this the
      // case would fall through into EnumType and read a missing `values` field.
      throw new Error(`Unknown primitive type: ${String((type as { name: unknown }).name)}`);
    case "EnumType":
      return `Literal[${type.values.map((v) => JSON.stringify(v)).join(", ")}]`;
    case "StructType":
      // Struct types are emitted as named TypedDict classes; this path is used
      // only for inline anonymous structs, which we render as dict for simplicity.
      return "dict";
    case "TypeReference":
      return type.name;
  }
}

/** Converts snake_case or camelCase to PascalCase for class names. */
export function toPythonPascalCase(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/** Converts a name to SCREAMING_SNAKE_CASE for Python constants. */
export function toPythonConstName(name: string): string {
  return `_${name.toUpperCase()}_VALUES`;
}
