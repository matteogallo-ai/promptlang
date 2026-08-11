import { LexerError } from "./errors";
import { Token, TokenType } from "./token";

/**
 * Maps keyword strings to their corresponding TokenType.
 * Identifiers are matched against this map after scanning; if found,
 * the token type is upgraded from IDENT to the keyword type.
 */
const KEYWORDS: Readonly<Record<string, TokenType>> = {
  prompt: TokenType.PROMPT,
  type: TokenType.TYPE,
  chain: TokenType.CHAIN,
  test: TokenType.TEST,
  eval: TokenType.EVAL,
  step: TokenType.STEP,
  return: TokenType.RETURN,
  enum: TokenType.ENUM,
  struct: TokenType.STRUCT,
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

/**
 * Maps `@word` directive strings to their corresponding TokenType.
 * Scanned after the `@` character is consumed.
 */
const AT_DIRECTIVES: Readonly<Record<string, TokenType>> = {
  version: TokenType.AT_VERSION,
  model: TokenType.AT_MODEL,
  temperature: TokenType.AT_TEMPERATURE,
  max_tokens: TokenType.AT_MAX_TOKENS,
  breaking_changes: TokenType.AT_BREAKING_CHANGES,
  migration_from: TokenType.AT_MIGRATION_FROM,
  description: TokenType.AT_DESCRIPTION,
};

/**
 * Tokenizes a PromptLang source string into a flat list of tokens.
 *
 * Comments are emitted as tokens rather than discarded so that
 * future formatting tooling (a pretty-printer, an LSP) can reconstruct
 * the original source without losing comment placement.
 *
 * Newlines are emitted as NEWLINE tokens only between top-level
 * declarations; inside strings they are part of the literal value.
 */
export class Lexer {
  private readonly source: string;
  private tokens: Token[] = [];
  private start = 0;
  private current = 0;
  private line = 1;
  private column = 1;
  /** Column of the first character of the token currently being scanned. */
  private startColumn = 1;
  private startLine = 1;

  constructor(source: string) {
    this.source = source;
  }

  /**
   * Tokenizes the entire source string.
   * Always ends with an EOF token.
   *
   * @throws {LexerError} on any invalid token, unterminated string, or illegal character.
   */
  tokenize(): Token[] {
    while (!this.isAtEnd()) {
      this.start = this.current;
      this.startLine = this.line;
      this.startColumn = this.column;
      this.scanToken();
    }
    this.tokens.push({
      type: TokenType.EOF,
      value: "",
      line: this.line,
      column: this.column,
    });
    return this.tokens;
  }

  // ---------------------------------------------------------------------------
  // Core scanning primitives
  // ---------------------------------------------------------------------------

  /** Returns true when the current position is past the end of source. */
  private isAtEnd(): boolean {
    return this.current >= this.source.length;
  }

  /**
   * Consumes and returns the current character, advancing the position.
   * Updates line and column counters.
   */
  private advance(): string {
    const ch = this.source[this.current]!;
    this.current++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  /** Returns the current character without consuming it. */
  private peek(): string {
    if (this.isAtEnd()) return "\0";
    return this.source[this.current]!;
  }

  /** Returns the character one position ahead without consuming it. */
  private peekNext(): string {
    if (this.current + 1 >= this.source.length) return "\0";
    return this.source[this.current + 1]!;
  }

  /**
   * Returns the character at `offset` positions ahead of current,
   * without consuming it.
   */
  private peekAt(offset: number): string {
    const idx = this.current + offset;
    if (idx >= this.source.length) return "\0";
    return this.source[idx]!;
  }

  /**
   * Consumes the current character only if it matches `expected`.
   * Returns true on match, false otherwise.
   */
  private match(expected: string): boolean {
    if (this.isAtEnd()) return false;
    if (this.source[this.current] !== expected) return false;
    this.advance();
    return true;
  }

  /**
   * Emits a token of the given type.
   * The `value` defaults to the raw substring consumed since `start`.
   */
  private addToken(type: TokenType, value?: string): void {
    const raw = this.source.slice(this.start, this.current);
    this.tokens.push({
      type,
      value: value !== undefined ? value : raw,
      line: this.startLine,
      column: this.startColumn,
    });
  }

  // ---------------------------------------------------------------------------
  // Main dispatch
  // ---------------------------------------------------------------------------

  /** Scans one token from the current position. */
  private scanToken(): void {
    const ch = this.advance();

    switch (ch) {
      case "(":
        this.addToken(TokenType.LPAREN);
        break;
      case ")":
        this.addToken(TokenType.RPAREN);
        break;
      case "{":
        this.addToken(TokenType.LBRACE);
        break;
      case "}":
        this.addToken(TokenType.RBRACE);
        break;
      case "[":
        this.addToken(TokenType.LBRACKET);
        break;
      case "]":
        this.addToken(TokenType.RBRACKET);
        break;
      case ":":
        this.addToken(TokenType.COLON);
        break;
      case ",":
        this.addToken(TokenType.COMMA);
        break;
      case ".":
        this.addToken(TokenType.DOT);
        break;
      case "=":
        this.addToken(TokenType.EQUAL);
        break;
      case "|":
        this.addToken(TokenType.PIPE);
        break;
      case "?":
        this.addToken(TokenType.QUESTION);
        break;

      case "-":
        if (this.match(">")) {
          this.addToken(TokenType.ARROW);
        } else {
          throw new LexerError(
            `Unexpected character '-'. Did you mean '->'?`,
            this.startLine,
            this.startColumn
          );
        }
        break;

      case "/":
        if (this.match("/")) {
          this.scanLineComment();
        } else if (this.match("*")) {
          this.scanBlockComment();
        } else {
          throw new LexerError(
            `Unexpected character '/'. Did you mean '//' or '/*'?`,
            this.startLine,
            this.startColumn
          );
        }
        break;

      case "@":
        this.scanDirective();
        break;

      case '"':
        // Triple-string check must come before single-string.
        if (this.peek() === '"' && this.peekNext() === '"') {
          this.advance(); // consume second "
          this.advance(); // consume third "
          this.scanTripleString();
        } else {
          this.scanString();
        }
        break;

      case "\n":
        this.addToken(TokenType.NEWLINE, "\n");
        break;

      case " ":
      case "\r":
      case "\t":
        // Skip whitespace (spaces, carriage returns, tabs).
        break;

      default:
        if (isDigit(ch)) {
          this.scanNumber(ch);
        } else if (isIdentStart(ch)) {
          this.scanIdentifier();
        } else {
          throw new LexerError(
            `Unexpected character '${ch}'`,
            this.startLine,
            this.startColumn
          );
        }
    }
  }

  // ---------------------------------------------------------------------------
  // Scanners for each token category
  // ---------------------------------------------------------------------------

  /** Scans a `// ...` line comment and emits a COMMENT_LINE token. */
  private scanLineComment(): void {
    while (!this.isAtEnd() && this.peek() !== "\n") {
      this.advance();
    }
    // Value: comment text without the leading `//`
    const text = this.source.slice(this.start + 2, this.current).trim();
    this.addToken(TokenType.COMMENT_LINE, text);
  }

  /**
   * Scans a `/ * ... * /` block comment and emits a COMMENT_BLOCK token.
   * Supports multi-line block comments.
   *
   * @throws {LexerError} if the block is never closed.
   */
  private scanBlockComment(): void {
    while (!this.isAtEnd()) {
      if (this.peek() === "*" && this.peekNext() === "/") {
        this.advance(); // consume *
        this.advance(); // consume /
        const raw = this.source.slice(this.start, this.current);
        // Strip the `/*` and `*/` delimiters and trim for the value.
        const text = raw.slice(2, -2).trim();
        this.addToken(TokenType.COMMENT_BLOCK, text);
        return;
      }
      this.advance();
    }
    throw new LexerError(
      "Unterminated block comment",
      this.startLine,
      this.startColumn
    );
  }

  /**
   * Scans an `@word` directive.
   * The `@` has already been consumed by `scanToken`.
   *
   * @throws {LexerError} if the word after `@` is not a known directive.
   */
  private scanDirective(): void {
    while (!this.isAtEnd() && isIdentPart(this.peek())) {
      this.advance();
    }
    // The word starts after the `@` character (start + 1).
    const word = this.source.slice(this.start + 1, this.current);
    const type = AT_DIRECTIVES[word];
    if (type === undefined) {
      throw new LexerError(
        `Unknown directive '@${word}'`,
        this.startLine,
        this.startColumn
      );
    }
    this.addToken(type, word);
  }

  /**
   * Scans a double-quoted single-line string `"..."`.
   * The opening `"` has already been consumed.
   * Supports escape sequences: `\"`, `\\`, `\n`, `\t`, `\r`.
   * Detects template strings (those containing `{{...}}`) and emits
   * TEMPLATE_STRING instead of STRING.
   *
   * @throws {LexerError} if the string is not closed before end-of-line or EOF.
   */
  private scanString(): void {
    let value = "";
    let hasTemplate = false;

    while (!this.isAtEnd() && this.peek() !== '"') {
      const ch = this.peek();
      if (ch === "\n") {
        throw new LexerError(
          "Unterminated string literal",
          this.startLine,
          this.startColumn
        );
      }
      if (ch === "\\") {
        this.advance(); // consume backslash
        const escaped = this.advance();
        switch (escaped) {
          case '"':
            value += '"';
            break;
          case "\\":
            value += "\\";
            break;
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case "r":
            value += "\r";
            break;
          default:
            throw new LexerError(
              `Unknown escape sequence '\\${escaped}'`,
              this.startLine,
              this.startColumn
            );
        }
      } else if (ch === "{" && this.peekNext() === "{") {
        // Start of a template interpolation — record the whole `{{...}}`
        // as raw text for the parser to handle in v0.3.
        hasTemplate = true;
        value += this.advance(); // {
        value += this.advance(); // {
        while (!this.isAtEnd() && !(this.peek() === "}" && this.peekNext() === "}")) {
          if (this.peek() === "\n") {
            throw new LexerError(
              "Unterminated template interpolation '{{...}}'",
              this.startLine,
              this.startColumn
            );
          }
          value += this.advance();
        }
        if (this.isAtEnd()) {
          throw new LexerError(
            "Unterminated template interpolation '{{...}}'",
            this.startLine,
            this.startColumn
          );
        }
        value += this.advance(); // first }
        value += this.advance(); // second }
      } else {
        value += this.advance();
      }
    }

    if (this.isAtEnd()) {
      throw new LexerError(
        "Unterminated string literal",
        this.startLine,
        this.startColumn
      );
    }

    this.advance(); // closing "
    this.addToken(
      hasTemplate ? TokenType.TEMPLATE_STRING : TokenType.STRING,
      value
    );
  }

  /**
   * Scans a triple-quoted string `"""..."""`.
   * The three opening `"` characters have already been consumed.
   * No escape processing is applied; the raw content is preserved.
   * Template interpolations (`{{...}}`) are detected and cause the token
   * type to be TEMPLATE_STRING.
   *
   * @throws {LexerError} if the closing `"""` is never found.
   */
  private scanTripleString(): void {
    let value = "";
    let hasTemplate = false;

    while (!this.isAtEnd()) {
      // Check for closing `"""`.
      if (
        this.peek() === '"' &&
        this.peekNext() === '"' &&
        this.peekAt(2) === '"'
      ) {
        this.advance(); // "
        this.advance(); // "
        this.advance(); // "
        this.addToken(
          hasTemplate ? TokenType.TEMPLATE_STRING : TokenType.TRIPLE_STRING,
          value
        );
        return;
      }

      // Detect template interpolation presence (content still raw).
      if (this.peek() === "{" && this.peekNext() === "{") {
        hasTemplate = true;
      }

      value += this.advance();
    }

    throw new LexerError(
      `Unterminated triple-quoted string`,
      this.startLine,
      this.startColumn
    );
  }

  /**
   * Scans a numeric literal: integers and decimals.
   * Scientific notation (`1e10`) is not supported in v0.2.
   * The first digit `ch` has already been consumed.
   *
   * @throws {LexerError} if the number is immediately followed by an identifier
   *   character (e.g. `123abc`), or if a second decimal point is found.
   */
  private scanNumber(ch: string): void {
    let value = ch;

    while (!this.isAtEnd() && isDigit(this.peek())) {
      value += this.advance();
    }

    if (this.peek() === "." && isDigit(this.peekNext())) {
      value += this.advance(); // consume "."
      while (!this.isAtEnd() && isDigit(this.peek())) {
        value += this.advance();
      }
    }

    // Reject cases like `123abc` — a number must not be immediately followed
    // by an identifier-start character.
    if (!this.isAtEnd() && isIdentStart(this.peek())) {
      throw new LexerError(
        `Invalid numeric literal '${value}${this.peek()}...' — identifiers cannot start with a digit`,
        this.startLine,
        this.startColumn
      );
    }

    this.addToken(TokenType.NUMBER, value);
  }

  /**
   * Scans an identifier or keyword.
   * After consuming all identifier characters, checks the KEYWORDS map
   * to upgrade IDENT to the appropriate keyword token type.
   *
   * Hyphens are allowed inside identifiers when immediately followed by an
   * alphanumeric character or underscore, to support model names such as
   * `claude-opus-4.7` and CSS-style identifiers. A lone trailing hyphen
   * (e.g. before `>`) is NOT consumed — this keeps `->` unambiguous.
   */
  private scanIdentifier(): void {
    while (!this.isAtEnd()) {
      if (isIdentPart(this.peek())) {
        this.advance();
      } else if (this.peek() === "-" && isIdentPart(this.peekNext())) {
        // Hyphen is part of the identifier only when followed by an ident char.
        this.advance(); // consume -
      } else {
        break;
      }
    }
    const word = this.source.slice(this.start, this.current);
    const type = KEYWORDS[word] ?? TokenType.IDENT;
    this.addToken(type, word);
  }
}

// ---------------------------------------------------------------------------
// Character classification helpers
// ---------------------------------------------------------------------------

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Tokenizes a PromptLang source string and returns the token list.
 * A thin wrapper around `new Lexer(source).tokenize()`.
 *
 * @throws {LexerError} on invalid input.
 */
export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}
