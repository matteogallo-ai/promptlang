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
    expect(levels(req, PROMPT("x: string", "struct { a?: number }"))).toEqual([
      "major: p: output field 'a' became optional",
      "major: p: output field 'a' type changed: string → number",
    ]);
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

  test("nested struct fields follow the same rules, with a dotted path", () => {
    const out = (inner: string) =>
      `type Inner = struct { ${inner} }\n${PROMPT("x: string", "struct { inner: Inner }")}`;
    expect(levels(out("a: string"), out("a: string, b?: string"))).toEqual([
      "minor: p: optional output field 'inner.b' added",
    ]);
    expect(levels(out("a: string, b: string"), out("a: string"))).toEqual([
      "major: p: output field 'inner.b' removed",
    ]);
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

describe("diffPrograms — boundaries", () => {
  const raw = (src: string) => parse(tokenize(src));

  test("@temperature added, changed or removed is a patch change with (none) for absence", () => {
    const at = (t: string) => raw(`${HEADER}${t}${PROMPT("x: string")}`);
    const change = (a: string, b: string) => diffPrograms(at(a), at(b)).map(formatChange);
    expect(change("", "@temperature 0.3\n")).toEqual([
      "patch: p: temperature changed: (none) → 0.3",
    ]);
    expect(change("@temperature 0.3\n", "@temperature 0.5\n")).toEqual([
      "patch: p: temperature changed: 0.3 → 0.5",
    ]);
    expect(change("@temperature 0.3\n", "")).toEqual([
      "patch: p: temperature changed: 0.3 → (none)",
    ]);
  });

  test("a model change is reported on prompts only: a chain has no model of its own", () => {
    const file = (model: string) =>
      raw(
        `@model ${model}\n${PROMPT("x: string")}chain c(x: string) -> string {\n  step s = p(x: x)\n  return s\n}\n`
      );
    expect(diffPrograms(file("a"), file("b")).map(formatChange)).toEqual([
      "major: p: target model changed: a → b",
    ]);
  });

  test("moving a declaration to another column is not a change", () => {
    const indented = `prompt p(x: string) -> string {\n        user: "Hi {{x}}"\n}\n`;
    expect(diff(PROMPT("x: string"), indented)).toEqual([]);
  });

  test("reordering struct fields is not a change, in a parameter or in the output", () => {
    const s1 = "struct { a: string, b: number }";
    const s2 = "struct { b: number, a: string }";
    expect(diff(PROMPT(`x: ${s1}`, s1), PROMPT(`x: ${s2}`, s2))).toEqual([]);
  });

  test("types are rendered in full when an output changes kind", () => {
    expect(
      levels(PROMPT("x: string", "struct { a?: string, b: enum { y, x } }"), PROMPT("x: string"))
    ).toEqual(["major: p: output type changed: struct { a?: string, b: enum { x, y } } → string"]);
    expect(levels(PROMPT("x: string"), PROMPT("x: string", "struct { a: string }"))).toEqual([
      "major: p: output type changed: string → struct { a: string }",
    ]);
  });

  test("a nested field changing kind names the field path", () => {
    const out = (t: string) => PROMPT("x: string", `struct { o: struct { a: ${t} } }`);
    expect(levels(out("string"), out("struct { z: string }"))).toEqual([
      "major: p: output field 'o.a' type changed: string → struct { z: string }",
    ]);
  });

  test("an unknown type name is compared by name; a recursive type does not loop", () => {
    expect(diff(PROMPT("x: Missing"), PROMPT("x: Missing"))).toEqual([]);
    expect(levels(PROMPT("x: Missing"), PROMPT("x: Other"))).toEqual([
      "major: p: parameter 'x' type changed: Missing → Other",
    ]);
    // A prompt's name is not a type: a parameter typed `p` stays unresolved.
    expect(levels(PROMPT("x: p"), PROMPT("x: q"))).toEqual([
      "major: p: parameter 'x' type changed: p → q",
    ]);
    const tree = (leaf: string) => `type T = struct { next?: T, v: ${leaf} }\n${PROMPT("x: T")}`;
    expect(levels(tree("string"), tree("number"))).toEqual([
      "major: p: parameter 'x' type changed: struct { next?: T, v: string } → struct { next?: T, v: number }",
    ]);
  });
});
