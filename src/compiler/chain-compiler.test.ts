import { describe, test, expect, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { compile } from "./compiler";
import { CompilerError } from "./errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSource(src: string) {
  return parse(tokenize(src));
}

function compileSource(src: string) {
  return compile(parseSource(src), "x.prompt");
}

// Two-prompt chain fixture: summarize(text) → translate(text, target_lang)
// Uses positional args so we can test positional resolution.
const SIMPLE_TWO_PROMPT = `
  prompt summarize(text: string) -> string {
    user: "Summarize: {{text}}"
    output: string
  }
  prompt translate(text: string, target_lang: string) -> string {
    user: "Translate to {{target_lang}}: {{text}}"
    output: string
  }
`;

// ---------------------------------------------------------------------------
// 1. Chain with 1 step that returns the chain param (not the step result)
// ---------------------------------------------------------------------------

describe("chain — 1 step, return chain param directly", () => {
  test("return chain param produces input.xxx (not the step variable)", () => {
    const src = `
      prompt identity(val: string) -> string { user: "{{val}}" output: string }
      chain pass_through(value: string) -> string {
        step _ignored = identity(val: value)
        return value
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("async function pass_through");
    expect(out).toContain("return input.value");
  });
});

// ---------------------------------------------------------------------------
// 2. Chain with 1 step + return the step result
// ---------------------------------------------------------------------------

describe("chain — 1 step, return step", () => {
  test("step becomes a const await call", () => {
    const src = `
      ${SIMPLE_TWO_PROMPT}
      chain just_summarize(article: string) -> string {
        step summary = summarize(text: article)
        return summary
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("const summary = await summarize(");
    expect(out).toContain("return summary");
  });

  test("step args include input. prefix for chain params", () => {
    const src = `
      ${SIMPLE_TWO_PROMPT}
      chain just_summarize(article: string) -> string {
        step summary = summarize(text: article)
        return summary
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("input.article");
  });
});

// ---------------------------------------------------------------------------
// 3. Chain with 2 steps chained (named args)
// ---------------------------------------------------------------------------

describe("chain — 2 steps with named args", () => {
  test("both steps appear as const awaits", () => {
    const src = `
      ${SIMPLE_TWO_PROMPT}
      chain summarize_and_translate(article: string, target: string) -> string {
        step summary = summarize(text: article)
        step translated = translate(text: summary, target_lang: target)
        return translated
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("const summary = await summarize(");
    expect(out).toContain("const translated = await translate(");
    expect(out).toContain("return translated");
  });

  test("second step receives output of first step (not prefixed with input.)", () => {
    const src = `
      ${SIMPLE_TWO_PROMPT}
      chain summarize_and_translate(article: string, target: string) -> string {
        step summary = summarize(text: article)
        step translated = translate(text: summary, target_lang: target)
        return translated
      }
    `;
    const out = compileSource(src);
    // summary is a step variable, should appear without "input."
    expect(out).toContain("text: summary");
  });
});

// ---------------------------------------------------------------------------
// 4. Chain with 3 steps
// ---------------------------------------------------------------------------

describe("chain — 3 steps", () => {
  test("three const awaits appear in order", () => {
    const src = `
      prompt a(x: string) -> string { user: "{{x}}" output: string }
      prompt b(x: string) -> string { user: "{{x}}" output: string }
      prompt c(x: string) -> string { user: "{{x}}" output: string }
      chain pipeline(input_val: string) -> string {
        step r1 = a(x: input_val)
        step r2 = b(x: r1)
        step r3 = c(x: r2)
        return r3
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("const r1 = await a(");
    expect(out).toContain("const r2 = await b(");
    expect(out).toContain("const r3 = await c(");
    expect(out).toContain("return r3");
  });
});

// ---------------------------------------------------------------------------
// 5. Named args compile to object notation
// ---------------------------------------------------------------------------

describe("chain — named args", () => {
  test("named args produce { key: value } object", () => {
    const src = `
      ${SIMPLE_TWO_PROMPT}
      chain named_demo(doc: string, lang: string) -> string {
        step s = translate(text: doc, target_lang: lang)
        return s
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("{ text: input.doc, target_lang: input.lang }");
  });
});

// ---------------------------------------------------------------------------
// 6. Positional args (single)
// ---------------------------------------------------------------------------

describe("chain — positional args (1 arg)", () => {
  test("positional arg maps to first param of callee", () => {
    const src = `
      ${SIMPLE_TWO_PROMPT}
      chain positional_demo(article: string) -> string {
        step s = summarize(article)
        return s
      }
    `;
    const out = compileSource(src);
    // 'text' is the first param of summarize
    expect(out).toContain("{ text: input.article }");
  });
});

// ---------------------------------------------------------------------------
// 7. Positional args with step reference
// ---------------------------------------------------------------------------

describe("chain — positional args (2 args, step + param)", () => {
  test("positional args map step result and chain param to named object", () => {
    const src = `
      ${SIMPLE_TWO_PROMPT}
      chain full_chain(article: string, target: string) -> string {
        step summary = summarize(article)
        step translated = translate(summary, target)
        return translated
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("{ text: input.article }");
    // summary is a step var (no input. prefix), target is a param (input. prefix)
    expect(out).toContain("{ text: summary, target_lang: input.target }");
  });
});

// ---------------------------------------------------------------------------
// 8. Param referenced in multiple steps
// ---------------------------------------------------------------------------

describe("chain — param referenced multiple times", () => {
  test("same chain param appears as input.x in every step that uses it", () => {
    const src = `
      prompt echo(val: string) -> string { user: "{{val}}" output: string }
      chain multi_use(x: string) -> string {
        step a = echo(val: x)
        step b = echo(val: x)
        return b
      }
    `;
    const out = compileSource(src);
    const matches = [...out.matchAll(/input\.x/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 9. Step result referenced in multiple following steps
// ---------------------------------------------------------------------------

describe("chain — step result referenced multiple times", () => {
  test("step variable appears without input. prefix in each usage", () => {
    const src = `
      prompt echo(val: string) -> string { user: "{{val}}" output: string }
      prompt combine(a: string, b: string) -> string { user: "{{a}} {{b}}" output: string }
      chain fan_out(x: string) -> string {
        step base = echo(val: x)
        step combined = combine(a: base, b: base)
        return combined
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("a: base, b: base");
  });
});

// ---------------------------------------------------------------------------
// 10. Return chain param directly (not a step), chain has 1 step
// ---------------------------------------------------------------------------

describe("chain — return param directly (with a step present)", () => {
  test("return param produces return input.xxx (not the step variable)", () => {
    const src = `
      prompt noop(x: string) -> string { user: "{{x}}" output: string }
      chain identity_chain(val: string) -> string {
        step _r = noop(x: val)
        return val
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("return input.val");
    expect(out).not.toContain("return input._r");
  });
});

// ---------------------------------------------------------------------------
// 11. Return step result
// ---------------------------------------------------------------------------

describe("chain — return step result", () => {
  test("return step produces bare variable name (no input. prefix)", () => {
    const src = `
      prompt proc(x: string) -> string { user: "{{x}}" output: string }
      chain process(val: string) -> string {
        step result = proc(x: val)
        return result
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("return result");
    expect(out).not.toContain("return input.result");
  });
});

// ---------------------------------------------------------------------------
// 12–14. Input interface and function signature
// ---------------------------------------------------------------------------

describe("chain — generated interface and signature", () => {
  const CHAIN_FIXTURE = `
    prompt f(x: string) -> string { user: "{{x}}" output: string }
    chain my_chain(x: string) -> string {
      step r = f(x: x)
      return r
    }
  `;

  test("generates PascalCase input interface", () => {
    expect(compileSource(CHAIN_FIXTURE)).toContain("export interface MyChainInput");
  });

  test("function is async and exported", () => {
    expect(compileSource(CHAIN_FIXTURE)).toContain("export async function my_chain");
  });

  test("function takes PromptClient parameter", () => {
    expect(compileSource(CHAIN_FIXTURE)).toContain("client: PromptClient");
  });

  test("function returns Promise of correct type", () => {
    expect(compileSource(CHAIN_FIXTURE)).toContain("Promise<string>");
  });

  test("chain with no params generates empty interface", () => {
    const src = `
      prompt greet() -> string { user: "hi" output: string }
      chain no_params() -> string {
        step r = greet()
        return r
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("export interface NoParamsInput {}");
  });
});

// ---------------------------------------------------------------------------
// 16. Return type variations
// ---------------------------------------------------------------------------

describe("chain — return type variations", () => {
  test("string return type produces Promise<string>", () => {
    const src = `
      prompt f(x: string) -> string { user: "{{x}}" output: string }
      chain c(x: string) -> string {
        step r = f(x: x)
        return r
      }
    `;
    expect(compileSource(src)).toContain("Promise<string>");
  });

  test("number return type produces Promise<number>", () => {
    const src = `
      prompt f(x: string) -> number { user: "{{x}}" output: number }
      chain c(x: string) -> number {
        step r = f(x: x)
        return r
      }
    `;
    expect(compileSource(src)).toContain("Promise<number>");
  });

  test("struct return type produces Promise<StructName>", () => {
    const src = `
      type Info = struct { name: string }
      prompt get(q: string) -> Info { user: "{{q}}" output: Info }
      chain fetch_info(q: string) -> Info {
        step r = get(q: q)
        return r
      }
    `;
    expect(compileSource(src)).toContain("Promise<Info>");
  });

  test("enum return type produces Promise<TypeName>", () => {
    const src = `
      type Cat = enum { bug, feature }
      prompt classify(t: string) -> Cat { user: "{{t}}" output: Cat }
      chain classify_chain(t: string) -> Cat {
        step r = classify(t: t)
        return r
      }
    `;
    // Named type reference → stays as 'Cat', not expanded to the union
    expect(compileSource(src)).toContain("Promise<Cat>");
  });
});

// ---------------------------------------------------------------------------
// 20. Multiple chains in one file
// ---------------------------------------------------------------------------

describe("chain — multiple chains in same file", () => {
  test("both chains appear in output", () => {
    const src = `
      prompt f(x: string) -> string { user: "{{x}}" output: string }
      chain chain_a(x: string) -> string {
        step r = f(x: x)
        return r
      }
      chain chain_b(x: string) -> string {
        step r = f(x: x)
        return r
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("async function chain_a");
    expect(out).toContain("async function chain_b");
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe("chain — errors: undefined identifiers", () => {
  test("step referencing undefined var throws CompilerError", () => {
    const src = `
      prompt f(x: string) -> string { user: "{{x}}" output: string }
      chain bad(x: string) -> string {
        step r = f(x: nonexistent)
        return r
      }
    `;
    expect(() => compileSource(src)).toThrow(CompilerError);
  });

  test("error message names the chain and the undefined identifier", () => {
    const src = `
      prompt f(x: string) -> string { user: "{{x}}" output: string }
      chain bad_chain(x: string) -> string {
        step r = f(x: nonexistent)
        return r
      }
    `;
    try {
      compileSource(src);
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect((e as Error).message).toContain("bad_chain");
      expect((e as Error).message).toContain("nonexistent");
    }
  });

  test("return referencing undefined throws CompilerError", () => {
    const src = `
      prompt f(x: string) -> string { user: "{{x}}" output: string }
      chain bad(x: string) -> string {
        step r = f(x: x)
        return undefined_var
      }
    `;
    expect(() => compileSource(src)).toThrow(CompilerError);
  });
});

describe("chain — errors: forward references", () => {
  test("step referencing later-defined step throws CompilerError", () => {
    const src = `
      prompt f(x: string) -> string { user: "{{x}}" output: string }
      chain forward_ref(x: string) -> string {
        step a = f(x: b)
        step b = f(x: x)
        return a
      }
    `;
    expect(() => compileSource(src)).toThrow(CompilerError);
  });

  test("forward reference error message says 'defined later'", () => {
    const src = `
      prompt f(x: string) -> string { user: "{{x}}" output: string }
      chain forward_ref(x: string) -> string {
        step a = f(x: b)
        step b = f(x: x)
        return a
      }
    `;
    try {
      compileSource(src);
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain("defined later");
    }
  });
});

describe("chain — errors: unknown callee with positional args", () => {
  test("calling unknown function with positional args throws CompilerError", () => {
    const src = `
      chain orphan(x: string) -> string {
        step r = unknown_prompt(x)
        return r
      }
    `;
    expect(() => compileSource(src)).toThrow(CompilerError);
  });
});

// ---------------------------------------------------------------------------
// Section headers
// ---------------------------------------------------------------------------

describe("compiler — section headers", () => {
  const HEADER_FIXTURE = `
    prompt f(x: string) -> string { user: "{{x}}" output: string }
    chain c(x: string) -> string {
      step r = f(x: x)
      return r
    }
  `;

  test("chain section has '---- Chain ----' header", () => {
    expect(compileSource(HEADER_FIXTURE)).toContain("---- Chain ----");
  });

  test("prompts still appear under '---- Prompt definitions ----'", () => {
    expect(compileSource(HEADER_FIXTURE)).toContain("---- Prompt definitions ----");
  });

  test("chain section appears AFTER prompt definitions section", () => {
    const out = compileSource(HEADER_FIXTURE);
    const promptIdx = out.indexOf("---- Prompt definitions ----");
    const chainIdx = out.indexOf("---- Chain ----");
    expect(chainIdx).toBeGreaterThan(promptIdx);
  });

  test("file with only chains (no prompt declarations) gets Chain section but not Prompt definitions", () => {
    // Named args skip the callable-registry lookup, so two chains can call each
    // other without requiring prompts in the file.
    const src = `
      chain a(x: string) -> string {
        step r = b(val: x)
        return r
      }
      chain b(y: string) -> string {
        step r = a(val: y)
        return r
      }
    `;
    const out = compileSource(src);
    expect(out).toContain("---- Chain ----");
    expect(out).not.toContain("---- Prompt definitions ----");
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

const TMP_DIR = join(process.cwd(), "tmp-chain-test");

// Relative path from TMP_DIR to the runtime source — used in an explicit
// tsconfig so the test does NOT inherit from the project tsconfig (faux positif).
const RUNTIME_REL = relative(TMP_DIR, join(process.cwd(), "src/runtime/index.ts"));

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("chain — integration: summarize-and-translate.prompt", () => {
  test("compiles without throwing", async () => {
    const source = await Bun.file("docs/examples/summarize-and-translate.prompt").text();
    const ast = parse(tokenize(source));
    expect(() => compile(ast, "summarize-and-translate.prompt")).not.toThrow();
  });

  test("output contains SummarizeAndTranslateInput interface", async () => {
    const source = await Bun.file("docs/examples/summarize-and-translate.prompt").text();
    const ast = parse(tokenize(source));
    const out = compile(ast, "summarize-and-translate.prompt");
    expect(out).toContain("SummarizeAndTranslateInput");
  });

  test("output contains summarize_and_translate async function", async () => {
    const source = await Bun.file("docs/examples/summarize-and-translate.prompt").text();
    const ast = parse(tokenize(source));
    const out = compile(ast, "summarize-and-translate.prompt");
    expect(out).toContain("async function summarize_and_translate");
  });

  test("chain steps are awaited in output", async () => {
    const source = await Bun.file("docs/examples/summarize-and-translate.prompt").text();
    const ast = parse(tokenize(source));
    const out = compile(ast, "summarize-and-translate.prompt");
    expect(out).toContain("await summarize(");
    expect(out).toContain("await translate(");
  });

  test("generated code compiles within a project with promptlang paths mapping", async () => {
    // Uses an explicit paths mapping (not extends from parent tsconfig) to honestly
    // verify that the generated chain code is syntactically valid TypeScript.
    const source = await Bun.file("docs/examples/summarize-and-translate.prompt").text();
    const ast = parse(tokenize(source));
    const generated = compile(ast, "summarize-and-translate.prompt");

    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(join(TMP_DIR, "summarize-and-translate.ts"), generated);
    await writeFile(
      join(TMP_DIR, "tsconfig.json"),
      JSON.stringify(
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
            paths: { "promptlang/runtime": [RUNTIME_REL] },
          },
          include: ["*.ts"],
        },
        null,
        2
      )
    );

    const proc = Bun.spawn(
      [process.execPath, "x", "tsc", "--project", join(TMP_DIR, "tsconfig.json"), "--noEmit"],
      { cwd: process.cwd(), stderr: "pipe" }
    );
    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("end-to-end: compiled chain executes correctly with MockClient", async () => {
    const source = await Bun.file("docs/examples/summarize-and-translate.prompt").text();
    const ast = parse(tokenize(source));
    const generated = compile(ast, "summarize-and-translate.prompt");

    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(join(TMP_DIR, "generated.ts"), generated);

    const runner = `
import { summarize_and_translate } from "./generated.ts";
import { MockClient } from "promptlang/runtime";

const client = new MockClient([
  { content: "This is a short summary.", usage: { input_tokens: 5, output_tokens: 5 } },
  { content: "Voici un résumé court.", usage: { input_tokens: 5, output_tokens: 5 } },
]);

const result = await summarize_and_translate(
  { document: "Long article text...", max_words: 30, target_language: "french" },
  client
);
console.log(result);
`;
    await writeFile(join(TMP_DIR, "runner.ts"), runner);

    const proc = Bun.spawn(
      [process.execPath, "run", join(TMP_DIR, "runner.ts")],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("Voici un résumé court.");
  });
});
