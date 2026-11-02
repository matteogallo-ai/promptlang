import { describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import {
  analyze,
  CompilerError,
  compile,
  compilePython,
  LexerError,
  ParserError,
  parse,
  ResolverError,
  resolveGraph,
  resolveImport,
  tokenize,
  VERSION,
} from "@promptlang/core";

const SOURCE = `@version "1.0.0"
@model claude-haiku-4-5

prompt greet(name: string) -> string {
  user: "Say hello to {{name}}"
  output: string
}
`;

describe("@promptlang/core public entry point", () => {
  test("VERSION is the package.json version (single source of truth)", () => {
    expect(VERSION).toBe(packageJson.version);
  });

  test("the package resolves under its published name", () => {
    expect(packageJson.name).toBe("@promptlang/core");
  });

  test("tokenize → parse → compile works through the public API", () => {
    const ast = parse(tokenize(SOURCE));
    const ts = compile(ast, "greet.prompt");
    expect(ts).toContain("export async function greet(");
    expect(compilePython(ast, "greet.prompt")).toContain("async def greet(");
  });

  test("analyze runs the static rules through the public API", () => {
    const ast = parse(tokenize(SOURCE));
    const issues = analyze([{ file: "greet.prompt", ast }]);
    expect(Array.isArray(issues)).toBe(true);
  });

  test("resolver and error classes are exported", () => {
    expect(typeof resolveGraph).toBe("function");
    expect(typeof resolveImport).toBe("function");
    for (const E of [LexerError, ParserError, CompilerError, ResolverError]) {
      expect(E.prototype instanceof Error).toBe(true);
    }
  });
});
