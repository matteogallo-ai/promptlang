/** Thrown when the lexer encounters invalid input it cannot tokenize. */
export class LexerError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number
  ) {
    super(`[Lexer] Line ${line}, Column ${column}: ${message}`);
    this.name = "LexerError";
  }
}
