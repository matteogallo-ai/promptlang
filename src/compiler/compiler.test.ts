import { describe, test, expect, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { compile } from "./compiler";
import { mapType, toPascalCase, toConstName } from "./type-mapper";
import { compileStringLiteral, extractTemplateVars } from "./template-compiler";
import { CompilerError } from "./errors";
import type {
  Program,
  PrimitiveType,
  EnumType,
  StructType,
  TypeReference,
} from "../ast/nodes";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSource(source: string): Program {
  return parse(tokenize(source));
}

function pos() {
  return { line: 1, column: 1 };
}

function primitiveType(name: "string" | "number" | "boolean" | "date"): PrimitiveType {
  return { kind: "PrimitiveType", name, ...pos() };
}

function enumType(values: string[]): EnumType {
  return { kind: "EnumType", values, ...pos() };
}

function structType(fields: Array<{ name: string; type: PrimitiveType; optional?: boolean }>): StructType {
  return {
    kind: "StructType",
    fields: fields.map((f) => ({
      kind: "Field" as const,
      name: f.name,
      optional: f.optional ?? false,
      type: f.type,
      ...pos(),
    })),
    ...pos(),
  };
}

function typeRef(name: string): TypeReference {
  return { kind: "TypeReference", name, ...pos() };
}

// ---------------------------------------------------------------------------
// type-mapper
// ---------------------------------------------------------------------------

describe("mapType", () => {
  test("string primitive", () => expect(mapType(primitiveType("string"))).toBe("string"));
  test("number primitive", () => expect(mapType(primitiveType("number"))).toBe("number"));
  test("boolean primitive", () => expect(mapType(primitiveType("boolean"))).toBe("boolean"));
  test("date primitive maps to string", () => expect(mapType(primitiveType("date"))).toBe("string"));

  test("enum type produces union", () => {
    expect(mapType(enumType(["a", "b", "c"]))).toBe('"a" | "b" | "c"');
  });

  test("enum with single value", () => {
    expect(mapType(enumType(["only"]))).toBe('"only"');
  });

  test("struct type produces inline interface", () => {
    const result = mapType(structType([{ name: "x", type: primitiveType("number") }]));
    expect(result).toContain("x: number");
  });

  test("type reference uses name directly", () => {
    expect(mapType(typeRef("Category"))).toBe("Category");
  });

  test("toPascalCase single word", () => expect(toPascalCase("greet")).toBe("Greet"));
  test("toPascalCase snake_case", () => expect(toPascalCase("classify_ticket")).toBe("ClassifyTicket"));
  test("toPascalCase multi segment", () => expect(toPascalCase("summarize_and_translate")).toBe("SummarizeAndTranslate"));
  test("toConstName", () => expect(toConstName("Category")).toBe("CATEGORY_VALUES"));
});

// ---------------------------------------------------------------------------
// template-compiler
// ---------------------------------------------------------------------------

describe("compileStringLiteral", () => {
  test("non-template plain string becomes template literal", () => {
    const result = compileStringLiteral("Hello world", false, new Set());
    expect(result).toBe("`Hello world`");
  });

  test("template string replaces {{var}} with ${input.var}", () => {
    const result = compileStringLiteral("Hello {{name}}", true, new Set(["name"]));
    expect(result).toBe("`Hello ${input.name}`");
  });

  test("template with multiple variables", () => {
    const result = compileStringLiteral("{{a}} and {{b}}", true, new Set(["a", "b"]));
    expect(result).toBe("`${input.a} and ${input.b}`");
  });

  test("backticks in string are escaped", () => {
    const result = compileStringLiteral("say `hi`", false, new Set());
    expect(result).toBe("`say \\`hi\\``");
  });

  test("dollar signs before braces are escaped", () => {
    const result = compileStringLiteral("price: ${100}", false, new Set());
    expect(result).toContain("\\${100}");
  });

  test("backslashes in string are escaped", () => {
    const result = compileStringLiteral("path\\to\\file", false, new Set());
    expect(result).toContain("path\\\\to\\\\file");
  });

  test("unknown template variable throws CompilerError", () => {
    expect(() =>
      compileStringLiteral("Hello {{unknown}}", true, new Set(["name"]))
    ).toThrow(CompilerError);
  });

  test("unknown template variable error message is informative", () => {
    try {
      compileStringLiteral("{{bad}}", true, new Set());
    } catch (e) {
      expect((e as Error).message).toContain("{{bad}}");
    }
  });

  test("extractTemplateVars extracts all variable names", () => {
    expect(extractTemplateVars("{{a}} text {{b}} more {{c}}")).toEqual(["a", "b", "c"]);
  });

  test("extractTemplateVars on non-template string returns empty array", () => {
    expect(extractTemplateVars("no variables here")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CompilerError
// ---------------------------------------------------------------------------

describe("CompilerError", () => {
  test("has name CompilerError", () => {
    const e = new CompilerError("bad");
    expect(e.name).toBe("CompilerError");
  });

  test("carries optional line/column", () => {
    const e = new CompilerError("msg", 5, 10);
    expect(e.line).toBe(5);
    expect(e.column).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// compile() — unit tests via parse
// ---------------------------------------------------------------------------

describe("compile — header", () => {
  test("header contains AUTO-GENERATED", () => {
    const ast = parseSource(`prompt hello() -> string { user: "hi" output: string }`);
    const out = compile(ast, "hello.prompt");
    expect(out).toContain("AUTO-GENERATED");
  });

  test("header contains source filename", () => {
    const ast = parseSource(`prompt hello() -> string { user: "hi" output: string }`);
    const out = compile(ast, "my-file.prompt");
    expect(out).toContain("my-file.prompt");
  });

  test("header contains ISO timestamp", () => {
    const ast = parseSource(`prompt hello() -> string { user: "hi" output: string }`);
    const out = compile(ast, "x.prompt");
    expect(out).toMatch(/Generated at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("header contains PromptLang version", () => {
    const ast = parseSource(`prompt hello() -> string { user: "hi" output: string }`);
    const out = compile(ast, "x.prompt");
    expect(out).toMatch(/PromptLang v\d+\.\d+/);
  });

  test("runtime import is present", () => {
    const ast = parseSource(`prompt hello() -> string { user: "hi" output: string }`);
    const out = compile(ast, "x.prompt");
    expect(out).toContain(`from "promptlang/runtime"`);
  });

  test("import uses 'import type'", () => {
    const ast = parseSource(`prompt hello() -> string { user: "hi" output: string }`);
    const out = compile(ast, "x.prompt");
    expect(out).toContain("import type");
  });
});

describe("compile — types", () => {
  test("enum type produces union type alias", () => {
    const ast = parseSource(`type Status = enum { ok, error }`);
    const out = compile(ast, "x.prompt");
    expect(out).toContain(`export type Status = "ok" | "error";`);
  });

  test("enum type produces VALUES array", () => {
    const ast = parseSource(`type Status = enum { ok, error }`);
    const out = compile(ast, "x.prompt");
    expect(out).toContain(`STATUS_VALUES`);
    expect(out).toContain(`"ok"`);
    expect(out).toContain(`"error"`);
  });

  test("struct type produces interface", () => {
    const ast = parseSource(`type Invoice = struct { amount: number currency: string }`);
    const out = compile(ast, "x.prompt");
    expect(out).toContain("export interface Invoice");
    expect(out).toContain("amount: number");
    expect(out).toContain("currency: string");
  });

  test("struct type with optional field uses ?", () => {
    const ast = parseSource(`type T = struct { required: string optional?: number }`);
    const out = compile(ast, "x.prompt");
    expect(out).toContain("optional?: number");
  });

  test("types section header appears", () => {
    const ast = parseSource(`type X = enum { a }`);
    const out = compile(ast, "x.prompt");
    expect(out).toContain("---- Types ----");
  });
});

describe("compile — prompt declarations", () => {
  test("prompt with no params generates empty interface", () => {
    const src = `prompt greet() -> string { user: "hello" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("export interface GreetInput {}");
  });

  test("prompt with one param generates interface field", () => {
    const src = `prompt greet(name: string) -> string { user: "hi {{name}}" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("name: string");
  });

  test("prompt with multiple params all appear in interface", () => {
    const src = `prompt f(a: string, b: number) -> string { user: "{{a}} {{b}}" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("a: string");
    expect(out).toContain("b: number");
  });

  test("prompt meta const is generated", () => {
    const src = `@model claude-opus-4.7\nprompt f() -> string { user: "x" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("f_meta");
    expect(out).toContain("as const");
  });

  test("meta const includes model", () => {
    const src = `@model gpt-4o\nprompt f() -> string { user: "x" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain(`"gpt-4o"`);
  });

  test("meta const includes temperature", () => {
    const src = `@temperature 0.5\nprompt f() -> string { user: "x" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("0.5");
  });

  test("meta const includes version", () => {
    const src = `@version "2.0.0"\nprompt f() -> string { user: "x" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain(`"2.0.0"`);
  });

  test("async function is exported", () => {
    const src = `prompt greet(name: string) -> string { user: "hi {{name}}" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("export async function greet");
  });

  test("function takes client parameter", () => {
    const src = `prompt f() -> string { user: "x" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("client: PromptClient");
  });

  test("function returns Promise of return type", () => {
    const src = `prompt f() -> string { user: "x" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("Promise<string>");
  });

  test("system section appears in messages", () => {
    const src = `prompt f() -> string { system: "be helpful" user: "x" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain(`role: "system"`);
    expect(out).toContain("be helpful");
  });

  test("user section appears in messages", () => {
    const src = `prompt f() -> string { user: "the question" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain(`role: "user"`);
    expect(out).toContain("the question");
  });

  test("template variable in user section interpolated", () => {
    const src = `prompt f(q: string) -> string { user: "Answer: {{q}}" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("${input.q}");
  });

  test("enum return type generates validation", () => {
    const src = `
      type Cat = enum { bug, other }
      prompt classify(t: string) -> Cat { user: "{{t}}" output: Cat }
    `;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("CAT_VALUES");
    expect(out).toContain("includes(raw as Cat)");
  });

  test("struct return type generates JSON.parse validation", () => {
    const src = `
      type Info = struct { name: string }
      prompt get_info(q: string) -> Info { user: "{{q}}" output: Info }
    `;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("JSON.parse");
  });

  test("string return type returns raw directly", () => {
    const src = `prompt f() -> string { user: "x" output: string }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("return raw");
  });

  test("number return type generates numeric validation", () => {
    const src = `prompt f() -> number { user: "x" output: number }`;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("Number(raw)");
    expect(out).toContain("isNaN");
  });
});

describe("compile — multiple declarations in one file", () => {
  test("two prompts both appear in output", () => {
    const src = `
      prompt a() -> string { user: "a" output: string }
      prompt b() -> string { user: "b" output: string }
    `;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("async function a");
    expect(out).toContain("async function b");
  });

  test("type and prompt both appear", () => {
    const src = `
      type Status = enum { ok }
      prompt check() -> Status { user: "x" output: Status }
    `;
    const out = compile(parseSource(src), "x.prompt");
    expect(out).toContain("export type Status");
    expect(out).toContain("async function check");
  });
});

describe("compile — classify-ticket.prompt (integration)", () => {
  test("compiles classify-ticket without throwing", async () => {
    const source = await Bun.file("docs/examples/classify-ticket.prompt").text();
    const ast = parse(tokenize(source));
    expect(() => compile(ast, "classify-ticket.prompt")).not.toThrow();
  });

  test("output contains Category type", async () => {
    const source = await Bun.file("docs/examples/classify-ticket.prompt").text();
    const ast = parse(tokenize(source));
    const out = compile(ast, "classify-ticket.prompt");
    expect(out).toContain("export type Category");
  });

  test("output contains classify_ticket function", async () => {
    const source = await Bun.file("docs/examples/classify-ticket.prompt").text();
    const ast = parse(tokenize(source));
    const out = compile(ast, "classify-ticket.prompt");
    expect(out).toContain("async function classify_ticket");
  });

  test("output contains CATEGORY_VALUES for enum validation", async () => {
    const source = await Bun.file("docs/examples/classify-ticket.prompt").text();
    const ast = parse(tokenize(source));
    const out = compile(ast, "classify-ticket.prompt");
    expect(out).toContain("CATEGORY_VALUES");
  });

  test("output contains ticket interpolation", async () => {
    const source = await Bun.file("docs/examples/classify-ticket.prompt").text();
    const ast = parse(tokenize(source));
    const out = compile(ast, "classify-ticket.prompt");
    expect(out).toContain("input.ticket");
  });

  test("compiles extract-invoice without throwing", async () => {
    const source = await Bun.file("docs/examples/extract-invoice.prompt").text();
    const ast = parse(tokenize(source));
    expect(() => compile(ast, "extract-invoice.prompt")).not.toThrow();
  });

  test("extract-invoice output contains interface ExtractedInvoice", async () => {
    const source = await Bun.file("docs/examples/extract-invoice.prompt").text();
    const ast = parse(tokenize(source));
    const out = compile(ast, "extract-invoice.prompt");
    expect(out).toContain("interface ExtractedInvoice");
  });

  test("extract-invoice output uses JSON.parse for struct validation", async () => {
    const source = await Bun.file("docs/examples/extract-invoice.prompt").text();
    const ast = parse(tokenize(source));
    const out = compile(ast, "extract-invoice.prompt");
    expect(out).toContain("JSON.parse");
  });
});

// ---------------------------------------------------------------------------
// Integration: generated TypeScript compiles with tsc
//
// HONESTY NOTE: Generated files import from "promptlang/runtime". This
// module resolves only when a paths mapping is active or the package is
// installed via npm (v1.0+). The tests below explicitly document both
// the success path (with explicit paths) and the expected failure path
// (in isolation without paths).
// ---------------------------------------------------------------------------

const TMP_DIR = "./tmp-test-output";

// Relative path from TMP_DIR to the local runtime source.
// Used in explicit tsconfig paths so the test does not inherit from the
// project tsconfig — which would be a faux positif.
const RUNTIME_REL = relative(
  join(process.cwd(), TMP_DIR),
  join(process.cwd(), "src/runtime/index.ts")
);

function makeExplicitTsconfig(runtimeRelPath: string): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        skipLibCheck: true,
        baseUrl: ".",
        paths: { "promptlang/runtime": [runtimeRelPath] },
      },
      include: ["*.ts"],
    },
    null,
    2
  );
}

function makeIsolationTsconfig(): string {
  // Uses moduleResolution "node" (no `exports` field support) to simulate a
  // user who has NOT installed promptlang via npm. With "bundler" resolution,
  // tsc would find the package via the self-referencing exports field in the
  // local package.json — which is NOT what an external consumer experiences.
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "node",
        strict: true,
        noUnusedLocals: false,
        noUnusedParameters: false,
        skipLibCheck: true,
      },
      include: ["*.ts"],
    },
    null,
    2
  );
}

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("compile — tsc integration (within project, explicit paths mapping)", () => {
  test("generated code compiles within a project with promptlang paths mapping (classify-ticket)", async () => {
    const source = await Bun.file("docs/examples/classify-ticket.prompt").text();
    const ast = parse(tokenize(source));
    const generated = compile(ast, "classify-ticket.prompt");

    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(join(TMP_DIR, "classify-ticket.ts"), generated);
    await writeFile(join(TMP_DIR, "tsconfig.json"), makeExplicitTsconfig(RUNTIME_REL));

    const proc = Bun.spawn(
      [process.execPath, "x", "tsc", "--project", join(TMP_DIR, "tsconfig.json"), "--noEmit"],
      { cwd: process.cwd(), stderr: "pipe" }
    );
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("generated code compiles within a project with promptlang paths mapping (extract-invoice)", async () => {
    const source = await Bun.file("docs/examples/extract-invoice.prompt").text();
    const ast = parse(tokenize(source));
    const generated = compile(ast, "extract-invoice.prompt");

    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(join(TMP_DIR, "extract-invoice.ts"), generated);
    await writeFile(join(TMP_DIR, "tsconfig.json"), makeExplicitTsconfig(RUNTIME_REL));

    const proc = Bun.spawn(
      [process.execPath, "x", "tsc", "--project", join(TMP_DIR, "tsconfig.json"), "--noEmit"],
      { cwd: process.cwd(), stderr: "pipe" }
    );
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

describe("compile — tsc integration (isolation, documented limitation)", () => {
  test("generated code fails cleanly in isolation without paths mapping (documented limitation)", async () => {
    // This test documents the expected behaviour: outside a project that has
    // promptlang installed (or a paths mapping configured), tsc cannot resolve
    // "promptlang/runtime". This is a known alpha limitation, not a bug in the
    // generated code. Use --emit-tsconfig on the CLI or add a paths entry to your
    // own tsconfig to work around it until v1.0 npm publication.
    const source = await Bun.file("docs/examples/classify-ticket.prompt").text();
    const ast = parse(tokenize(source));
    const generated = compile(ast, "classify-ticket.prompt");

    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(join(TMP_DIR, "classify-ticket.ts"), generated);
    await writeFile(join(TMP_DIR, "tsconfig.json"), makeIsolationTsconfig());

    // tsc writes errors to stdout (not stderr).
    const proc = Bun.spawn(
      [process.execPath, "x", "tsc", "--project", join(TMP_DIR, "tsconfig.json"), "--noEmit"],
      { cwd: process.cwd(), stdout: "pipe" }
    );
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    // Must fail with TS2307 — this is the documented expected behaviour.
    expect(exitCode).not.toBe(0);
    expect(stdout).toContain("TS2307");
    expect(stdout).toContain("promptlang/runtime");
  });
});
