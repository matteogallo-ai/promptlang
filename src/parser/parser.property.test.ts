import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { propertyParams } from "../../tests/support/property";
import { LexerError } from "../lexer/errors";
import { tokenize } from "../lexer/lexer";
import { ParserError } from "./errors";
import { parse } from "./parser";

/** Keywords the parser accepts as a field, parameter, enum member, property or argument name. */
const NAME_KEYWORDS = [
  ..."prompt type chain test eval step return enum struct string number boolean date".split(" "),
  ..."system user assistant output input expect dataset metric threshold".split(" "),
];

/** Token texts in grammar-relevant shapes, so fuzzed input gets past the lexer. */
const TOKEN_SOUP = [
  ..."( ) { } [ ] : , . -> = | ? @version @model @temperature @max_tokens @breaking_changes".split(
    " "
  ),
  ..."@migration_from @description import as requires mock contains matches schema".split(" "),
  ..."x Foo llama3 1 0.5 true false".split(" "),
  ...NAME_KEYWORDS,
  ...['"s"', '"{{x}}"', '"""t"""', '"1.0.0"', '"^1.0.0"', '"("', "// c\n"],
];

describe("parser properties", () => {
  test("fuzz: parse(tokenize(src)) returns a Program or throws a LexerError or ParserError", () => {
    const source = fc.oneof(
      fc.array(fc.constantFrom(...TOKEN_SOUP), { maxLength: 30 }).map((ts) => ts.join(" ")),
      fc.string({ maxLength: 40 })
    );
    fc.assert(
      fc.property(source, (src) => {
        try {
          expect(parse(tokenize(src)).kind).toBe("Program");
        } catch (error) {
          if (!(error instanceof ParserError || error instanceof LexerError)) throw error;
          expect(error.line).toBeGreaterThanOrEqual(1);
          expect(error.column).toBeGreaterThanOrEqual(1);
        }
      }),
      propertyParams(2000)
    );
  });
});
