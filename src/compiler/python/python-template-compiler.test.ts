import { describe, test, expect } from "bun:test";
import { compilePythonStringLiteral } from "./python-template-compiler";

const NO_PARAMS = new Set<string>();

describe("compilePythonStringLiteral", () => {
  test("plain string → double-quoted, no f prefix", () => {
    const result = compilePythonStringLiteral("hello", false, NO_PARAMS);
    expect(result).toBe('"hello"');
    expect(result.startsWith("f")).toBe(false);
  });

  test("template string with one var → f-string with input['var']", () => {
    const result = compilePythonStringLiteral("hello {{name}}", true, new Set(["name"]));
    expect(result).toBe(`f"hello {input['name']}"`);
  });

  test("template string with multiple vars → all interpolated", () => {
    const result = compilePythonStringLiteral(
      "Multi {{a}} and {{b}}",
      true,
      new Set(["a", "b"])
    );
    expect(result).toBe(`f"Multi {input['a']} and {input['b']}"`);
  });

  test("literal curly braces in non-template string → plain string, no f prefix", () => {
    const result = compilePythonStringLiteral('{"key": "value"}', false, NO_PARAMS);
    // Should be a plain double-quoted string with escaped inner quotes
    expect(result.startsWith("f")).toBe(false);
    expect(result).toContain("{");
    expect(result).toContain("}");
  });

  test("multiline string → triple-quoted", () => {
    const result = compilePythonStringLiteral("line1\nline2", false, NO_PARAMS);
    expect(result.startsWith('"""')).toBe(true);
    expect(result.endsWith('"""')).toBe(true);
    expect(result).toContain("line1\nline2");
  });

  test("template multiline string → f triple-quoted", () => {
    const result = compilePythonStringLiteral(
      "Hello {{name}}\nHow are you?",
      true,
      new Set(["name"])
    );
    expect(result.startsWith('f"""')).toBe(true);
    expect(result).toContain("{input['name']}");
  });

  test("unknown template var throws CompilerError", () => {
    expect(() =>
      compilePythonStringLiteral("hello {{unknown}}", true, new Set(["name"]))
    ).toThrow("not a declared parameter");
  });

  test("non-template string with backslash is escaped", () => {
    const result = compilePythonStringLiteral("path\\to\\file", false, NO_PARAMS);
    expect(result).toContain("\\\\");
  });

  test("template with literal braces (JSON-like) → braces doubled in f-string", () => {
    // A template string that has JSON-like literal braces alongside {{var}}
    const result = compilePythonStringLiteral(
      'Return JSON: {"key": "val"} for {{item}}',
      true,
      new Set(["item"])
    );
    // Literal { and } should be doubled in the f-string
    expect(result.startsWith("f")).toBe(true);
    expect(result).toContain("{{");
    expect(result).toContain("}}");
    expect(result).toContain("{input['item']}");
  });
});
