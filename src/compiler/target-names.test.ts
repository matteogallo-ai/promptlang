import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { compile } from "./compiler";
import { CompilerError } from "./errors";
import { compilePython } from "./python/python-compiler";

const compilers = { typescript: compile, python: compilePython } as const;

function refusal(target: keyof typeof compilers, body: string): string | undefined {
  try {
    compilers[target](parse(tokenize(`@version "1.0.0"\n${body}\n`)), "f.prompt");
    return undefined;
  } catch (e) {
    if (!(e instanceof CompilerError)) throw e;
    return `${e.line}:${e.column} ${e.message}`;
  }
}

const prompt = (name: string, params = "x: string") =>
  `prompt ${name}(${params}) -> string { user: "<a>{{x}}</a>" }`;

describe("names the target language cannot hold are compile errors", () => {
  // Each of these compiled to a module that does not parse, with exit 0.
  test("a reserved word naming a prompt, a chain step or a type", () => {
    expect(refusal("typescript", prompt("delete"))).toBe(
      "2:1 'delete' cannot name a prompt: it is a reserved word in TypeScript"
    );
    expect(refusal("python", prompt("pass"))).toBe(
      "2:1 'pass' cannot name a prompt: it is a reserved word in Python"
    );
    const chain = `${prompt("p")}\nchain c(x: string) -> string {\n  step if = p(x: x)\n  return if\n}`;
    expect(refusal("typescript", chain)).toContain("'if' cannot name a step");
    expect(refusal("python", chain)).toContain("'if' cannot name a step");
    expect(refusal("typescript", `type any = struct { a: number }\n${prompt("p")}`)).toBe(
      "2:1 'any' cannot name a type: TypeScript reserves it as a type name"
    );
  });

  // Python declares them as TypedDict attributes; TypeScript only reads them as properties.
  test("a reserved word naming a parameter or a field fails in Python only", () => {
    const param = `prompt p(class: string) -> string { user: "<a>{{class}}</a>" }`;
    expect(refusal("typescript", param)).toBeUndefined();
    expect(refusal("python", param)).toContain("'class' cannot name a parameter");
    const field = `type S = struct { def: number }\nprompt p() -> S { user: "hi" }`;
    expect(refusal("typescript", field)).toBeUndefined();
    expect(refusal("python", field)).toContain("'def' cannot name a field");
  });

  test("a name with a hyphen is refused in both languages", () => {
    expect(refusal("typescript", prompt("my-p"))).toBe(
      "2:1 'my-p' cannot name a prompt: TypeScript identifiers cannot contain '-'"
    );
    expect(refusal("python", prompt("p", "the-text: string"))).toContain(
      "'the-text' cannot name a parameter: Python identifiers cannot contain '-'"
    );
  });

  test("every Python keyword is refused as a prompt name", () => {
    const r = Bun.spawnSync(["python3", "-c", "import keyword; print(' '.join(keyword.kwlist))"]);
    const kwlist = r.stdout.toString().trim().split(" ");
    expect(kwlist.length).toBeGreaterThan(30);
    // Some keywords are PromptLang keywords too and never reach the compiler.
    const lexable = kwlist.filter((k) => {
      try {
        parse(tokenize(`@version "1.0.0"\n${prompt(k)}\n`));
        return true;
      } catch {
        return false;
      }
    });
    expect(lexable.filter((k) => refusal("python", prompt(k)) === undefined)).toEqual([]);
  });
});
