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

function insideTicketTags({ user, hostile }: { user: string; hostile: string }): boolean {
  const at = user.indexOf(hostile);
  return at !== -1 && user.lastIndexOf("<ticket>", at) !== -1 && user.indexOf("</ticket>", at) > at;
}

describe(`${FILE}: "${TEST_NAME}"`, () => {
  test("the hostile ticket reaches the user message inside <ticket> tags", async () => {
    const source = await Bun.file(FILE).text();
    expect(insideTicketTags(await sentForInjectionTest(source))).toBe(true);
  });

  // The audit's mutation: with the tags removed, the example's own mock test still passes.
  test("this check fails when the tags are removed", async () => {
    const source = (await Bun.file(FILE).text()).replace(/<\/?ticket>\n/g, "");
    expect(insideTicketTags(await sentForInjectionTest(source))).toBe(false);
  });
});
