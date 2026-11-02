import { expect, test } from "bun:test";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";
import { printAst } from "./printer";

test("printAst shows a test's mock, assertion operators and schema check", () => {
  const out = printAst(
    parse(
      tokenize(
        `test "t" {\n  input: f("x")\n  mock: "hi"\n  expect: hi\n  expect contains: "h"\n  expect schema\n}`
      )
    )
  );
  expect(out).toContain('mock: "hi"');
  expect(out).toContain("expect: hi");
  expect(out).toContain('expect contains: "h"');
  expect(out).toContain("expect schema");
});
