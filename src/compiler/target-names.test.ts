import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { compile } from "./compiler";
import { CompilerError } from "./errors";
import { exportedNames } from "./target-names";
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
    // Generated files need Python 3.11+; 3.9's kwlist also holds a keyword since removed.
    const r = Bun.spawnSync([
      "python3",
      "-c",
      "import keyword, sys; assert sys.version_info >= (3, 11), sys.version; print(' '.join(keyword.kwlist))",
    ]);
    expect(r.stderr.toString()).toBe("");
    const kwlist = r.stdout.toString().trim().split(" ");
    expect(kwlist.length).toBeGreaterThan(30);
    // These are PromptLang keywords too and never reach the compiler; a lexer change shows here.
    const unlexable = kwlist.filter((k) => {
      try {
        parse(tokenize(`@version "1.0.0"\n${prompt(k)}\n`));
        return false;
      } catch {
        return true;
      }
    });
    expect(unlexable).toEqual(["as", "import", "return"]);
    const lexable = kwlist.filter((k) => !unlexable.includes(k));
    expect(lexable.filter((k) => refusal("python", prompt(k)) === undefined)).toEqual([]);
  });

  // Each of these compiled to a module that does not type-check or that silently
  // shadows a name the generated code relies on.
  test("a name the generated code also derives or imports", () => {
    expect(refusal("python", `type FooInput = struct { a: number }\n${prompt("foo")}`)).toBe(
      "3:1 'FooInput' is generated twice: for the type FooInput and for the prompt foo"
    );
    expect(refusal("typescript", `type PromptClient = string\n${prompt("p")}`)).toBe(
      "2:1 'PromptClient' cannot name a type: the generated TypeScript uses that name"
    );
    expect(refusal("typescript", `type Promise = string\n${prompt("p")}`)).toContain(
      "'Promise' cannot name a type"
    );
    for (const name of ["str", "Literal", "TypedDict", "PromptRequest"])
      expect(refusal("python", `type ${name} = string\n${prompt("p")}`)).toContain(
        `'${name}' cannot name a type: the generated Python uses that name`
      );
    expect(
      refusal("typescript", `${prompt("p")}\nprompt p_meta() -> string { user: "x" }`)
    ).toContain("'p_meta' is generated twice");
  });

  test("a step named after a prompt or chain of the file", () => {
    const chain = `${prompt("summarize")}\nchain c(x: string) -> string {\n  step summarize = summarize(x: x)\n  return summarize\n}`;
    for (const target of ["typescript", "python"] as const)
      expect(refusal(target, chain)).toBe(
        "4:3 'summarize' cannot name a step: the file declares a prompt or chain of that name"
      );
  });

  // Python declares _FOO_VALUES for an enum Foo; TypeScript declares no constant.
  test("an enum and a name equal to the constant generated for it", () => {
    const beside = `type Foo = enum { a, b }
prompt _FOO_VALUES(x: string) -> Foo { user: "<a>{{x}}</a>" }`;
    expect(refusal("python", beside)).toBe(
      "3:1 '_FOO_VALUES' is generated twice: for the type Foo and for the prompt _FOO_VALUES"
    );
    const twoEnums = `type Foo = enum { a, b }
type foo = enum { c }`;
    expect(refusal("python", twoEnums)).toContain("'_FOO_VALUES' is generated twice");
    expect(refusal("typescript", twoEnums)).toBeUndefined();
    expect(
      refusal(
        "typescript",
        `type Foo = enum { a, b }\nprompt FOO_VALUES(x: string) -> Foo { user: "<a>{{x}}</a>" }`
      )
    ).toBeUndefined();
  });

  // Inside a generated chain, `client` is a parameter: a step of that name
  // redeclares it, a callable of that name is shadowed by it. `input`, the other
  // parameter, is a PromptLang keyword and names nothing.
  test("'client' cannot name a step, a prompt or a chain", () => {
    const step = `${prompt("p")}\nchain c(x: string) -> string {\n  step client = p(x: x)\n  return client\n}`;
    for (const target of ["typescript", "python"] as const) {
      expect(refusal(target, step)).toBe(
        "4:3 'client' cannot name a step: the generated chain's parameters use that name"
      );
      expect(refusal(target, prompt("client"))).toBe(
        "2:1 'client' cannot name a prompt: the generated chain's parameters use that name"
      );
    }
  });

  // Generated bodies reach output parsing through the runtime import and JSON
  // through globalThis, so a prompt of a global's name shadows nothing they call.
  test("a prompt may share a global's name", () => {
    for (const name of ["Number", "isNaN", "Error", "JSON"])
      expect(refusal("typescript", prompt(name))).toBeUndefined();
    expect(refusal("python", prompt("ValueError"))).toBeUndefined();
  });

  // A struct parameter is inserted with globalThis.JSON, and an optional one is
  // compared with undefined: a module-level function of either name breaks that.
  test("a prompt or chain cannot take a global the generated code reads", () => {
    for (const name of ["globalThis", "undefined"]) {
      expect(refusal("typescript", prompt(name))).toBe(
        `2:1 '${name}' cannot name a prompt: the generated TypeScript uses that name`
      );
      const chain = `${prompt("p")}\nchain ${name}(x: string) -> string {\n  step s = p(x: x)\n  return s\n}`;
      expect(refusal("typescript", chain)).toContain(
        `'${name}' cannot name a chain: the generated TypeScript uses that name`
      );
    }
  });

  // A TypedDict attribute does not bind a module name, so it shadows nothing.
  test("a Python field or parameter may share a builtin's name", () => {
    const body = `type T = struct { list: string }\nprompt p(str: string, t: T) -> string { user: "<a>{{str}}</a>" }`;
    expect(refusal("python", body)).toBeUndefined();
  });

  // A TypeScript type does not hide a value of the same name, nor a value a type.
  test("TypeScript keeps type and value names apart", () => {
    expect(
      refusal("typescript", `type Error = struct { code: number }\n${prompt("p")}`)
    ).toBeUndefined();
    expect(
      refusal("typescript", `type FOO_VALUES = string\ntype Foo = enum { a }`)
    ).toBeUndefined();
  });

  test("the enum constant is not exported, so two files may each have one", () => {
    const program = parse(tokenize(`@version "1.0.0"\ntype Foo = enum { a }\n`));
    expect(exportedNames(program, "typescript")).toEqual(["Foo"]);
  });

  // Each compiled with exit 0 to TypeScript that does not parse (TS1110, TS1003).
  test("TypeScript type operators cannot name a type", () => {
    for (const name of ["keyof", "readonly", "unique", "infer"])
      expect(refusal("typescript", `type ${name} = string\n${prompt("p")}`)).toBe(
        `2:1 '${name}' cannot name a type: TypeScript reserves it as a type name`
      );
  });

  test("a step named twice, or after a parameter of its chain", () => {
    const twice = `${prompt("p")}\nchain c(x: string) -> string {\n  step a = p(x: x)\n  step a = p(x: x)\n  return a\n}`;
    const param = `${prompt("p")}\nchain c(x: string) -> string {\n  step x = p(x: x)\n  return x\n}`;
    for (const target of ["typescript", "python"] as const) {
      expect(refusal(target, twice)).toBe(
        "5:3 'a' cannot name a step: an earlier step of the chain has that name"
      );
      expect(refusal(target, param)).toBe(
        "4:3 'x' cannot name a step: a parameter of the chain has that name"
      );
    }
  });

  // Python mangles `__x` inside a class body (TypedDict keys) and gives `__x__` module names a meaning.
  test("a Python name starting with '__'", () => {
    expect(refusal("python", `type T = struct { __secret: string }\n${prompt("p")}`)).toBe(
      "2:19 '__secret' cannot name a field: Python reserves names starting with '__'"
    );
    expect(refusal("python", prompt("__all__"))).toContain(
      "Python reserves names starting with '__'"
    );
    expect(refusal("typescript", prompt("__all__"))).toBeUndefined();
  });
});
