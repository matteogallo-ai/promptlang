import { TokenType } from "../lexer/token";

/** Thrown when the parser encounters a token sequence that violates the grammar. */
export class ParserError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
    public readonly expected?: TokenType | string,
    public readonly found?: TokenType | string
  ) {
    super(`[Parser] Line ${line}, Column ${column}: ${message}`);
    this.name = "ParserError";
  }
}
