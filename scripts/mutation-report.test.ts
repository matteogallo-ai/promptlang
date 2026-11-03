import { describe, expect, test } from "bun:test";
import { summarize, survivors, unmutated } from "./mutation-report";

const at = (line: number, column = 1) => ({ start: { line, column } });

const report = {
  files: {
    "src/b.ts": {
      mutants: [
        { mutatorName: "StringLiteral", status: "Survived", replacement: '""', location: at(9) },
        { mutatorName: "BooleanLiteral", status: "Killed", location: at(2) },
      ],
    },
    "src/a.ts": {
      mutants: [
        { mutatorName: "EqualityOperator", status: "Killed", location: at(4) },
        { mutatorName: "BlockStatement", status: "Timeout", location: at(5) },
        { mutatorName: "ConditionalExpression", status: "NoCoverage", location: at(3, 7) },
        { mutatorName: "ArithmeticOperator", status: "CompileError", location: at(1) },
      ],
    },
  },
};

describe("mutation-report", () => {
  test("scores each file as detected over valid mutants, leaving errors out", () => {
    const { files, total } = summarize(report);
    expect(files.map((f) => [f.file, f.score])).toEqual([
      ["src/a.ts", 66.67],
      ["src/b.ts", 50],
    ]);
    expect(files[0]).toMatchObject({ killed: 1, timeout: 1, noCoverage: 1, errors: 1 });
    expect(total).toMatchObject({ killed: 2, timeout: 1, survived: 1, noCoverage: 1, score: 60 });
  });

  test("a file with no valid mutant scores 100", () => {
    const { files } = summarize({ files: { "x.ts": { mutants: [] } } });
    expect(files[0]?.score).toBe(100);
  });

  test("lists surviving and uncovered mutants by file, then line", () => {
    expect(survivors(report).map((s) => `${s.file}:${s.line}:${s.column} ${s.mutator}`)).toEqual([
      "src/a.ts:3:7 ConditionalExpression",
      "src/b.ts:9:1 StringLiteral",
    ]);
  });

  // The score must not read as a measure of code Stryker never touched.
  test("names the source directories that no mutate pattern reaches", () => {
    const mutate = ["src/lexer/**/*.ts", "src/parser/**/*.ts", "!**/*.test.ts"];
    expect(unmutated(["compiler", "lexer", "parser", "runtime"], mutate)).toEqual([
      "src/compiler",
      "src/runtime",
    ]);
    expect(unmutated(["lexer"], ["!src/lexer/**/*.ts"])).toEqual(["src/lexer"]);
  });
});
