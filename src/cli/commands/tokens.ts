import { tokenize } from "../../lexer/lexer";
import { LexerError } from "../../lexer/errors";
import { formatError } from "../output";

export async function runTokens(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error("Missing file argument.\nUsage: promptlang tokens <file>");
    return 1;
  }

  const filePath = args[0];
  let source: string;

  try {
    source = await Bun.file(filePath).text();
  } catch {
    console.error(`Could not read file: ${filePath}`);
    return 1;
  }

  try {
    const tokens = tokenize(source);
    for (const token of tokens) {
      console.log(
        `${String(token.line).padStart(3)}:${String(token.column).padStart(3)}  ${token.type.padEnd(20)}  ${JSON.stringify(token.value)}`
      );
    }
    return 0;
  } catch (error) {
    if (error instanceof LexerError) {
      console.error(formatError(filePath, source, error));
      return 1;
    }
    throw error;
  }
}
