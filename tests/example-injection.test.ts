import { describe, expect, test } from "bun:test";
import type { StringLiteral, TestDeclaration } from "../src/ast/nodes";
import { compile } from "../src/compiler/compiler";
import { tokenize } from "../src/lexer/lexer";
import { parse } from "../src/parser/parser";
import { MockClient, type PromptRequest } from "../src/runtime";
import { importCompiled } from "../src/testing/load-compiled";

const FILE = "docs/examples/classify-ticket.prompt";
const TEST_NAME = "an injected instruction is classified, not obeyed";

type Classify = (input: { ticket: string }, client: MockClient) => Promise<string>;

/**
 * The user message the compiled example sends for its injection test's input,
 * and that input. The mock test itself only checks the code path; this is what
 * shows the hostile text reaches the model inside the <ticket> tags.
 */
async function sentForInjectionTest(source: string): Promise<{ user: string; hostile: string }> {
  const program = parse(tokenize(source));
  const t = program.declarations.find(
    (d): d is TestDeclaration => d.kind === "TestDeclaration" && d.description === TEST_NAME
  );
  if (t?.input.kind !== "CallExpression") throw new Error(`no test "${TEST_NAME}"`);
  const hostile = (t.input.arguments[0] as StringLiteral).value;
  const mod = await importCompiled<{ classify_ticket: Classify }>(compile(program, FILE));
  const sent: PromptRequest[] = [];
  await mod.classify_ticket(
    { ticket: hostile },
    new MockClient((req) => {
      sent.push(req);
      return { content: "bug" };
    })
  );
  const user = sent[0]!.messages.find((m) => m.role === "user")!.content;
  return { user, hostile };
}

/** The input sits alone between the opening and closing tags, as the file lays them out. */
function insideTicketTags({ user, hostile }: { user: string; hostile: string }): boolean {
  return /<ticket>\s*\n([^\n]*)\n\s*<\/ticket>/.exec(user)?.[1]?.trim() === hostile;
}

describe(`${FILE}: "${TEST_NAME}"`, () => {
  test("the hostile ticket reaches the user message inside <ticket> tags", async () => {
    const source = await Bun.file(FILE).text();
    expect(insideTicketTags(await sentForInjectionTest(source))).toBe(true);
  });

  // Each mutation keeps the example's own mock test passing; this check must catch it.
  const mutations: Array<[string, (s: string) => string]> = [
    ["both tags removed", (s) => s.replace(/<\/?ticket>\n/g, "")],
    ["the opening tag removed", (s) => s.replace(/^( *)<ticket>\n/m, "")],
    [
      "the input moved before the opening tag",
      (s) => s.replace(/^( *)<ticket>\n( *)\{\{ticket\}\}\n/m, "$2{{ticket}}\n$1<ticket>\n"),
    ],
    [
      "the input moved after the closing tag",
      (s) => s.replace(/^( *)\{\{ticket\}\}\n( *)<\/ticket>\n/m, "$2</ticket>\n$1{{ticket}}\n"),
    ],
  ];
  for (const [name, mutate] of mutations) {
    test(`this check fails when ${name}`, async () => {
      const source = await Bun.file(FILE).text();
      const mutated = mutate(source);
      expect(mutated).not.toBe(source);
      expect(insideTicketTags(await sentForInjectionTest(mutated))).toBe(false);
    });
  }
});
