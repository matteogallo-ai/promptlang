import { describe, expect, test } from "bun:test";
import { pythonTest } from "../../tests/support/python";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { MockClient, type PromptRequest } from "../runtime";
import { importCompiled } from "../testing/load-compiled";
import { compile } from "./compiler";
import { compilePython } from "./python/python-compiler";
import { getPythonRuntimeSource } from "./python/python-runtime-template";

const SOURCE = `@version "1.0.0"
type Ctx = struct {
  plan: string
  seats: number
}
type Alias = Ctx
prompt reply(ctx: Ctx, other: Alias, inline: struct { tag: string }, extra?: Ctx, q: string) -> string {
  user: "<c>{{ctx}}</c> <o>{{other}}</o> <i>{{inline}}</i> <e>{{extra}}</e> <q>{{q}}</q>"
}
prompt JSON(ctx: Ctx, extra?: Ctx) -> string {
  system: """Say "hi" to:
<c>{{ctx}}</c>
<e>{{extra}}</e>"""
  user: "go"
}
`;

const INPUT = {
  ctx: { plan: "pro", seats: 3 },
  other: { plan: 'é"x', seats: 1 },
  inline: { tag: "a" },
  q: "hi",
};
// A prompt named JSON hides the global in TypeScript; a present optional struct; a
// multi-line system section (a triple-quoted f-string in Python).
const SYSTEM_INPUT = { ctx: { plan: "pro", seats: 3 }, extra: { plan: "x", seats: 2 } };
const SYSTEM_EXPECTED =
  'Say "hi" to:\n<c>{"plan":"pro","seats":3}</c>\n<e>{"plan":"x","seats":2}</e>';
const EXPECTED =
  '<c>{"plan":"pro","seats":3}</c> <o>{"plan":"é\\"x","seats":1}</o> <i>{"tag":"a"}</i> <e></e> <q>hi</q>';

type Call = (input: object, c: MockClient) => Promise<string>;

describe("a struct parameter reaches the model as JSON", () => {
  // It was interpolated as "[object Object]" in TypeScript and as a Python dict repr.
  test("in generated TypeScript", async () => {
    const mod = await importCompiled<{ reply: Call; JSON: Call }>(
      compile(parse(tokenize(SOURCE)), "reply.prompt")
    );
    const sent: PromptRequest[] = [];
    const client = new MockClient((req) => {
      sent.push(req);
      return { content: "ok" };
    });
    await mod.reply(INPUT, client);
    await mod.JSON(SYSTEM_INPUT, client);
    expect(sent.map((r) => r.messages[0]!.content)).toEqual([EXPECTED, SYSTEM_EXPECTED]);
  });

  pythonTest("in generated Python, byte for byte the same", async () => {
    const dir = await mkdtemp(join(tmpdir(), "promptlang-struct-params-"));
    try {
      await mkdir(join(dir, "pkg"));
      await writeFile(join(dir, "pkg", "__init__.py"), "");
      await writeFile(join(dir, "pkg", "promptlang_runtime.py"), getPythonRuntimeSource());
      await writeFile(
        join(dir, "pkg", "reply.py"),
        compilePython(parse(tokenize(SOURCE)), "reply.prompt")
      );
      const script = `
import asyncio, json, sys
from pkg import reply as m
from pkg.promptlang_runtime import MockClient
sent = []
def answer(req):
    sent.append(req)
    return {"content": "ok"}
asyncio.run(m.reply(json.loads(sys.argv[1]), MockClient(answer)))
asyncio.run(m.JSON(json.loads(sys.argv[2]), MockClient(answer)))
sys.stdout.write(json.dumps([r["messages"][0]["content"] for r in sent]))
`;
      const args = [JSON.stringify(INPUT), JSON.stringify(SYSTEM_INPUT)];
      const r = Bun.spawnSync(["python3", "-c", script, ...args], { cwd: dir });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      expect(JSON.parse(r.stdout.toString())).toEqual([EXPECTED, SYSTEM_EXPECTED]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
