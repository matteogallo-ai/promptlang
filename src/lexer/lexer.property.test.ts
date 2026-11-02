import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { propertyParams } from "../../tests/support/property";
import { LexerError } from "./errors";
import { tokenize } from "./lexer";
import { type Token, TokenType } from "./token";

/** Converts a token's 1-indexed line/column back to a UTF-16 offset in `source`. */
function offsetOf(source: string, line: number, column: number): number {
  const lines = source.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1; i++) offset += lines[i]!.length + 1;
  return offset + column - 1;
}

/** Characters the lexer dispatches on, so fuzzed input reaches every branch. */
const LEXER_CHARS = [...'(){}[]:,.=|?-/>*@"\\ \t\r\n{}_aZ09', "é", "\u0000", "\uD83D"];
const lexerSoup = fc.string({ unit: fc.constantFrom(...LEXER_CHARS), maxLength: 40 });
const anyText = fc.oneof(fc.string({ unit: "binary", maxLength: 60 }), lexerSoup);

function tokenizeOrLexerError(source: string): Token[] | LexerError {
  try {
    return tokenize(source);
  } catch (error) {
    if (error instanceof LexerError) return error;
    throw error;
  }
}

describe("lexer properties", () => {
  test("fuzz: tokenize returns tokens ending in EOF or throws a LexerError positioned in the source", () => {
    fc.assert(
      fc.property(anyText, (source) => {
        const result = tokenizeOrLexerError(source);
        if (result instanceof LexerError) {
          const offset = offsetOf(source, result.line, result.column);
          expect(offset).toBeGreaterThanOrEqual(0);
          expect(offset).toBeLessThan(source.length);
          return;
        }
        expect(result.at(-1)?.type).toBe(TokenType.EOF);
        expect(result.filter((t) => t.type === TokenType.EOF)).toHaveLength(1);
      }),
      propertyParams(1500)
    );
  });

  test("token positions are strictly increasing and point at the token's text in the source", () => {
    fc.assert(
      fc.property(anyText, (source) => {
        const result = tokenizeOrLexerError(source);
        if (result instanceof LexerError) return;
        let previous = -1;
        for (const token of result) {
          const offset = offsetOf(source, token.line, token.column);
          expect(offset).toBeGreaterThan(previous);
          previous = offset;
          if (token.type === TokenType.EOF) {
            expect(offset).toBe(source.length);
            continue;
          }
          expect(source[offset]).toBe(expectedFirstChar(token));
        }
      }),
      propertyParams(1500)
    );
  });

  test("tokens joined by whitespace lex back to the same types and values", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(tokenSpec, fc.constantFrom(" ", "\t", "  ", "\r\n")), {
          maxLength: 12,
        }),
        (specs) => {
          const source = specs.map(([spec, gap]) => spec.text + gap).join("");
          const tokens = tokenize(source).filter((t) => t.type !== TokenType.NEWLINE);
          expect(tokens.map(({ type, value }) => ({ type, value }))).toEqual([
            ...specs.map(([spec]) => ({ type: spec.type, value: spec.value })),
            { type: TokenType.EOF, value: "" },
          ]);
        }
      ),
      propertyParams(500)
    );
  });

  test("every strict prefix of a string literal is reported as unterminated", () => {
    fc.assert(
      fc.property(
        stringBody.filter((s) => s.length > 0),
        fc.nat(),
        (body, cut) => {
          const literal = `"${escapeString(body)}"`;
          const prefix = literal.slice(0, 1 + (cut % (literal.length - 1)));
          const result = tokenizeOrLexerError(prefix);
          expect(result).toBeInstanceOf(LexerError);
          expect((result as LexerError).message).toContain("Unterminated");
        }
      ),
      propertyParams(500)
    );
  });
});

function expectedFirstChar(token: Token): string {
  switch (token.type) {
    case TokenType.STRING:
    case TokenType.TRIPLE_STRING:
    case TokenType.TEMPLATE_STRING:
      return '"';
    case TokenType.COMMENT_LINE:
    case TokenType.COMMENT_BLOCK:
      return "/";
    case TokenType.AT_VERSION:
    case TokenType.AT_MODEL:
    case TokenType.AT_TEMPERATURE:
    case TokenType.AT_MAX_TOKENS:
    case TokenType.AT_BREAKING_CHANGES:
    case TokenType.AT_MIGRATION_FROM:
    case TokenType.AT_DESCRIPTION:
      return "@";
    default:
      return token.value[0]!;
  }
}

// ---------------------------------------------------------------------------
// Generators for well-formed tokens: text as written, expected type and value
// ---------------------------------------------------------------------------

interface TokenSpec {
  text: string;
  type: TokenType;
  value: string;
}

const KEYWORDS: Record<string, TokenType> = {
  prompt: TokenType.PROMPT,
  type: TokenType.TYPE,
  chain: TokenType.CHAIN,
  test: TokenType.TEST,
  eval: TokenType.EVAL,
  step: TokenType.STEP,
  return: TokenType.RETURN,
  enum: TokenType.ENUM,
  struct: TokenType.STRUCT,
  import: TokenType.IMPORT,
  as: TokenType.AS,
  string: TokenType.STRING_TYPE,
  number: TokenType.NUMBER_TYPE,
  boolean: TokenType.BOOLEAN_TYPE,
  date: TokenType.DATE_TYPE,
  system: TokenType.SYSTEM,
  user: TokenType.USER,
  assistant: TokenType.ASSISTANT,
  output: TokenType.OUTPUT,
  input: TokenType.INPUT,
  expect: TokenType.EXPECT,
  dataset: TokenType.DATASET,
  metric: TokenType.METRIC,
  threshold: TokenType.THRESHOLD,
  true: TokenType.TRUE,
  false: TokenType.FALSE,
};

const DIRECTIVES: Record<string, TokenType> = {
  version: TokenType.AT_VERSION,
  model: TokenType.AT_MODEL,
  temperature: TokenType.AT_TEMPERATURE,
  max_tokens: TokenType.AT_MAX_TOKENS,
  breaking_changes: TokenType.AT_BREAKING_CHANGES,
  migration_from: TokenType.AT_MIGRATION_FROM,
  description: TokenType.AT_DESCRIPTION,
};

const PUNCTUATION: Record<string, TokenType> = {
  "(": TokenType.LPAREN,
  ")": TokenType.RPAREN,
  "{": TokenType.LBRACE,
  "}": TokenType.RBRACE,
  "[": TokenType.LBRACKET,
  "]": TokenType.RBRACKET,
  ":": TokenType.COLON,
  ",": TokenType.COMMA,
  ".": TokenType.DOT,
  "->": TokenType.ARROW,
  "=": TokenType.EQUAL,
  "|": TokenType.PIPE,
  "?": TokenType.QUESTION,
};

const identifier = fc
  .stringMatching(/^[A-Za-z_][A-Za-z0-9_]*(-[A-Za-z0-9_]+)*$/)
  .filter((s) => s.length <= 20 && !(s in KEYWORDS));

/** Printable text with the characters string literals must escape, but no `{{`. */
const stringBody = fc
  .string({ unit: fc.constantFrom(...'ab Z9{}#"\\\n\t\r'), maxLength: 16 })
  .filter((s) => !s.includes("{{"));

const ESCAPES: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\n": "\\n",
  "\t": "\\t",
  "\r": "\\r",
};

function escapeString(body: string): string {
  return body.replace(/[\\"\n\t\r]/g, (c) => ESCAPES[c]!);
}

const tokenSpec: fc.Arbitrary<TokenSpec> = fc.oneof(
  identifier.map((s) => ({ text: s, type: TokenType.IDENT, value: s })),
  fc.constantFrom(...Object.entries(KEYWORDS)).map(([k, type]) => ({ text: k, type, value: k })),
  fc.constantFrom(...Object.entries(DIRECTIVES)).map(([d, type]) => ({
    text: `@${d}`,
    type,
    value: d,
  })),
  fc.constantFrom(...Object.entries(PUNCTUATION)).map(([p, type]) => ({ text: p, type, value: p })),
  fc
    .tuple(fc.stringMatching(/^\d{1,6}$/), fc.option(fc.stringMatching(/^\d{1,4}$/)))
    .map(([int, frac]) => {
      const text = frac === null ? int : `${int}.${frac}`;
      return { text, type: TokenType.NUMBER, value: text };
    }),
  stringBody.map((body) => ({
    text: `"${escapeString(body)}"`,
    type: TokenType.STRING,
    value: body,
  })),
  fc
    .tuple(stringBody, identifier, stringBody)
    .map(([before, name, after]) => ({
      text: `"${escapeString(before)}{{${name}}}${escapeString(after)}"`,
      type: TokenType.TEMPLATE_STRING,
      value: `${before}{{${name}}}${after}`,
    }))
    // A trailing `{` would merge with the interpolation's opening braces.
    .filter((spec) => !spec.text.includes("{{{")),
  fc
    .string({ unit: fc.constantFrom(..."ab \n\\'#"), maxLength: 16 })
    .map((body) => ({ text: `"""${body}"""`, type: TokenType.TRIPLE_STRING, value: body })),
  fc
    .string({ unit: fc.constantFrom(..."ab /*"), maxLength: 12 })
    .filter((s) => !s.includes("*/"))
    .map((body) => ({
      text: `/*${body}*/`,
      type: TokenType.COMMENT_BLOCK,
      value: body.trim(),
    })),
  fc
    .string({ unit: fc.constantFrom(...'ab /*"'), maxLength: 12 })
    .map((body) => ({ text: `//${body}\n`, type: TokenType.COMMENT_LINE, value: body.trim() }))
);
