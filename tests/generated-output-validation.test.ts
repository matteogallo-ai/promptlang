import { describe, expect, test } from "bun:test";
import { compile } from "../src/compiler/compiler";
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
`;

type Call = (input: { x: string }, client: MockClient) => Promise<unknown>;
type Module = Record<"invoice" | "kind" | "count" | "flag" | "chain_of", Call>;

const mod = importCompiled<Module>(compile(parse(tokenize(SOURCE)), "out.prompt"));

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
      "output.hacked: field not in the declared type",
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
    expect((await failure("chain_of", '{"v": 1, "next": {"v": "two"}}')).errors).toEqual([
      "output.next.v: expected number, got a string",
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
