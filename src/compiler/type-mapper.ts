import type { TypeExpression, Field } from "../ast/nodes";

export function mapType(type: TypeExpression): string {
  switch (type.kind) {
    case "PrimitiveType":
      return type.name === "date" ? "string" : type.name;
    case "EnumType":
      return type.values.map((v) => JSON.stringify(v)).join(" | ");
    case "StructType":
      return generateInlineStruct(type.fields);
    case "TypeReference":
      return type.name;
  }
}

function generateInlineStruct(fields: Field[]): string {
  const lines = fields.map((f) => {
    const opt = f.optional ? "?" : "";
    return `  ${f.name}${opt}: ${mapType(f.type)}`;
  });
  return `{\n${lines.join(";\n")};\n}`;
}

export function toPascalCase(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function toConstName(name: string): string {
  return name.toUpperCase() + "_VALUES";
}
