import { describe, expect, test } from "bun:test";
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
`;

const INPUT = {
  ctx: { plan: "pro", seats: 3 },
  other: { plan: 'é"x', seats: 1 },
  inline: { tag: "a" },
  q: "hi",
};
const EXPECTED =
  '<c>{"plan":"pro","seats":3}</c> <o>{"plan":"é\\"x","seats":1}</o> <i>{"tag":"a"}</i> <e></e> <q>hi</q>';

describe("a struct parameter reaches the model as JSON", () => {
  // It was interpolated as "[object Object]" in TypeScript and as a Python dict repr.
  test("in generated TypeScript", async () => {
    const mod = await importCompiled<{
      reply: (input: typeof INPUT, c: MockClient) => Promise<string>;
    }>(compile(parse(tokenize(SOURCE)), "reply.prompt"));
    const sent: PromptRequest[] = [];
    await mod.reply(
      INPUT,
      new MockClient((req) => {
        sent.push(req);
        return { content: "ok" };
      })
    );
    expect(sent[0]!.messages[0]!.content).toBe(EXPECTED);
  });

  test("in generated Python, byte for byte the same", async () => {
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
from pkg.reply import reply
from pkg.promptlang_runtime import MockClient
sent = []
def answer(req):
    sent.append(req)
    return {"content": "ok"}
asyncio.run(reply(json.loads(sys.argv[1]), MockClient(answer)))
sys.stdout.write(json.dumps(sent[0]["messages"][0]["content"]))
`;
      const r = Bun.spawnSync(["python3", "-c", script, JSON.stringify(INPUT)], { cwd: dir });
      if (r.exitCode !== 0) throw new Error(r.stderr.toString());
      expect(JSON.parse(r.stdout.toString())).toBe(EXPECTED);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
