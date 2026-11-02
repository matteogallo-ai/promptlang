import { describe, expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { MockClient, type PromptRequest } from "../runtime";
import { importCompiled } from "../testing/load-compiled";
import { compile } from "./compiler";
import { compilePython } from "./python/python-compiler";

const SOURCE = `@version "1.0.0"
prompt greet(name: string, title?: string) -> string {
  user: "Hello {{title}} {{name}}"
}
chain welcome(name: string, title?: string) -> string {
  step g = greet(name: name)
  return g
}
`;

const ast = () => parse(tokenize(SOURCE));

describe("optional parameters (name?: Type)", () => {
  test("are parsed with optional: true; required ones have no flag", () => {
    const prompt = ast().declarations[0]!;
    if (prompt.kind !== "PromptDeclaration") throw new Error("expected a prompt");
    expect(prompt.parameters.map((p) => [p.name, p.optional === true])).toEqual([
      ["name", false],
      ["title", true],
    ]);
  });

  test("are optional in the generated TypeScript input interfaces", () => {
    const ts = compile(ast(), "greet.prompt");
    expect(ts).toContain("export interface GreetInput {\n  name: string;\n  title?: string;\n}");
    expect(ts).toContain("export interface WelcomeInput {\n  name: string;\n  title?: string;\n}");
  });

  test("an omitted optional parameter interpolates as the empty string", async () => {
    const mod = await importCompiled<{
      greet: (input: { name: string; title?: string }, c: MockClient) => Promise<string>;
    }>(compile(ast(), "greet.prompt"));
    const sent: PromptRequest[] = [];
    const client = new MockClient((req) => {
      sent.push(req);
      return { content: "ok" };
    });
    await mod.greet({ name: "Ada" }, client);
    await mod.greet({ name: "Ada", title: "Dr." }, client);
    expect(sent.map((r) => r.messages[0]!.content)).toEqual(["Hello  Ada", "Hello Dr. Ada"]);
  });

  test("are NotRequired in the Python TypedDict and read with .get", () => {
    const py = compilePython(ast(), "greet.prompt");
    expect(py).toContain("    title: NotRequired[str]");
    expect(py).toContain("    name: str");
    expect(py).toContain("{input.get('title', '')}");
    expect(py).toContain("{input['name']}");
  });
});
