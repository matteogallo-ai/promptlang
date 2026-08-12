import { describe, test, expect } from "bun:test";
import { mapPythonType, toPythonPascalCase, toPythonConstName } from "./python-type-mapper";

describe("mapPythonType", () => {
  test("PrimitiveType string → str", () => {
    expect(mapPythonType({ kind: "PrimitiveType", name: "string", line: 1, column: 1 })).toBe("str");
  });

  test("PrimitiveType number → float", () => {
    expect(mapPythonType({ kind: "PrimitiveType", name: "number", line: 1, column: 1 })).toBe("float");
  });

  test("PrimitiveType boolean → bool", () => {
    expect(mapPythonType({ kind: "PrimitiveType", name: "boolean", line: 1, column: 1 })).toBe("bool");
  });

  test("PrimitiveType date → str", () => {
    expect(mapPythonType({ kind: "PrimitiveType", name: "date", line: 1, column: 1 })).toBe("str");
  });

  test("EnumType → Literal with quoted values", () => {
    const result = mapPythonType({
      kind: "EnumType",
      values: ["bug", "feature_request", "other"],
      line: 1, column: 1,
    });
    expect(result).toBe(`Literal["bug", "feature_request", "other"]`);
  });

  test("TypeReference → name as-is", () => {
    expect(mapPythonType({ kind: "TypeReference", name: "Category", line: 1, column: 1 })).toBe("Category");
  });

  test("StructType → dict (inline anonymous struct fallback)", () => {
    expect(mapPythonType({
      kind: "StructType",
      fields: [],
      line: 1, column: 1,
    })).toBe("dict");
  });
});

describe("toPythonPascalCase", () => {
  test("snake_case → PascalCase", () => {
    expect(toPythonPascalCase("classify_ticket")).toBe("ClassifyTicket");
  });

  test("single word", () => {
    expect(toPythonPascalCase("greet")).toBe("Greet");
  });

  test("already PascalCase unchanged", () => {
    expect(toPythonPascalCase("Category")).toBe("Category");
  });
});

describe("toPythonConstName", () => {
  test("name → _NAME_VALUES", () => {
    expect(toPythonConstName("Category")).toBe("_CATEGORY_VALUES");
  });

  test("lowercase name is uppercased", () => {
    expect(toPythonConstName("status")).toBe("_STATUS_VALUES");
  });
});
