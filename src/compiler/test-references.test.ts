import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { compile } from "./compiler";
import { CompilerError } from "./errors";
import { compilePython } from "./python/python-compiler";
import { checkTestReferences } from "./test-references";

const PROMPT = `@version "1.0.0"\n@model claude-opus-5-5\nprompt greet(name: string, title?: string) -> string {\n  user: "Hi {{name}}"\n}\n`;

function errorOf(source: string): CompilerError | undefined {
  try {
    checkTestReferences(parse(tokenize(PROMPT + source)));
  } catch (e) {
    if (e instanceof CompilerError) return e;
    throw e;
  }
  return undefined;
}

describe("checkTestReferences", () => {
  test("a test calling a declared prompt, positionally or by name, is accepted", () => {
    expect(errorOf(`test "a" {\n  input: greet("Ada")\n  expect: x\n}`)).toBeUndefined();
    expect(
      errorOf(`test "b" {\n  input: greet(name: "Ada", title: "Dr.")\n  expect: x\n}`)
    ).toBeUndefined();
  });

  test("a test calling an unknown prompt is an error at the call, listing what exists", () => {
    const e = errorOf(`test "typo" {\n  input: greeet("Ada")\n  expect: x\n}`);
    expect(e?.message).toBe(
      `test "typo": input calls 'greeet', which is not a prompt or chain in this file (declared: greet)`
    );
    expect([e?.line, e?.column]).toEqual([7, 10]);
  });

  test("an input that is not a call is an error", () => {
    expect(errorOf(`test "lit" {\n  input: "Ada"\n  expect: x\n}`)?.message).toContain(
      "input must call a prompt or chain"
    );
  });

  test("unknown, duplicate, missing or surplus arguments are errors", () => {
    const msg = (call: string) => errorOf(`test "t" {\n  input: ${call}\n  expect: x\n}`)?.message;
    expect(msg(`greet(nme: "Ada")`)).toContain("has no parameter 'nme'");
    expect(msg(`greet("Ada", name: "Bob")`)).toContain("parameter 'name' is given twice");
    expect(msg(`greet(title: "Dr.")`)).toContain("missing required parameter 'name'");
    expect(msg(`greet("a", "b", "c")`)).toContain("takes 2 parameter(s), got 3");
  });

  test("both compilers reject a test on an unknown prompt", () => {
    const program = parse(tokenize(`${PROMPT}test "t" {\n  input: nope("x")\n  expect: x\n}`));
    expect(() => compile(program, "a.prompt")).toThrow(CompilerError);
    expect(() => compilePython(program, "a.prompt")).toThrow(CompilerError);
  });
});
