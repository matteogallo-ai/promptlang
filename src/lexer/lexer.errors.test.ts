import { describe, expect, test } from "bun:test";
import { LexerError } from "./errors";
import { tokenize } from "./lexer";
import { TokenType } from "./token";

/**
 * Pins what the lexer reports and where, and the boundary cases of the
 * character classes and string scanners, which the example tests left open:
 * mutation testing showed the messages, the `{{...}}` scanner and the ranges
 * of `isIdentStart` could change without a test failing.
 */

function errorOf(source: string): LexerError {
  try {
    tokenize(source);
  } catch (error) {
    if (error instanceof LexerError) return error;
    throw error;
  }
  throw new Error(`expected a LexerError for: ${source}`);
}

/** [source, message without the "[Lexer] Line L, Column C: " prefix, line, column] */
type Case = [string, string, number, number];

// biome-ignore format: one error case per line keeps the table reviewable
const CASES: Case[] = [
  ["a -b", "Unexpected character '-'. Did you mean '->'?", 1, 3],
  ["a\n /", "Unexpected character '/'. Did you mean '//' or '/*'?", 2, 2],
  ["x /* never", "Unterminated block comment", 1, 3],
  ["@foo", "Unknown directive '@foo'", 1, 1],
  ["@", "Unknown directive '@'", 1, 1],
  ["x \"ab\ncd\"", "Unterminated string literal", 1, 3],
  ["\"ab", "Unterminated string literal", 1, 1],
  ["\"a\\q\"", "Unknown escape sequence '\\q'", 1, 1],
  ["\"{{a\nb}}\"", "Unterminated template interpolation '{{...}}'", 1, 1],
  ["\"{{a", "Unterminated template interpolation '{{...}}'", 1, 1],
  ["\"{{a}\" x\"", "Unterminated template interpolation '{{...}}'", 1, 1],
  ["\"\"\"abc", "Unterminated triple-quoted string", 1, 1],
  ["12ab", "Invalid numeric literal '12a...' — identifiers cannot start with a digit", 1, 1],
  ["1.5x", "Invalid numeric literal '1.5x...' — identifiers cannot start with a digit", 1, 1],
  ["#", "Unexpected character '#'", 1, 1],
];

describe("lexer error messages", () => {
  for (const [source, message, line, column] of CASES) {
    test(JSON.stringify(source), () => {
      const error = errorOf(source);
      expect(error.name).toBe("LexerError");
      expect(error.message).toBe(`[Lexer] Line ${line}, Column ${column}: ${message}`);
      expect([error.line, error.column]).toEqual([line, column]);
    });
  }
});

const typesAndValues = (source: string) =>
  tokenize(source).map((t) => [t.type, t.value] as [TokenType, string]);

describe("lexer boundary cases", () => {
  test("characters just outside the identifier ranges are rejected", () => {
    // Code points between and above a-z / A-Z that no other token claims, and non-ASCII.
    for (const ch of ["\\", "^", "`", "~", "\u007f", "é"]) {
      expect(() => tokenize(`x ${ch}`)).toThrow(`Unexpected character '${ch}'`);
    }
    expect(typesAndValues("aZ_9")).toEqual([
      [TokenType.IDENT, "aZ_9"],
      [TokenType.EOF, ""],
    ]);
  });

  test("a newline is a NEWLINE token, other whitespace is skipped", () => {
    expect(typesAndValues("a \t\r\nb")).toEqual([
      [TokenType.IDENT, "a"],
      [TokenType.NEWLINE, "\n"],
      [TokenType.IDENT, "b"],
      [TokenType.EOF, ""],
    ]);
  });

  test("inside {{...}} a string keeps quotes and backslashes raw until the closing }}", () => {
    expect(typesAndValues('"{{a"b}}"')).toEqual([
      [TokenType.TEMPLATE_STRING, '{{a"b}}'],
      [TokenType.EOF, ""],
    ]);
    expect(typesAndValues('"{{a}"x}}"')).toEqual([
      [TokenType.TEMPLATE_STRING, '{{a}"x}}'],
      [TokenType.EOF, ""],
    ]);
    expect(typesAndValues('"{{a\\n}}"')).toEqual([
      [TokenType.TEMPLATE_STRING, "{{a\\n}}"],
      [TokenType.EOF, ""],
    ]);
  });

  test("a triple-quoted string only closes on three quotes", () => {
    expect(typesAndValues('"""a""b"""')).toEqual([
      [TokenType.TRIPLE_STRING, 'a""b'],
      [TokenType.EOF, ""],
    ]);
  });
});
