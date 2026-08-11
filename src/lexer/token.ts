/** All token types produced by the PromptLang lexer. */
export enum TokenType {
  // Metadata directives
  AT_VERSION = "AT_VERSION",
  AT_MODEL = "AT_MODEL",
  AT_TEMPERATURE = "AT_TEMPERATURE",
  AT_MAX_TOKENS = "AT_MAX_TOKENS",
  AT_BREAKING_CHANGES = "AT_BREAKING_CHANGES",
  AT_MIGRATION_FROM = "AT_MIGRATION_FROM",

  // Declaration keywords
  PROMPT = "PROMPT",
  TYPE = "TYPE",
  CHAIN = "CHAIN",
  TEST = "TEST",
  EVAL = "EVAL",
  STEP = "STEP",
  RETURN = "RETURN",
  ENUM = "ENUM",
  STRUCT = "STRUCT",

  // Primitive type keywords
  STRING_TYPE = "STRING_TYPE",
  NUMBER_TYPE = "NUMBER_TYPE",
  BOOLEAN_TYPE = "BOOLEAN_TYPE",
  DATE_TYPE = "DATE_TYPE",

  // Prompt section keywords
  SYSTEM = "SYSTEM",
  USER = "USER",
  ASSISTANT = "ASSISTANT",
  OUTPUT = "OUTPUT",
  INPUT = "INPUT",
  EXPECT = "EXPECT",
  DATASET = "DATASET",
  METRIC = "METRIC",
  THRESHOLD = "THRESHOLD",

  // Literals
  STRING = "STRING",
  TRIPLE_STRING = "TRIPLE_STRING",
  TEMPLATE_STRING = "TEMPLATE_STRING",
  NUMBER = "NUMBER",
  TRUE = "TRUE",
  FALSE = "FALSE",

  // Identifiers
  IDENT = "IDENT",

  // Punctuation and operators
  LPAREN = "LPAREN",
  RPAREN = "RPAREN",
  LBRACE = "LBRACE",
  RBRACE = "RBRACE",
  LBRACKET = "LBRACKET",
  RBRACKET = "RBRACKET",
  COLON = "COLON",
  COMMA = "COMMA",
  DOT = "DOT",
  ARROW = "ARROW",
  EQUAL = "EQUAL",
  PIPE = "PIPE",
  QUESTION = "QUESTION",

  // Special
  NEWLINE = "NEWLINE",
  COMMENT_LINE = "COMMENT_LINE",
  COMMENT_BLOCK = "COMMENT_BLOCK",
  EOF = "EOF",
}

/** Source position within a `.prompt` file (1-indexed). */
export interface Position {
  line: number;
  column: number;
}

/** A single lexical token with its type, raw lexeme, and source position. */
export interface Token {
  type: TokenType;
  /** The raw text of the token as it appeared in the source. */
  value: string;
  /** Line number of the first character of this token (1-indexed). */
  line: number;
  /** Column number of the first character of this token (1-indexed). */
  column: number;
}
