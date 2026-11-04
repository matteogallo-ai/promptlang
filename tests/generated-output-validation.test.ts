import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "../src/compiler/compiler";
import { compilePython } from "../src/compiler/python/python-compiler";
import { getPythonRuntimeSource } from "../src/compiler/python/python-runtime-template";
import { tokenize } from "../src/lexer/lexer";
import { parse } from "../src/parser/parser";
import { InvalidOutputError, MockClient } from "../src/runtime";
import { importCompiled } from "../src/testing/load-compiled";

const SOURCE = `@version "1.0.0"
type Invoice = struct {
  amount: number
  vendor: string
  number?: string
}
type Kind = enum { bug, other }
type Node = struct {
  v: number
  next?: Node
}
prompt invoice(x: string) -> Invoice {
  user: "<t>{{x}}</t>"
}
prompt kind(x: string) -> Kind {
  user: "<t>{{x}}</t>"
}
prompt count(x: string) -> number {
  user: "<t>{{x}}</t>"
}
prompt flag(x: string) -> boolean {
  user: "<t>{{x}}</t>"
}
prompt chain_of(x: string) -> Node {
  user: "<t>{{x}}</t>"
}
prompt due(x: string) -> date {
  user: "<t>{{x}}</t>"
}
prompt parse_output(x: string) -> number {
  user: "<t>{{x}}</t>"
}
prompt count_output(x: string) -> number {
  user: "<t>{{x}}</t>"
}
prompt _json(x: string) -> Invoice {
  user: "<t>{{x}}</t>"
}
`;

type Call = (input: { x: string }, client: MockClient) => Promise<unknown>;
// The last three are named after what the generated code imports or declares.
type Module = Record<
  | "invoice"
  | "kind"
  | "count"
  | "flag"
  | "chain_of"
  | "due"
  | "parse_output"
  | "count_output"
  | "_json",
  Call
>;

const program = parse(tokenize(SOURCE));
const mod = importCompiled<Module>(compile(program, "out.prompt"));

const NESTED_50 = `${'{"v": 1, "next": '.repeat(50)}{"v": "x"}${"}".repeat(50)}`;
const DEEP = `${'{"v": 1, "next": '.repeat(100_000)}{"v": 1}${"}".repeat(100_000)}`;

async function run(name: keyof Module, output: string): Promise<unknown> {
  return (await mod)[name]({ x: "in" }, new MockClient(() => ({ content: output })));
}

async function failure(name: keyof Module, output: string): Promise<InvalidOutputError> {
  const error = await run(name, output).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(InvalidOutputError);
  return error as InvalidOutputError;
}

describe("generated code validates the model's output against the declared type", () => {
  test("a conforming struct is returned; an optional field may be absent", async () => {
    expect(await run("invoice", '{"amount": 12.5, "vendor": "Acme"}')).toEqual({
      amount: 12.5,
      vendor: "Acme",
    });
  });

  // The audit's case: the cast let a string amount and an extra field through.
  test("a field of the wrong type or a field not declared is an InvalidOutputError", async () => {
    const e = await failure("invoice", '{"amount": "not a number", "vendor": "A", "hacked": true}');
    expect(e.prompt).toBe("invoice");
    expect(e.errors).toEqual([
      "output.amount: expected number, got a string",
      "output: 1 field not in the declared type",
    ]);
  });

  // Model output is untrusted and may hold user data: it stays off the message, which reaches logs.
  test("the message names the mismatches but not the output; the output is on the error", async () => {
    const raw = '{"amount": "SECRET-1234", "vendor": "A"}';
    const e = await failure("invoice", raw);
    expect(e.message).toBe(
      "output of prompt 'invoice' does not match its type: output.amount: expected number, got a string"
    );
    expect(e.message).not.toContain("SECRET");
    expect(e.output).toBe(raw);
  });

  test("JSON inside one code fence is read; anything else that is not JSON is an error", async () => {
    expect(await run("invoice", '```json\n{"amount": 1, "vendor": "A"}\n```')).toEqual({
      amount: 1,
      vendor: "A",
    });
    expect((await failure("invoice", "Sure! Here it is: {")).errors).toEqual([
      "output: not valid JSON",
    ]);
  });

  test("a recursive type is checked at every depth", async () => {
    expect(await run("chain_of", '{"v": 1, "next": {"v": 2}}')).toEqual({ v: 1, next: { v: 2 } });
    expect((await failure("chain_of", NESTED_50)).errors).toEqual([
      `output${".next".repeat(50)}.v: expected number, got a string`,
    ]);
  });

  // A field name comes from the model: in a message it could forge a log line or fill the log.
  test("an undeclared field is counted, never named, and the message stays short", async () => {
    const e = await failure(
      "invoice",
      `{"amount": 1, "vendor": "A", "x\\nFORGED": 1, "${"k".repeat(10_000)}": 2}`
    );
    expect(e.errors).toEqual(["output: 2 fields not in the declared type"]);
  });

  // A recursive type lets one answer produce an error per level, each path longer than the last.
  test("an InvalidOutputError holds at most 10 errors of at most 500 characters", async () => {
    const wrongAtEveryLevel = `${'{"v": "x", "next": '.repeat(30)}{"v": "x"}${"}".repeat(30)}`;
    const many = await failure("chain_of", wrongAtEveryLevel);
    expect(many.errors).toHaveLength(11);
    expect(many.errors.at(-1)).toBe("output: 21 more mismatches");
    const deep = `${'{"v": 1, "next": '.repeat(200)}{"v": "x"}${"}".repeat(200)}`;
    const [long] = (await failure("chain_of", deep)).errors;
    expect(long).toHaveLength(500);
    expect(long).toStartWith("output.next.next");
    expect(long).toEndWith(".next.v: expected number, got a string");
  });

  // A hostile answer can nest a recursive type deeper than the call stack.
  test("an answer nested deeper than the checker can follow is an InvalidOutputError", async () => {
    const raw = DEEP;
    expect((await failure("chain_of", raw)).errors).toEqual(["output: nested too deeply to check"]);
  });

  test("a long run of digits that is not a number is refused in linear time", async () => {
    const started = performance.now();
    expect((await failure("count", `${"9".repeat(200_000)}x`)).errors).toEqual([
      "output: expected number, got a string",
    ]);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("a number is read from decimal notation only, a date must be a real day", async () => {
    expect(await run("count", "-1.5e3")).toBe(-1500);
    expect((await failure("count", "0x10")).errors).toEqual([
      "output: expected number, got a string",
    ]);
    expect(await run("due", "2024-02-29")).toBe("2024-02-29");
    expect((await failure("due", "2024-02-30")).errors).toEqual([
      "output: expected a YYYY-MM-DD date, got a string",
    ]);
  });

  test("enum, number and boolean outputs raise the same typed error", async () => {
    expect(await run("kind", "bug")).toBe("bug");
    expect((await failure("kind", "feature")).errors).toEqual([
      "output: expected one of bug, other, got a string",
    ]);
    expect(await run("count", "42")).toBe(42);
    expect((await failure("count", "forty-two")).errors).toEqual([
      "output: expected number, got a string",
    ]);
    expect(await run("flag", "TRUE")).toBe(true);
    expect((await failure("flag", "maybe")).errors).toEqual([
      "output: expected boolean, got a string",
    ]);
  });
});

/** Answers on which both languages must agree, value or errors and message alike. */
const CASES: Array<[keyof Module, string]> = [
  ["invoice", '{"amount": 12.5, "vendor": "Acme"}'],
  ["invoice", '{"amount": "SECRET-1234", "vendor": "A", "hacked": true}'],
  ["invoice", '{"vendor": null}'],
  ["invoice", '```json\n{"amount": 1, "vendor": "A"}\n```'],
  ["invoice", "Sure! Here it is: {"],
  ["invoice", '{"amount": NaN, "vendor": "A"}'],
  ["invoice", "[1, 2]"],
  ["chain_of", '{"v": 1, "next": {"v": "two"}}'],
  ["chain_of", DEEP],
  ["kind", "bug"],
  ["kind", "feature"],
  ["count", "42"],
  ["count", "-1.5e3"],
  ["count", "forty-two"],
  ["count", "0x10"],
  ["count", "1e999"],
  ["flag", "TRUE"],
  ["flag", "maybe"],
  ["due", "2024-02-29"],
  ["due", "2024-02-30"],
  ["due", "tomorrow"],
  ["due", "0000-01-01"],
  ["invoice", '{"amount": 1, "vendor": "A", "x\\nFORGED": 1}'],
  ["invoice", `{"amount": 1${"0".repeat(400)}, "vendor": "A"}`],
  ["invoice", '{"amount": 1e400, "vendor": "A"}'],
  ["invoice", '```json\r\n{"amount": 1, "vendor": "A"}\r\n```'],
  ["chain_of", NESTED_50],
  ["chain_of", `${'{"v": "x", "next": '.repeat(30)}{"v": "x"}${"}".repeat(30)}`],
  ["chain_of", `${'{"v": 1, "next": '.repeat(200)}{"v": "x"}${"}".repeat(200)}`],
  ["parse_output", "7"],
  ["count_output", "7"],
  ["_json", '{"amount": 1, "vendor": "A"}'],
  // Python's json.loads refuses integers over 4300 digits unless told how to read them.
  ["invoice", `{"amount": 1${"0".repeat(5_000)}, "vendor": "A"}`],
  ["count", `1${"0".repeat(5_000)}`],
  // Digits that are not a number: an ambiguous pattern took quadratic time on them.
  ["count", `${"9".repeat(200_000)}x`],
];

type Outcome = { value: unknown } | { errors: string[]; message: string };

const RUN_PY = `
import asyncio, json, sys
from pkg import out
from pkg.promptlang_runtime import InvalidOutputError, MockClient

results = []
for name, answer in json.load(open("cases.json")):
    try:
        value = asyncio.run(getattr(out, name)({"x": "in"}, MockClient([{"content": answer}])))
        results.append({"value": value})
    # A bad answer raised a plain ValueError before InvalidOutputError existed.
    except ValueError as e:
        if isinstance(e, InvalidOutputError):
            assert e.prompt == name and e.output == answer.strip()
        results.append({"errors": getattr(e, "errors", None), "message": str(e)})
json.dump(results, sys.stdout)
`;

describe("generated Python checks the answer exactly as generated TypeScript does", () => {
  let dir: string;
  let python: Outcome[];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "promptlang-output-"));
    await mkdir(join(dir, "pkg"));
    await writeFile(join(dir, "pkg", "__init__.py"), "");
    await writeFile(join(dir, "pkg", "promptlang_runtime.py"), getPythonRuntimeSource());
    await writeFile(join(dir, "pkg", "out.py"), compilePython(program, "out.prompt"));
    await writeFile(join(dir, "cases.json"), JSON.stringify(CASES));
    await writeFile(join(dir, "run.py"), RUN_PY);
    const r = Bun.spawnSync(["python3", "run.py"], { cwd: dir });
    if (r.exitCode !== 0) throw new Error(`python3 failed:\n${r.stderr.toString()}`);
    python = JSON.parse(r.stdout.toString());
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  for (const [i, [name, answer]] of CASES.entries()) {
    test(`${name}: ${answer.length > 40 ? `${answer.slice(0, 40)}...` : answer}`, async () => {
      const ts: Outcome = await run(name, answer).then(
        (value) => ({ value }),
        (e: InvalidOutputError) => ({ errors: [...e.errors], message: e.message })
      );
      expect(python[i]).toEqual(ts);
    });
  }
});

// TypeScript imports the runtime's parseOutput; a prompt of that name cannot share
// a file with parse_output, as both generate ParseOutputInput.
test("a prompt named parseOutput still checks its answer, in both languages", async () => {
  const source = `@version "1.0.0"\nprompt parseOutput(x: string) -> number {\n  user: "<t>{{x}}</t>"\n}\n`;
  const shadow = parse(tokenize(source));
  const ts = await importCompiled<{ parseOutput: Call }>(compile(shadow, "shadow.prompt"));
  const reply = (content: string) => new MockClient(() => ({ content }));
  expect(await ts.parseOutput({ x: "in" }, reply("7"))).toBe(7);
  expect(await ts.parseOutput({ x: "in" }, reply("seven")).catch((e) => e)).toBeInstanceOf(
    InvalidOutputError
  );
  const dir = await mkdtemp(join(tmpdir(), "promptlang-shadow-"));
  try {
    await mkdir(join(dir, "pkg"));
    await writeFile(join(dir, "pkg", "__init__.py"), "");
    await writeFile(join(dir, "pkg", "promptlang_runtime.py"), getPythonRuntimeSource());
    await writeFile(join(dir, "pkg", "shadow.py"), compilePython(shadow, "shadow.prompt"));
    const script = `
import asyncio
from pkg import shadow
from pkg.promptlang_runtime import InvalidOutputError, MockClient
print(asyncio.run(shadow.parseOutput({"x": "in"}, MockClient([{"content": "7"}]))))
try:
    asyncio.run(shadow.parseOutput({"x": "in"}, MockClient([{"content": "seven"}])))
except InvalidOutputError:
    print("refused")
`;
    const r = Bun.spawnSync(["python3", "-c", script], { cwd: dir });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    expect(r.stdout.toString().split("\n")).toEqual(["7.0", "refused", ""]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
