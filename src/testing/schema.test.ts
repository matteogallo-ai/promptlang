import { describe, expect, test } from "bun:test";
import type { Program, TypeExpression } from "../ast/nodes";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { schemaErrors } from "./schema";

function typesOf(source: string): Map<string, TypeExpression> {
  const program: Program = parse(tokenize(source));
  const types = new Map<string, TypeExpression>();
  for (const d of program.declarations)
    if (d.kind === "TypeDeclaration") types.set(d.name, d.definition);
  return types;
}

const types = typesOf(`
type Kind = enum { a, b }
type Item = struct { kind: Kind, n: number, ok: boolean, on: date, note?: string }
`);
const ref = (name: string): TypeExpression => ({ kind: "TypeReference", name, line: 1, column: 1 });
const errors = (value: unknown, name = "Item") => schemaErrors(value, ref(name), types);

describe("schemaErrors", () => {
  const good = { kind: "a", n: 1.5, ok: false, on: "2026-11-02" };

  test("a conforming value has no errors, with or without optional fields", () => {
    expect(errors(good)).toEqual([]);
    expect(errors({ ...good, note: "x" })).toEqual([]);
  });

  test("each kind of mismatch is reported with its path", () => {
    // Messages say what a value is, never what it says: answers are untrusted and reach logs.
    expect(errors({ ...good, kind: "c" })).toEqual([
      "output.kind: expected one of a, b, got a string",
    ]);
    expect(errors({ ...good, n: "1" })).toEqual(["output.n: expected number, got a string"]);
    expect(errors({ ...good, n: Number.POSITIVE_INFINITY })).toEqual([
      "output.n: expected a finite number, got a non-finite number",
    ]);
    expect(errors({ ...good, on: "02/11/2026" })).toEqual([
      "output.on: expected a YYYY-MM-DD date, got a string",
    ]);
    expect(errors({ kind: "a", n: 1, on: "2026-11-02" })).toEqual([
      "output.ok: missing required field",
    ]);
    expect(errors({ ...good, extra: 1 })).toEqual(["output: 1 field not in the declared type"]);
  });

  test("non-objects, null and arrays are not structs", () => {
    expect(errors(null)).toEqual(["output: expected an object, got null"]);
    expect(errors([good])).toEqual(["output: expected an object, got an array"]);
    expect(errors("x")).toEqual(["output: expected an object, got a string"]);
  });

  test("an undeclared type cannot be checked and says so", () => {
    expect(errors("a", "Imported")).toEqual([
      "output: type 'Imported' is not declared in this file, cannot check it",
    ]);
  });
});
