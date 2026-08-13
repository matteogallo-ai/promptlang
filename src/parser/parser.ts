import { Token, TokenType } from "../lexer/token";
import {
  Program,
  ImportDeclaration,
  Metadata,
  Declaration,
  TypeDeclaration,
  PromptDeclaration,
  ChainDeclaration,
  TestDeclaration,
  EvalDeclaration,
  TypeExpression,
  PrimitiveType,
  EnumType,
  StructType,
  TypeReference,
  Field,
  Parameter,
  PromptSection,
  MessageSection,
  OutputSection,
  ChainStep,
  Expression,
  CallExpression,
  CallArgument,
  NamedArgument,
  MemberExpression,
  Identifier,
  Expectation,
  Literal,
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  VersionMetadata,
  ModelMetadata,
  TemperatureMetadata,
  MaxTokensMetadata,
  BreakingChangesMetadata,
  MigrationFromMetadata,
  DescriptionMetadata,
} from "../ast/nodes";
import { ParserError } from "./errors";

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Recursive descent parser for PromptLang.
 * Consumes a flat token list (from the Lexer) and produces a typed AST.
 * NEWLINE, COMMENT_LINE, and COMMENT_BLOCK tokens are discarded on construction.
 */
export class Parser {
  private readonly tokens: Token[];
  private current = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens.filter(
      (t) =>
        t.type !== TokenType.NEWLINE &&
        t.type !== TokenType.COMMENT_LINE &&
        t.type !== TokenType.COMMENT_BLOCK
    );
  }

  /** Parses the entire token stream and returns the root Program node. */
  parse(): Program {
    return this.parseProgram();
  }

  // ---------------------------------------------------------------------------
  // Primitives
  // ---------------------------------------------------------------------------

  /** Returns the current token without consuming it. */
  private peek(): Token {
    return this.tokens[this.current]!;
  }

  /** Returns the token at `offset` positions ahead of current, or EOF. */
  private peekAhead(offset: number): Token {
    const idx = this.current + offset;
    return idx < this.tokens.length ? this.tokens[idx]! : this.tokens[this.tokens.length - 1]!;
  }

  /** Returns the most recently consumed token. */
  private previous(): Token {
    return this.tokens[this.current - 1]!;
  }

  /** Returns true when the current token is EOF. */
  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  /** Consumes and returns the current token. */
  private advance(): Token {
    if (!this.isAtEnd()) this.current++;
    return this.previous();
  }

  /** Returns true (without consuming) if the current token has the given type. */
  private check(type: TokenType): boolean {
    return !this.isAtEnd() && this.peek().type === type;
  }

  /**
   * Consumes the current token if it matches any of the given types.
   * Returns true on match.
   */
  private match(...types: TokenType[]): boolean {
    for (const type of types) {
      if (this.check(type)) {
        this.advance();
        return true;
      }
    }
    return false;
  }

  /**
   * Consumes and returns the current token if it matches `type`.
   * Throws a ParserError with a pedagogical message if it does not.
   */
  private expect(type: TokenType, message: string): Token {
    if (this.check(type)) return this.advance();
    const tok = this.peek();
    throw new ParserError(message, tok.line, tok.column, type, tok.type);
  }

  /**
   * Consumes and returns the current token if it is IDENT or any keyword token
   * that can legally appear in identifier position (field name, parameter name,
   * member property, named-arg key). The returned token's `.value` is the name.
   */
  private parseAnyIdent(errorMessage: string): Token {
    const tok = this.peek();
    if (tok.type === TokenType.IDENT || this.isKeywordUsableAsIdent(tok.type)) {
      return this.advance();
    }
    throw new ParserError(errorMessage, tok.line, tok.column, TokenType.IDENT, tok.type);
  }

  /** Returns true for keyword token types that may appear in identifier positions. */
  private isKeywordUsableAsIdent(type: TokenType): boolean {
    switch (type) {
      case TokenType.PROMPT:
      case TokenType.TYPE:
      case TokenType.CHAIN:
      case TokenType.TEST:
      case TokenType.EVAL:
      case TokenType.STEP:
      case TokenType.RETURN:
      case TokenType.ENUM:
      case TokenType.STRUCT:
      case TokenType.STRING_TYPE:
      case TokenType.NUMBER_TYPE:
      case TokenType.BOOLEAN_TYPE:
      case TokenType.DATE_TYPE:
      case TokenType.SYSTEM:
      case TokenType.USER:
      case TokenType.ASSISTANT:
      case TokenType.OUTPUT:
      case TokenType.INPUT:
      case TokenType.EXPECT:
      case TokenType.DATASET:
      case TokenType.METRIC:
      case TokenType.THRESHOLD:
        return true;
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Program
  // ---------------------------------------------------------------------------

  /** Program ::= Import* Metadata* Declaration* */
  private parseProgram(): Program {
    const tok = this.peek();
    const imports: ImportDeclaration[] = [];
    const metadata: Metadata[] = [];
    const declarations: Declaration[] = [];

    while (!this.isAtEnd() && this.check(TokenType.IMPORT)) {
      imports.push(this.parseImport());
    }

    while (!this.isAtEnd() && this.isMetadataStart()) {
      metadata.push(this.parseMetadata());
    }

    // An import that appears after metadata or a declaration is a hard error;
    // imports are only legal at the top of the file.
    if (!this.isAtEnd() && this.check(TokenType.IMPORT)) {
      const t = this.peek();
      throw new ParserError(
        "'import' must appear at the top of the file, before any metadata (@...) or declarations.",
        t.line,
        t.column
      );
    }

    while (!this.isAtEnd()) {
      declarations.push(this.parseDeclaration());
    }

    return {
      kind: "Program",
      imports,
      metadata,
      declarations,
      line: tok.line,
      column: tok.column,
    };
  }

  /** Import ::= "import" StringLit "as" IDENT */
  private parseImport(): ImportDeclaration {
    const tok = this.expect(TokenType.IMPORT, "Expected 'import'");
    const pathTok = this.peek();
    if (
      pathTok.type !== TokenType.STRING &&
      pathTok.type !== TokenType.TRIPLE_STRING &&
      pathTok.type !== TokenType.TEMPLATE_STRING
    ) {
      throw new ParserError(
        `Expected a string path after 'import', e.g. import "shared/x.prompt" as X`,
        pathTok.line,
        pathTok.column,
        "STRING",
        pathTok.type
      );
    }
    if (pathTok.type === TokenType.TEMPLATE_STRING) {
      throw new ParserError(
        "Import path cannot contain template interpolation '{{...}}'.",
        pathTok.line,
        pathTok.column
      );
    }
    this.advance();
    this.expect(
      TokenType.AS,
      `Expected 'as' after import path — imports must have an alias, e.g. import "${pathTok.value}" as MyAlias`
    );
    const alias = this.expect(TokenType.IDENT, "Expected an alias identifier after 'as'");
    return {
      kind: "ImportDeclaration",
      path: pathTok.value,
      alias: alias.value,
      line: tok.line,
      column: tok.column,
    };
  }

  private isMetadataStart(): boolean {
    const t = this.peek().type;
    return (
      t === TokenType.AT_VERSION ||
      t === TokenType.AT_MODEL ||
      t === TokenType.AT_TEMPERATURE ||
      t === TokenType.AT_MAX_TOKENS ||
      t === TokenType.AT_BREAKING_CHANGES ||
      t === TokenType.AT_MIGRATION_FROM ||
      t === TokenType.AT_DESCRIPTION
    );
  }

  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------

  /**
   * Metadata ::= AT_VERSION StringLit
   *            | AT_MODEL IDENT
   *            | AT_TEMPERATURE NumberLit
   *            | AT_MAX_TOKENS NumberLit
   *            | AT_BREAKING_CHANGES StringLit
   *            | AT_MIGRATION_FROM StringLit StringLit
   *            | AT_DESCRIPTION StringLit
   */
  private parseMetadata(): Metadata {
    const tok = this.advance();
    switch (tok.type) {
      case TokenType.AT_VERSION: {
        const str = this.parseStringLit("@version expects a string value, e.g. @version \"1.0.0\"");
        return { kind: "VersionMetadata", value: str.value, line: tok.line, column: tok.column } satisfies VersionMetadata;
      }
      case TokenType.AT_MODEL: {
        // Model names may contain hyphens (consumed by the lexer as part of IDENT)
        // and dots followed by version digits (e.g. claude-opus-4.7 → IDENT "claude-opus-4" DOT NUMBER "7").
        // Reconstruct the full name by consuming IDENT (DOT (NUMBER|IDENT))* segments.
        const ident = this.expect(TokenType.IDENT, "@model expects an identifier, e.g. @model claude-opus-4.7");
        let name = ident.value;
        while (this.check(TokenType.DOT)) {
          const after = this.peekAhead(1);
          if (after.type === TokenType.NUMBER || after.type === TokenType.IDENT) {
            this.advance(); // DOT
            name += "." + this.advance().value;
          } else {
            break;
          }
        }
        return { kind: "ModelMetadata", value: name, line: tok.line, column: tok.column } satisfies ModelMetadata;
      }
      case TokenType.AT_TEMPERATURE: {
        const num = this.parseNumberLit("@temperature expects a number, e.g. @temperature 0.3");
        return { kind: "TemperatureMetadata", value: num.value, line: tok.line, column: tok.column } satisfies TemperatureMetadata;
      }
      case TokenType.AT_MAX_TOKENS: {
        const num = this.parseNumberLit("@max_tokens expects a number, e.g. @max_tokens 2048");
        return { kind: "MaxTokensMetadata", value: num.value, line: tok.line, column: tok.column } satisfies MaxTokensMetadata;
      }
      case TokenType.AT_BREAKING_CHANGES: {
        const str = this.parseStringLit("@breaking_changes expects a string");
        return { kind: "BreakingChangesMetadata", value: str.value, line: tok.line, column: tok.column } satisfies BreakingChangesMetadata;
      }
      case TokenType.AT_MIGRATION_FROM: {
        const from = this.parseStringLit("@migration_from expects two strings: the old version and the new version");
        const to = this.parseStringLit("@migration_from expects a second string for the new version");
        return { kind: "MigrationFromMetadata", from: from.value, to: to.value, line: tok.line, column: tok.column } satisfies MigrationFromMetadata;
      }
      case TokenType.AT_DESCRIPTION: {
        const str = this.parseStringLit("@description expects a string value");
        return { kind: "DescriptionMetadata", value: str.value, line: tok.line, column: tok.column } satisfies DescriptionMetadata;
      }
      default:
        throw new ParserError(`Unknown metadata directive`, tok.line, tok.column);
    }
  }

  // ---------------------------------------------------------------------------
  // Declarations
  // ---------------------------------------------------------------------------

  /**
   * Declaration ::= TypeDeclaration | PromptDeclaration | ChainDeclaration
   *               | TestDeclaration | EvalDeclaration
   */
  private parseDeclaration(): Declaration {
    const tok = this.peek();
    switch (tok.type) {
      case TokenType.TYPE:
        return this.parseTypeDeclaration();
      case TokenType.PROMPT:
        return this.parsePromptDeclaration();
      case TokenType.CHAIN:
        return this.parseChainDeclaration();
      case TokenType.TEST:
        return this.parseTestDeclaration();
      case TokenType.EVAL:
        return this.parseEvalDeclaration();
      default:
        throw new ParserError(
          `Expected a declaration ('type', 'prompt', 'chain', 'test', or 'eval') but found '${tok.value}'.`,
          tok.line,
          tok.column,
          "declaration keyword",
          tok.type
        );
    }
  }

  // ---------------------------------------------------------------------------
  // TypeDeclaration
  // ---------------------------------------------------------------------------

  /** TypeDeclaration ::= "type" IDENT "=" TypeExpression */
  private parseTypeDeclaration(): TypeDeclaration {
    const tok = this.expect(TokenType.TYPE, "Expected 'type' keyword");
    const name = this.expect(TokenType.IDENT, "Expected a type name after 'type'");
    this.expect(TokenType.EQUAL, `Expected '=' after type name '${name.value}'`);
    const definition = this.parseTypeExpression();
    return { kind: "TypeDeclaration", name: name.value, definition, line: tok.line, column: tok.column };
  }

  // ---------------------------------------------------------------------------
  // TypeExpression
  // ---------------------------------------------------------------------------

  /**
   * TypeExpression ::= EnumType | StructType | PrimitiveType | TypeReference
   */
  private parseTypeExpression(): TypeExpression {
    const tok = this.peek();
    switch (tok.type) {
      case TokenType.ENUM:
        return this.parseEnumType();
      case TokenType.STRUCT:
        return this.parseStructType();
      case TokenType.STRING_TYPE:
        this.advance();
        return { kind: "PrimitiveType", name: "string", line: tok.line, column: tok.column } satisfies PrimitiveType;
      case TokenType.NUMBER_TYPE:
        this.advance();
        return { kind: "PrimitiveType", name: "number", line: tok.line, column: tok.column } satisfies PrimitiveType;
      case TokenType.BOOLEAN_TYPE:
        this.advance();
        return { kind: "PrimitiveType", name: "boolean", line: tok.line, column: tok.column } satisfies PrimitiveType;
      case TokenType.DATE_TYPE:
        this.advance();
        return { kind: "PrimitiveType", name: "date", line: tok.line, column: tok.column } satisfies PrimitiveType;
      case TokenType.IDENT: {
        this.advance();
        return { kind: "TypeReference", name: tok.value, line: tok.line, column: tok.column } satisfies TypeReference;
      }
      default:
        throw new ParserError(
          `Expected a type expression (primitive, enum, struct, or a named type) but found '${tok.value}'.`,
          tok.line,
          tok.column,
          "type expression",
          tok.type
        );
    }
  }

  /** EnumType ::= "enum" "{" IdentifierList "}" */
  private parseEnumType(): EnumType {
    const tok = this.expect(TokenType.ENUM, "Expected 'enum'");
    this.expect(TokenType.LBRACE, "Expected '{' after 'enum'");
    const values = this.parseIdentifierList();
    this.expect(TokenType.RBRACE, "Expected '}' to close enum body");
    return { kind: "EnumType", values, line: tok.line, column: tok.column };
  }

  /** IdentifierList ::= IDENT ("," IDENT)* ","? */
  private parseIdentifierList(): string[] {
    const values: string[] = [];
    if (this.check(TokenType.RBRACE)) return values;
    values.push(this.parseAnyIdent("Expected an enum member name").value);
    while (this.match(TokenType.COMMA)) {
      if (this.check(TokenType.RBRACE)) break; // trailing comma
      values.push(this.parseAnyIdent("Expected an enum member name after ','").value);
    }
    return values;
  }

  /** StructType ::= "struct" "{" FieldList "}" */
  private parseStructType(): StructType {
    const tok = this.expect(TokenType.STRUCT, "Expected 'struct'");
    this.expect(TokenType.LBRACE, "Expected '{' after 'struct'");
    const fields = this.parseFieldList();
    this.expect(TokenType.RBRACE, "Expected '}' to close struct body");
    return { kind: "StructType", fields, line: tok.line, column: tok.column };
  }

  /** FieldList ::= Field ("," Field)* ","? — uses newline as separator too */
  private parseFieldList(): Field[] {
    const fields: Field[] = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      fields.push(this.parseField());
      // Fields may be separated by commas, or simply by newlines (already stripped).
      this.match(TokenType.COMMA);
    }
    return fields;
  }

  /** Field ::= IDENT "?"? ":" TypeExpression */
  private parseField(): Field {
    const nameTok = this.parseAnyIdent("Expected a field name");
    const optional = this.match(TokenType.QUESTION);
    this.expect(TokenType.COLON, `Expected ':' after field name '${nameTok.value}${optional ? "?" : ""}'`);
    const type = this.parseTypeExpression();
    return { kind: "Field", name: nameTok.value, optional, type, line: nameTok.line, column: nameTok.column };
  }

  // ---------------------------------------------------------------------------
  // PromptDeclaration
  // ---------------------------------------------------------------------------

  /**
   * PromptDeclaration ::= "prompt" IDENT "(" ParameterList? ")" "->" TypeExpression "{"
   *                          PromptSection+
   *                        "}"
   */
  private parsePromptDeclaration(): PromptDeclaration {
    const tok = this.expect(TokenType.PROMPT, "Expected 'prompt'");
    const name = this.expect(TokenType.IDENT, "Expected a prompt name after 'prompt'");
    this.expect(TokenType.LPAREN, `Expected '(' after prompt name '${name.value}'`);
    const parameters = this.check(TokenType.RPAREN) ? [] : this.parseParameterList();
    this.expect(TokenType.RPAREN, "Expected ')' to close parameter list. Did you forget a comma between parameters?");
    this.expect(TokenType.ARROW, `Expected '->' after parameter list for prompt '${name.value}'`);
    const returnType = this.parseTypeExpression();
    this.expect(TokenType.LBRACE, `Expected '{' to open prompt body for '${name.value}'`);
    const sections = this.parsePromptBody();
    this.expect(TokenType.RBRACE, `Expected '}' to close prompt body for '${name.value}'`);
    return { kind: "PromptDeclaration", name: name.value, parameters, returnType, sections, line: tok.line, column: tok.column };
  }

  /** ParameterList ::= Parameter ("," Parameter)* */
  private parseParameterList(): Parameter[] {
    const params: Parameter[] = [];
    params.push(this.parseParameter());
    while (this.match(TokenType.COMMA)) {
      params.push(this.parseParameter());
    }
    return params;
  }

  /** Parameter ::= IDENT ":" TypeExpression */
  private parseParameter(): Parameter {
    const nameTok = this.parseAnyIdent("Expected a parameter name");
    this.expect(TokenType.COLON, `Expected ':' after parameter name '${nameTok.value}'`);
    const type = this.parseTypeExpression();
    return { kind: "Parameter", name: nameTok.value, type, line: nameTok.line, column: nameTok.column };
  }

  /** PromptBody ::= PromptSection+ */
  private parsePromptBody(): PromptSection[] {
    const sections: PromptSection[] = [];
    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      sections.push(this.parsePromptSection());
    }
    if (sections.length === 0) {
      const tok = this.peek();
      throw new ParserError("Prompt body must contain at least one section (system, user, assistant, or output).", tok.line, tok.column);
    }
    return sections;
  }

  /**
   * PromptSection ::= ("system" | "user" | "assistant") ":" StringLit
   *                 | "output" ":" TypeExpression
   */
  private parsePromptSection(): PromptSection {
    const tok = this.peek();
    if (this.match(TokenType.SYSTEM, TokenType.USER, TokenType.ASSISTANT)) {
      const role = this.previous().value as "system" | "user" | "assistant";
      this.expect(TokenType.COLON, `Expected ':' after '${role}'`);
      const content = this.parseStringLit(`Expected a string after '${role}:'`);
      return { kind: "MessageSection", role, content, line: tok.line, column: tok.column } satisfies MessageSection;
    }
    if (this.match(TokenType.OUTPUT)) {
      this.expect(TokenType.COLON, "Expected ':' after 'output'");
      const type = this.parseTypeExpression();
      return { kind: "OutputSection", type, line: tok.line, column: tok.column } satisfies OutputSection;
    }
    throw new ParserError(
      `Expected a prompt section ('system', 'user', 'assistant', or 'output') but found '${tok.value}'.`,
      tok.line,
      tok.column
    );
  }

  // ---------------------------------------------------------------------------
  // ChainDeclaration
  // ---------------------------------------------------------------------------

  /**
   * ChainDeclaration ::= "chain" IDENT "(" ParameterList? ")" "->" TypeExpression "{"
   *                        ChainStep+
   *                        "return" Expression
   *                      "}"
   */
  private parseChainDeclaration(): ChainDeclaration {
    const tok = this.expect(TokenType.CHAIN, "Expected 'chain'");
    const name = this.expect(TokenType.IDENT, "Expected a chain name after 'chain'");
    this.expect(TokenType.LPAREN, `Expected '(' after chain name '${name.value}'`);
    const parameters = this.check(TokenType.RPAREN) ? [] : this.parseParameterList();
    this.expect(TokenType.RPAREN, "Expected ')' to close parameter list");
    this.expect(TokenType.ARROW, `Expected '->' after parameter list for chain '${name.value}'`);
    const returnType = this.parseTypeExpression();
    this.expect(TokenType.LBRACE, `Expected '{' to open chain body for '${name.value}'`);
    const steps = this.parseChainBody();
    this.expect(TokenType.RETURN, "Expected 'return' statement at the end of chain body");
    const returnExpression = this.parseExpression();
    this.expect(TokenType.RBRACE, `Expected '}' to close chain body for '${name.value}'`);
    return { kind: "ChainDeclaration", name: name.value, parameters, returnType, steps, returnExpression, line: tok.line, column: tok.column };
  }

  /** Parse chain steps until a 'return' token is seen. */
  private parseChainBody(): ChainStep[] {
    const steps: ChainStep[] = [];
    while (!this.check(TokenType.RETURN) && !this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      steps.push(this.parseChainStep());
    }
    if (steps.length === 0) {
      const tok = this.peek();
      throw new ParserError("Chain body must contain at least one 'step' before 'return'.", tok.line, tok.column);
    }
    return steps;
  }

  /** ChainStep ::= "step" IDENT "=" Expression */
  private parseChainStep(): ChainStep {
    const tok = this.expect(TokenType.STEP, "Expected 'step' inside chain body");
    const name = this.expect(TokenType.IDENT, "Expected a step name after 'step'");
    this.expect(TokenType.EQUAL, `Expected '=' after step name '${name.value}'`);
    const expression = this.parseExpression();
    return { kind: "ChainStep", name: name.value, expression, line: tok.line, column: tok.column };
  }

  // ---------------------------------------------------------------------------
  // Expressions
  // ---------------------------------------------------------------------------

  /**
   * Expression ::= IDENT "(" ArgumentList? ")"   (CallExpression)
   *              | IDENT "." IDENT                (MemberExpression)
   *              | IDENT                          (Identifier)
   *              | Literal
   */
  private parseExpression(): Expression {
    const tok = this.peek();

    // Literal expressions (string, number, bool)
    if (
      tok.type === TokenType.STRING ||
      tok.type === TokenType.TRIPLE_STRING ||
      tok.type === TokenType.TEMPLATE_STRING
    ) {
      return this.parseStringLit("Expected a string literal");
    }
    if (tok.type === TokenType.NUMBER) {
      return this.parseNumberLit("Expected a number literal");
    }
    if (tok.type === TokenType.TRUE || tok.type === TokenType.FALSE) {
      this.advance();
      return { kind: "BooleanLiteral", value: tok.type === TokenType.TRUE, line: tok.line, column: tok.column } satisfies BooleanLiteral;
    }

    // IDENT-based expressions: need 1-token lookahead to disambiguate
    if (tok.type === TokenType.IDENT) {
      const next = this.peekAhead(1);
      if (next.type === TokenType.LPAREN) {
        return this.parseCallExpression();
      }
      if (next.type === TokenType.DOT) {
        return this.parseMemberExpression();
      }
      this.advance();
      return { kind: "Identifier", name: tok.value, line: tok.line, column: tok.column } satisfies Identifier;
    }

    throw new ParserError(
      `Expected an expression (identifier, call, member access, or literal) but found '${tok.value}'.`,
      tok.line,
      tok.column
    );
  }

  /** CallExpression ::= IDENT "(" ArgumentList? ")" */
  private parseCallExpression(): CallExpression {
    const callee = this.expect(TokenType.IDENT, "Expected function name");
    this.expect(TokenType.LPAREN, `Expected '(' after '${callee.value}'`);
    const args: CallArgument[] = this.check(TokenType.RPAREN) ? [] : this.parseArgumentList();
    this.expect(TokenType.RPAREN, `Expected ')' to close argument list for '${callee.value}'. Did you forget a comma?`);
    return { kind: "CallExpression", callee: callee.value, arguments: args, line: callee.line, column: callee.column };
  }

  /**
   * ArgumentList ::= CallArgument ("," CallArgument)*
   * CallArgument ::= IDENT ":" Expression    (NamedArgument)
   *               | Expression               (positional)
   *
   * Disambiguation: IDENT followed by COLON is always a named argument,
   * since COLON cannot appear after a bare expression in any other context.
   */
  private parseArgumentList(): CallArgument[] {
    const args: CallArgument[] = [];
    do {
      if (
        (this.peek().type === TokenType.IDENT || this.isKeywordUsableAsIdent(this.peek().type)) &&
        this.peekAhead(1).type === TokenType.COLON
      ) {
        const nameTok = this.advance(); // IDENT or keyword used as name
        this.advance(); // COLON
        const value = this.parseExpression();
        args.push({ kind: "NamedArgument", name: nameTok.value, value, line: nameTok.line, column: nameTok.column } satisfies NamedArgument);
      } else {
        args.push(this.parseExpression());
      }
    } while (this.match(TokenType.COMMA) && !this.check(TokenType.RPAREN));
    return args;
  }

  /** MemberExpression ::= IDENT "." IDENT */
  private parseMemberExpression(): MemberExpression {
    const obj = this.expect(TokenType.IDENT, "Expected object name");
    this.expect(TokenType.DOT, "Expected '.' in member access");
    const prop = this.parseAnyIdent(`Expected property name after '${obj.value}.'`);
    return { kind: "MemberExpression", object: obj.value, property: prop.value, line: obj.line, column: obj.column };
  }

  // ---------------------------------------------------------------------------
  // TestDeclaration
  // ---------------------------------------------------------------------------

  /**
   * TestDeclaration ::= "test" StringLit "{"
   *                       "input" ":" Expression
   *                       Expectation+
   *                     "}"
   */
  private parseTestDeclaration(): TestDeclaration {
    const tok = this.expect(TokenType.TEST, "Expected 'test'");
    const desc = this.parseStringLit("Expected a test description string after 'test'");
    this.expect(TokenType.LBRACE, "Expected '{' to open test body");
    this.expect(TokenType.INPUT, "Expected 'input' as the first statement in a test body");
    this.expect(TokenType.COLON, "Expected ':' after 'input'");
    const input = this.parseExpression();
    const expectations = this.parseExpectations();
    this.expect(TokenType.RBRACE, "Expected '}' to close test body");
    return { kind: "TestDeclaration", description: desc.value, input, expectations, line: tok.line, column: tok.column };
  }

  /**
   * Expectation+ — at least one expect clause.
   * Expectation ::= "expect" ":" Literal
   *               | "expect" "." IDENT ":" Literal
   */
  private parseExpectations(): Expectation[] {
    const expectations: Expectation[] = [];
    while (this.check(TokenType.EXPECT)) {
      expectations.push(this.parseExpectation());
    }
    if (expectations.length === 0) {
      const tok = this.peek();
      throw new ParserError("Test body must contain at least one 'expect' clause.", tok.line, tok.column);
    }
    return expectations;
  }

  private parseExpectation(): Expectation {
    const tok = this.expect(TokenType.EXPECT, "Expected 'expect'");
    const path: string[] = ["expect"];

    if (this.match(TokenType.DOT)) {
      const field = this.parseAnyIdent("Expected a field name after 'expect.'");
      path.push(field.value);
    }

    this.expect(TokenType.COLON, `Expected ':' after '${path.join(".")}'`);
    const value = this.parseLiteral();
    return { kind: "Expectation", path, value, line: tok.line, column: tok.column };
  }

  // ---------------------------------------------------------------------------
  // EvalDeclaration
  // ---------------------------------------------------------------------------

  /**
   * EvalDeclaration ::= "eval" StringLit "{"
   *                       "dataset"   ":" StringLit
   *                       "prompt"    ":" IDENT
   *                       "metric"    ":" IDENT
   *                       "threshold" ":" NumberLit
   *                     "}"
   */
  private parseEvalDeclaration(): EvalDeclaration {
    const tok = this.expect(TokenType.EVAL, "Expected 'eval'");
    const desc = this.parseStringLit("Expected a description string after 'eval'");
    this.expect(TokenType.LBRACE, "Expected '{' to open eval body");

    this.expect(TokenType.DATASET, "Expected 'dataset' as the first field in an eval body");
    this.expect(TokenType.COLON, "Expected ':' after 'dataset'");
    const dataset = this.parseStringLit("Expected a string for 'dataset'");

    // 'prompt' is a keyword, so we use PROMPT token here.
    this.expect(TokenType.PROMPT, "Expected 'prompt' field in eval body");
    this.expect(TokenType.COLON, "Expected ':' after 'prompt'");
    const promptName = this.expect(TokenType.IDENT, "Expected a prompt name after 'prompt:'");

    this.expect(TokenType.METRIC, "Expected 'metric' field in eval body");
    this.expect(TokenType.COLON, "Expected ':' after 'metric'");
    const metric = this.expect(TokenType.IDENT, "Expected a metric name after 'metric:'");

    this.expect(TokenType.THRESHOLD, "Expected 'threshold' field in eval body");
    this.expect(TokenType.COLON, "Expected ':' after 'threshold'");
    const threshold = this.parseNumberLit("Expected a number for 'threshold'");

    this.expect(TokenType.RBRACE, "Expected '}' to close eval body");

    return {
      kind: "EvalDeclaration",
      description: desc.value,
      dataset: dataset.value,
      promptName: promptName.value,
      metric: metric.value,
      threshold: threshold.value,
      line: tok.line,
      column: tok.column,
    };
  }

  // ---------------------------------------------------------------------------
  // Literals
  // ---------------------------------------------------------------------------

  /** Literal ::= StringLit | NumberLit | "true" | "false" | Identifier */
  private parseLiteral(): Literal {
    const tok = this.peek();
    if (
      tok.type === TokenType.STRING ||
      tok.type === TokenType.TRIPLE_STRING ||
      tok.type === TokenType.TEMPLATE_STRING
    ) {
      return this.parseStringLit("Expected a literal value");
    }
    if (tok.type === TokenType.NUMBER) {
      return this.parseNumberLit("Expected a literal value");
    }
    if (tok.type === TokenType.TRUE) {
      this.advance();
      return { kind: "BooleanLiteral", value: true, line: tok.line, column: tok.column } satisfies BooleanLiteral;
    }
    if (tok.type === TokenType.FALSE) {
      this.advance();
      return { kind: "BooleanLiteral", value: false, line: tok.line, column: tok.column } satisfies BooleanLiteral;
    }
    if (tok.type === TokenType.IDENT) {
      this.advance();
      return { kind: "Identifier", name: tok.value, line: tok.line, column: tok.column } satisfies Identifier;
    }
    throw new ParserError(
      `Expected a literal value (string, number, boolean, or identifier) but found '${tok.value}'.`,
      tok.line,
      tok.column
    );
  }

  /** Parses STRING | TRIPLE_STRING | TEMPLATE_STRING and returns a StringLiteral node. */
  private parseStringLit(errorMessage: string): StringLiteral {
    const tok = this.peek();
    if (
      tok.type === TokenType.STRING ||
      tok.type === TokenType.TRIPLE_STRING ||
      tok.type === TokenType.TEMPLATE_STRING
    ) {
      this.advance();
      return {
        kind: "StringLiteral",
        value: tok.value,
        isTemplate: tok.type === TokenType.TEMPLATE_STRING,
        line: tok.line,
        column: tok.column,
      };
    }
    throw new ParserError(errorMessage, tok.line, tok.column, "STRING", tok.type);
  }

  /** Parses a NUMBER token and returns a NumberLiteral node. */
  private parseNumberLit(errorMessage: string): NumberLiteral {
    const tok = this.peek();
    if (tok.type === TokenType.NUMBER) {
      this.advance();
      return { kind: "NumberLiteral", value: parseFloat(tok.value), line: tok.line, column: tok.column };
    }
    throw new ParserError(errorMessage, tok.line, tok.column, "NUMBER", tok.type);
  }
}

// ---------------------------------------------------------------------------
// Convenience function
// ---------------------------------------------------------------------------

/**
 * Parses a PromptLang token stream and returns the root Program AST node.
 * A thin wrapper around `new Parser(tokens).parse()`.
 *
 * @throws {ParserError} on any grammar violation.
 */
export function parse(tokens: Token[]): Program {
  return new Parser(tokens).parse();
}
