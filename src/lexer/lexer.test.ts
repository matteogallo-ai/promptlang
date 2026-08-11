import { describe, expect, test } from "bun:test";
import { tokenize } from "./lexer";
import { TokenType } from "./token";
import { LexerError } from "./errors";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Returns only non-NEWLINE, non-EOF tokens for compact assertions. */
function tokens(src: string) {
  return tokenize(src).filter(
    (t) => t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF
  );
}

/** Returns only token types (no NEWLINE, no EOF) for sequence checks. */
function types(src: string): TokenType[] {
  return tokens(src).map((t) => t.type);
}

// ---------------------------------------------------------------------------
// 1. EOF — always present
// ---------------------------------------------------------------------------

describe("EOF", () => {
  test("empty source produces only EOF", () => {
    const result = tokenize("");
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe(TokenType.EOF);
  });

  test("whitespace-only source produces only EOF", () => {
    const result = tokenize("   \t  \n  ");
    const meaningful = result.filter(
      (t) => t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF
    );
    expect(meaningful).toHaveLength(0);
    expect(result[result.length - 1]!.type).toBe(TokenType.EOF);
  });

  test("EOF has correct position after non-empty source", () => {
    const result = tokenize("x");
    const eof = result[result.length - 1]!;
    expect(eof.type).toBe(TokenType.EOF);
    expect(eof.line).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Punctuation and simple operators
// ---------------------------------------------------------------------------

describe("Punctuation", () => {
  test("tokenizes all single-character punctuation", () => {
    expect(types("( ) { } [ ] : , . = | ?")).toEqual([
      TokenType.LPAREN,
      TokenType.RPAREN,
      TokenType.LBRACE,
      TokenType.RBRACE,
      TokenType.LBRACKET,
      TokenType.RBRACKET,
      TokenType.COLON,
      TokenType.COMMA,
      TokenType.DOT,
      TokenType.EQUAL,
      TokenType.PIPE,
      TokenType.QUESTION,
    ]);
  });

  test("tokenizes ARROW (->)", () => {
    expect(types("->")).toEqual([TokenType.ARROW]);
  });

  test("bare hyphen without > throws LexerError", () => {
    expect(() => tokenize("-")).toThrow(LexerError);
  });

  test("punctuation values match raw characters", () => {
    const t = tokenize("(")[0]!;
    expect(t.value).toBe("(");
  });
});

// ---------------------------------------------------------------------------
// 3. Metadata directives (@...)
// ---------------------------------------------------------------------------

describe("Directives", () => {
  test("@version", () => {
    const t = tokens("@version")[0]!;
    expect(t.type).toBe(TokenType.AT_VERSION);
    expect(t.value).toBe("version");
  });

  test("@model", () => {
    expect(types("@model")).toEqual([TokenType.AT_MODEL]);
  });

  test("@temperature", () => {
    expect(types("@temperature")).toEqual([TokenType.AT_TEMPERATURE]);
  });

  test("@max_tokens", () => {
    expect(types("@max_tokens")).toEqual([TokenType.AT_MAX_TOKENS]);
  });

  test("@breaking_changes", () => {
    expect(types("@breaking_changes")).toEqual([TokenType.AT_BREAKING_CHANGES]);
  });

  test("@migration_from", () => {
    expect(types("@migration_from")).toEqual([TokenType.AT_MIGRATION_FROM]);
  });

  test("unknown directive throws LexerError", () => {
    expect(() => tokenize("@foobar")).toThrow(LexerError);
  });

  test("directive followed by string value", () => {
    expect(types('@version "1.0.0"')).toEqual([
      TokenType.AT_VERSION,
      TokenType.STRING,
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Declaration keywords
// ---------------------------------------------------------------------------

describe("Declaration keywords", () => {
  test("prompt keyword", () => {
    expect(types("prompt")).toEqual([TokenType.PROMPT]);
  });

  test("type keyword", () => {
    expect(types("type")).toEqual([TokenType.TYPE]);
  });

  test("chain keyword", () => {
    expect(types("chain")).toEqual([TokenType.CHAIN]);
  });

  test("test keyword", () => {
    expect(types("test")).toEqual([TokenType.TEST]);
  });

  test("eval keyword", () => {
    expect(types("eval")).toEqual([TokenType.EVAL]);
  });

  test("step keyword", () => {
    expect(types("step")).toEqual([TokenType.STEP]);
  });

  test("return keyword", () => {
    expect(types("return")).toEqual([TokenType.RETURN]);
  });

  test("enum keyword", () => {
    expect(types("enum")).toEqual([TokenType.ENUM]);
  });

  test("struct keyword", () => {
    expect(types("struct")).toEqual([TokenType.STRUCT]);
  });
});

// ---------------------------------------------------------------------------
// 5. Primitive type keywords
// ---------------------------------------------------------------------------

describe("Primitive type keywords", () => {
  test("string keyword maps to STRING_TYPE", () => {
    expect(types("string")).toEqual([TokenType.STRING_TYPE]);
  });

  test("number keyword maps to NUMBER_TYPE", () => {
    expect(types("number")).toEqual([TokenType.NUMBER_TYPE]);
  });

  test("boolean keyword maps to BOOLEAN_TYPE", () => {
    expect(types("boolean")).toEqual([TokenType.BOOLEAN_TYPE]);
  });

  test("date keyword maps to DATE_TYPE", () => {
    expect(types("date")).toEqual([TokenType.DATE_TYPE]);
  });
});

// ---------------------------------------------------------------------------
// 6. Prompt section keywords
// ---------------------------------------------------------------------------

describe("Section keywords", () => {
  test("system keyword", () => {
    expect(types("system")).toEqual([TokenType.SYSTEM]);
  });

  test("user keyword", () => {
    expect(types("user")).toEqual([TokenType.USER]);
  });

  test("assistant keyword", () => {
    expect(types("assistant")).toEqual([TokenType.ASSISTANT]);
  });

  test("output keyword", () => {
    expect(types("output")).toEqual([TokenType.OUTPUT]);
  });

  test("input keyword", () => {
    expect(types("input")).toEqual([TokenType.INPUT]);
  });

  test("expect keyword", () => {
    expect(types("expect")).toEqual([TokenType.EXPECT]);
  });

  test("dataset keyword", () => {
    expect(types("dataset")).toEqual([TokenType.DATASET]);
  });
});

// ---------------------------------------------------------------------------
// 7. Identifiers
// ---------------------------------------------------------------------------

describe("Identifiers", () => {
  test("simple lowercase identifier", () => {
    const t = tokens("myVar")[0]!;
    expect(t.type).toBe(TokenType.IDENT);
    expect(t.value).toBe("myVar");
  });

  test("snake_case identifier", () => {
    const t = tokens("my_variable")[0]!;
    expect(t.type).toBe(TokenType.IDENT);
    expect(t.value).toBe("my_variable");
  });

  test("PascalCase identifier", () => {
    const t = tokens("Category")[0]!;
    expect(t.type).toBe(TokenType.IDENT);
    expect(t.value).toBe("Category");
  });

  test("leading underscore identifier", () => {
    const t = tokens("_private")[0]!;
    expect(t.type).toBe(TokenType.IDENT);
    expect(t.value).toBe("_private");
  });

  test("identifier starting with digit is illegal", () => {
    expect(() => tokenize("123abc")).toThrow(LexerError);
  });

  test("custom type name does not clash with keywords", () => {
    // 'prompter' is not the keyword 'prompt'
    const t = tokens("prompter")[0]!;
    expect(t.type).toBe(TokenType.IDENT);
    expect(t.value).toBe("prompter");
  });
});

// ---------------------------------------------------------------------------
// 8. Boolean literals
// ---------------------------------------------------------------------------

describe("Boolean literals", () => {
  test("true keyword", () => {
    expect(types("true")).toEqual([TokenType.TRUE]);
  });

  test("false keyword", () => {
    expect(types("false")).toEqual([TokenType.FALSE]);
  });

  test("truthy is an identifier, not a keyword", () => {
    const t = tokens("truthy")[0]!;
    expect(t.type).toBe(TokenType.IDENT);
  });
});

// ---------------------------------------------------------------------------
// 9. Number literals
// ---------------------------------------------------------------------------

describe("Number literals", () => {
  test("integer", () => {
    const t = tokens("42")[0]!;
    expect(t.type).toBe(TokenType.NUMBER);
    expect(t.value).toBe("42");
  });

  test("decimal", () => {
    const t = tokens("3.14")[0]!;
    expect(t.type).toBe(TokenType.NUMBER);
    expect(t.value).toBe("3.14");
  });

  test("zero", () => {
    const t = tokens("0")[0]!;
    expect(t.type).toBe(TokenType.NUMBER);
    expect(t.value).toBe("0");
  });

  test("decimal starting with 0", () => {
    const t = tokens("0.5")[0]!;
    expect(t.type).toBe(TokenType.NUMBER);
    expect(t.value).toBe("0.5");
  });

  test("large integer", () => {
    const t = tokens("100000")[0]!;
    expect(t.type).toBe(TokenType.NUMBER);
    expect(t.value).toBe("100000");
  });

  test("number not followed by second decimal point is fine", () => {
    // '42.0' should be a single NUMBER
    const result = tokens("42.0");
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe(TokenType.NUMBER);
    expect(result[0]!.value).toBe("42.0");
  });
});

// ---------------------------------------------------------------------------
// 10. Single-line strings
// ---------------------------------------------------------------------------

describe("Single-line strings", () => {
  test("simple string", () => {
    const t = tokens('"hello"')[0]!;
    expect(t.type).toBe(TokenType.STRING);
    expect(t.value).toBe("hello");
  });

  test("empty string", () => {
    const t = tokens('""')[0]!;
    expect(t.type).toBe(TokenType.STRING);
    expect(t.value).toBe("");
  });

  test("string with spaces", () => {
    const t = tokens('"hello world"')[0]!;
    expect(t.type).toBe(TokenType.STRING);
    expect(t.value).toBe("hello world");
  });

  test("escaped double quote inside string", () => {
    const t = tokens('"say \\"hi\\""')[0]!;
    expect(t.type).toBe(TokenType.STRING);
    expect(t.value).toBe('say "hi"');
  });

  test("escape sequences: \\n and \\t", () => {
    const t = tokens('"line1\\nline2\\tend"')[0]!;
    expect(t.value).toBe("line1\nline2\tend");
  });

  test("unknown escape sequence throws LexerError", () => {
    expect(() => tokenize('"\\q"')).toThrow(LexerError);
  });

  test("unterminated string throws LexerError", () => {
    expect(() => tokenize('"unterminated')).toThrow(LexerError);
  });

  test("string spanning multiple lines throws LexerError", () => {
    expect(() => tokenize('"line1\nline2"')).toThrow(LexerError);
  });
});

// ---------------------------------------------------------------------------
// 11. Triple-quoted strings
// ---------------------------------------------------------------------------

describe("Triple-quoted strings", () => {
  test("simple triple string", () => {
    const t = tokens('"""hello"""')[0]!;
    expect(t.type).toBe(TokenType.TRIPLE_STRING);
    expect(t.value).toBe("hello");
  });

  test("empty triple string", () => {
    const t = tokens('""""""')[0]!;
    expect(t.type).toBe(TokenType.TRIPLE_STRING);
    expect(t.value).toBe("");
  });

  test("triple string with newlines preserved", () => {
    const t = tokens('"""line1\nline2"""')[0]!;
    expect(t.type).toBe(TokenType.TRIPLE_STRING);
    expect(t.value).toBe("line1\nline2");
  });

  test("triple string with embedded double quote", () => {
    const t = tokens('"""say "hi" there"""')[0]!;
    expect(t.type).toBe(TokenType.TRIPLE_STRING);
    expect(t.value).toBe('say "hi" there');
  });

  test("unterminated triple string throws LexerError", () => {
    expect(() => tokenize('"""not closed')).toThrow(LexerError);
  });

  test("two consecutive quotes inside triple string do not close it", () => {
    // Only three consecutive quotes close the string.
    // '"""say ""hello"" world"""' — two quotes in the middle are safe.
    const t = tokens('"""say ""hello"" world"""')[0]!;
    expect(t.type).toBe(TokenType.TRIPLE_STRING);
    expect(t.value).toBe('say ""hello"" world');
  });
});

// ---------------------------------------------------------------------------
// 12. Template strings
// ---------------------------------------------------------------------------

describe("Template strings", () => {
  test("single-line template string emits TEMPLATE_STRING", () => {
    const t = tokens('"Hello {{name}}"')[0]!;
    expect(t.type).toBe(TokenType.TEMPLATE_STRING);
    expect(t.value).toBe("Hello {{name}}");
  });

  test("template value preserves the {{...}} markers", () => {
    const t = tokens('"{{ticket}}"')[0]!;
    expect(t.value).toBe("{{ticket}}");
  });

  test("triple string with {{...}} emits TEMPLATE_STRING", () => {
    const t = tokens('"""Classify: {{input}}"""')[0]!;
    expect(t.type).toBe(TokenType.TEMPLATE_STRING);
    expect(t.value).toBe("Classify: {{input}}");
  });

  test("string without {{...}} stays STRING", () => {
    const t = tokens('"no interpolation"')[0]!;
    expect(t.type).toBe(TokenType.STRING);
  });

  test("multiple interpolations in one string", () => {
    const t = tokens('"{{a}} and {{b}}"')[0]!;
    expect(t.type).toBe(TokenType.TEMPLATE_STRING);
    expect(t.value).toBe("{{a}} and {{b}}");
  });
});

// ---------------------------------------------------------------------------
// 13. Line comments
// ---------------------------------------------------------------------------

describe("Line comments", () => {
  test("line comment emits COMMENT_LINE", () => {
    const t = tokenize("// hello world").find(
      (x) => x.type === TokenType.COMMENT_LINE
    )!;
    expect(t).toBeDefined();
    expect(t.value).toBe("hello world");
  });

  test("line comment after code does not consume next token", () => {
    const result = types("prompt // this is a comment\ntype");
    expect(result).toContain(TokenType.PROMPT);
    expect(result).toContain(TokenType.COMMENT_LINE);
    expect(result).toContain(TokenType.TYPE);
  });

  test("empty line comment", () => {
    const t = tokenize("//").find((x) => x.type === TokenType.COMMENT_LINE)!;
    expect(t).toBeDefined();
    expect(t.value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 14. Block comments
// ---------------------------------------------------------------------------

describe("Block comments", () => {
  test("single-line block comment emits COMMENT_BLOCK", () => {
    const t = tokenize("/* hello */").find(
      (x) => x.type === TokenType.COMMENT_BLOCK
    )!;
    expect(t).toBeDefined();
    expect(t.value).toBe("hello");
  });

  test("multi-line block comment", () => {
    const src = "/* line1\nline2 */";
    const t = tokenize(src).find((x) => x.type === TokenType.COMMENT_BLOCK)!;
    expect(t).toBeDefined();
    expect(t.value).toContain("line1");
  });

  test("unterminated block comment throws LexerError", () => {
    expect(() => tokenize("/* never closed")).toThrow(LexerError);
  });
});

// ---------------------------------------------------------------------------
// 15. Position tracking
// ---------------------------------------------------------------------------

describe("Position tracking", () => {
  test("first token on first line has line=1, column=1", () => {
    const t = tokenize("prompt")[0]!;
    expect(t.line).toBe(1);
    expect(t.column).toBe(1);
  });

  test("token after newline has correct line number", () => {
    const result = tokenize("prompt\ntype");
    const typeToken = result.find((t) => t.type === TokenType.TYPE)!;
    expect(typeToken.line).toBe(2);
    expect(typeToken.column).toBe(1);
  });

  test("column tracks within a line", () => {
    const result = tokenize("prompt type");
    const typeToken = result.find((t) => t.type === TokenType.TYPE)!;
    expect(typeToken.line).toBe(1);
    expect(typeToken.column).toBe(8);
  });

  test("string token position points to opening quote", () => {
    const t = tokens('"hello"')[0]!;
    expect(t.column).toBe(1);
  });

  test("multi-line source: third line token has line=3", () => {
    const src = "a\nb\nc";
    const result = tokenize(src).filter((t) => t.type === TokenType.IDENT);
    expect(result[2]!.line).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 16. Whitespace handling
// ---------------------------------------------------------------------------

describe("Whitespace handling", () => {
  test("spaces between tokens are ignored", () => {
    expect(types("prompt   type")).toEqual([TokenType.PROMPT, TokenType.TYPE]);
  });

  test("tabs between tokens are ignored", () => {
    expect(types("prompt\t\ttype")).toEqual([TokenType.PROMPT, TokenType.TYPE]);
  });

  test("carriage return is ignored", () => {
    expect(types("prompt\rtype")).toEqual([TokenType.PROMPT, TokenType.TYPE]);
  });
});

// ---------------------------------------------------------------------------
// 17. Integration — complete prompt declarations
// ---------------------------------------------------------------------------

describe("Integration", () => {
  test("tokenizes a basic prompt declaration", () => {
    const src = `@version "1.0.0"\nprompt classify(input: string) -> Category {\n  system: "You are a classifier."\n  output: Category\n}`;
    const result = types(src);
    expect(result).toContain(TokenType.AT_VERSION);
    expect(result).toContain(TokenType.PROMPT);
    expect(result).toContain(TokenType.IDENT); // classify, Category
    expect(result).toContain(TokenType.LPAREN);
    expect(result).toContain(TokenType.INPUT);
    expect(result).toContain(TokenType.COLON);
    expect(result).toContain(TokenType.STRING_TYPE);
    expect(result).toContain(TokenType.RPAREN);
    expect(result).toContain(TokenType.ARROW);
    expect(result).toContain(TokenType.LBRACE);
    expect(result).toContain(TokenType.SYSTEM);
    expect(result).toContain(TokenType.STRING);
    expect(result).toContain(TokenType.OUTPUT);
    expect(result).toContain(TokenType.RBRACE);
  });

  test("tokenizes enum type declaration", () => {
    const src = "type Category = enum { bug, feature_request, question }";
    const result = types(src);
    expect(result[0]).toBe(TokenType.TYPE);
    expect(result[1]).toBe(TokenType.IDENT); // Category
    expect(result[2]).toBe(TokenType.EQUAL);
    expect(result[3]).toBe(TokenType.ENUM);
    expect(result[4]).toBe(TokenType.LBRACE);
    expect(result).toContain(TokenType.COMMA);
    expect(result[result.length - 1]).toBe(TokenType.RBRACE);
  });

  test("tokenizes struct type declaration", () => {
    const src = "type Invoice = struct { amount: number currency: string }";
    const result = types(src);
    expect(result[0]).toBe(TokenType.TYPE);
    expect(result[3]).toBe(TokenType.STRUCT);
    expect(result).toContain(TokenType.NUMBER_TYPE);
    expect(result).toContain(TokenType.STRING_TYPE);
  });

  test("tokenizes test block", () => {
    const src = `test "classifies correctly" {\n  input: classify("The button crashes")\n  expect: bug\n}`;
    const result = types(src);
    expect(result[0]).toBe(TokenType.TEST);
    expect(result[1]).toBe(TokenType.STRING);
    expect(result[2]).toBe(TokenType.LBRACE);
    expect(result).toContain(TokenType.INPUT);
    expect(result).toContain(TokenType.EXPECT);
    expect(result).toContain(TokenType.IDENT); // bug
    expect(result[result.length - 1]).toBe(TokenType.RBRACE);
  });

  test("tokenizes template string in user section", () => {
    const src = `prompt p(ticket: string) -> Category {\n  user: "Classify: {{ticket}}"\n}`;
    const result = tokens(src);
    const tmpl = result.find((t) => t.type === TokenType.TEMPLATE_STRING)!;
    expect(tmpl).toBeDefined();
    expect(tmpl.value).toBe("Classify: {{ticket}}");
  });

  test("tokenizes triple-string system prompt with template", () => {
    const src = `prompt p(doc: string) -> string {\n  system: """Summarize: {{doc}}"""\n}`;
    const result = tokens(src);
    const tmpl = result.find((t) => t.type === TokenType.TEMPLATE_STRING)!;
    expect(tmpl).toBeDefined();
  });

  test("comments are included in token stream", () => {
    const src = "// header comment\nprompt p() -> string {}";
    const result = tokenize(src);
    const comment = result.find((t) => t.type === TokenType.COMMENT_LINE);
    expect(comment).toBeDefined();
    expect(comment!.value).toBe("header comment");
  });

  test("classify-ticket example tokenizes without error", () => {
    const src = `
@version "1.0.0"
@model claude-opus-4.7
@temperature 0.3

type Category = enum { bug, feature_request, question, other }

prompt classify_ticket(ticket: string) -> Category {
  system: """
    You are a support ticket classifier.
    Respond with exactly one category.
  """
  user: "Classify: {{ticket}}"
  output: Category
}

test "classifies bug reports correctly" {
  input: classify_ticket("The submit button crashes")
  expect: bug
}
    `.trim();

    let result: ReturnType<typeof tokenize>;
    expect(() => {
      result = tokenize(src);
    }).not.toThrow();

    const tTypes = result!
      .filter((t) => t.type !== TokenType.NEWLINE && t.type !== TokenType.EOF)
      .map((t) => t.type);

    expect(tTypes).toContain(TokenType.AT_VERSION);
    expect(tTypes).toContain(TokenType.AT_MODEL);
    expect(tTypes).toContain(TokenType.AT_TEMPERATURE);
    expect(tTypes).toContain(TokenType.TYPE);
    expect(tTypes).toContain(TokenType.ENUM);
    expect(tTypes).toContain(TokenType.PROMPT);
    expect(tTypes).toContain(TokenType.TEMPLATE_STRING);
    expect(tTypes).toContain(TokenType.TEST);
    expect(tTypes).toContain(TokenType.INPUT);
    expect(tTypes).toContain(TokenType.EXPECT);
  });
});
