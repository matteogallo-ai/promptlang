import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { type Change, diffPrograms, formatChange } from "./interface";

const HEADER = `@version "1.0.0"\n@model claude-opus-5-5\n`;

function diff(base: string, current: string): Change[] {
  return diffPrograms(parse(tokenize(HEADER + base)), parse(tokenize(HEADER + current)));
}

function levels(base: string, current: string): string[] {
  return diff(base, current).map(formatChange);
}

const PROMPT = (params: string, out = "string", text = "Hi {{x}}") =>
  `prompt p(${params}) -> ${out} {\n  user: "${text}"\n}\n`;

describe("diffPrograms — no change", () => {
  test("identical files require nothing", () => {
    expect(diff(PROMPT("x: string"), PROMPT("x: string"))).toEqual([]);
  });

  test("whitespace, comments and positions do not count as changes", () => {
    expect(diff(PROMPT("x: string"), `// note\n\n${PROMPT("x:   string")}`)).toEqual([]);
  });
});

describe("diffPrograms — major", () => {
  test("required parameter added", () => {
    expect(levels(PROMPT("x: string"), PROMPT("x: string, y: number"))).toEqual([
      "major: p: required parameter 'y' added",
    ]);
  });

  test("parameter removed", () => {
    expect(levels(PROMPT("x: string, y: number"), PROMPT("x: string"))).toEqual([
      "major: p: parameter 'y' removed",
    ]);
  });

  test("parameter type changed", () => {
    expect(levels(PROMPT("x: string"), PROMPT("x: number"))).toEqual([
      "major: p: parameter 'x' type changed: string → number",
    ]);
  });

  test("optional parameter made required", () => {
    expect(levels(PROMPT("x: string, y?: string"), PROMPT("x: string, y: string"))).toEqual([
      "major: p: parameter 'y' became required",
    ]);
  });

  test("output type changed", () => {
    expect(levels(PROMPT("x: string"), PROMPT("x: string", "number"))).toEqual([
      "major: p: output type changed: string → number",
    ]);
  });

  test("output enum restricted or extended", () => {
    const base = PROMPT("x: string", "enum { a, b, c }");
    expect(levels(base, PROMPT("x: string", "enum { a, b }"))[0]).toStartWith("major: p: output");
    expect(levels(base, PROMPT("x: string", "enum { a, b, c, d }"))[0]).toStartWith(
      "major: p: output"
    );
  });

  test("output struct field removed, retyped, or a required field added", () => {
    const base = PROMPT("x: string", "struct { a: string, b: number }");
    expect(levels(base, PROMPT("x: string", "struct { a: string }"))).toEqual([
      "major: p: output field 'b' removed",
    ]);
    expect(levels(base, PROMPT("x: string", "struct { a: string, b: string }"))).toEqual([
      "major: p: output field 'b' type changed: number → string",
    ]);
    expect(
      levels(base, PROMPT("x: string", "struct { a: string, b: number, c: boolean }"))
    ).toEqual(["major: p: required output field 'c' added"]);
  });

  test("output struct field made optional or required", () => {
    const req = PROMPT("x: string", "struct { a: string }");
    const opt = PROMPT("x: string", "struct { a?: string }");
    expect(levels(req, opt)).toEqual(["major: p: output field 'a' became optional"]);
    expect(levels(opt, req)).toEqual(["major: p: output field 'a' became required"]);
  });

  test("a named output type is compared by structure, not by name", () => {
    const base = `type T = enum { a, b }\n${PROMPT("x: string", "T")}`;
    expect(diff(base, `type U = enum { b, a }\n${PROMPT("x: string", "U")}`)).toEqual([]);
    expect(levels(base, `type T = enum { a }\n${PROMPT("x: string", "T")}`)[0]).toStartWith(
      "major: p: output type changed"
    );
  });

  test("target model changed", () => {
    const a = parse(tokenize(`@version "1.0.0"\n@model claude-opus-5-5\n${PROMPT("x: string")}`));
    const b = parse(tokenize(`@version "1.0.0"\n@model claude-haiku-5-5\n${PROMPT("x: string")}`));
    expect(diffPrograms(a, b).map(formatChange)).toEqual([
      "major: p: target model changed: claude-opus-5-5 → claude-haiku-5-5",
    ]);
  });

  test("prompt removed", () => {
    expect(levels(PROMPT("x: string"), "")).toEqual(["major: prompt 'p' removed"]);
  });

  test("a prompt replaced by a chain of the same name", () => {
    const chain = `chain p(x: string) -> string {\n  step s = q(x: x)\n  return s\n}\n`;
    const q = `prompt q(x: string) -> string {\n  user: "Hi {{x}}"\n}\n`;
    expect(levels(PROMPT("x: string") + q, chain + q)).toEqual(["major: p: prompt became a chain"]);
  });
});

describe("diffPrograms — minor", () => {
  test("optional parameter added", () => {
    expect(levels(PROMPT("x: string"), PROMPT("x: string, y?: string"))).toEqual([
      "minor: p: optional parameter 'y' added",
    ]);
  });

  test("required parameter made optional", () => {
    expect(levels(PROMPT("x: string, y: string"), PROMPT("x: string, y?: string"))).toEqual([
      "minor: p: parameter 'y' became optional",
    ]);
  });

  test("optional output field added", () => {
    expect(
      levels(
        PROMPT("x: string", "struct { a: string }"),
        PROMPT("x: string", "struct { a: string, note?: string }")
      )
    ).toEqual(["minor: p: optional output field 'note' added"]);
  });

  test("prompt added", () => {
    expect(levels("", PROMPT("x: string"))).toEqual(["minor: prompt 'p' added"]);
  });
});

describe("diffPrograms — patch", () => {
  test("prompt text changed with the same interface", () => {
    expect(levels(PROMPT("x: string"), PROMPT("x: string", "string", "Hello {{x}}"))).toEqual([
      "patch: p: prompt text changed",
    ]);
  });

  test("temperature or max_tokens changed", () => {
    const a = parse(tokenize(`${HEADER}@max_tokens 100\n${PROMPT("x: string")}`));
    const b = parse(tokenize(`${HEADER}@max_tokens 200\n${PROMPT("x: string")}`));
    expect(diffPrograms(a, b).map(formatChange)).toEqual([
      "patch: p: max_tokens changed: 100 → 200",
    ]);
  });

  test("a chain's steps changed with the same interface", () => {
    const chain = (arg: string) =>
      `${PROMPT("x: string")}chain c(x: string) -> string {\n  step s = p(x: ${arg})\n  return s\n}\n`;
    expect(levels(chain("x"), chain('"fixed"'))).toEqual(["patch: c: chain steps changed"]);
  });
});

describe("diffPrograms — chains share the interface rules", () => {
  test("chain parameter removed is major", () => {
    const chain = (params: string) =>
      `${PROMPT("x: string")}chain c(${params}) -> string {\n  step s = p(x: x)\n  return s\n}\n`;
    expect(levels(chain("x: string, y: string"), chain("x: string"))).toEqual([
      "major: c: parameter 'y' removed",
    ]);
  });
});
