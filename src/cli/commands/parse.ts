import { tokenize } from "../../lexer/lexer";
import { parse } from "../../parser/parser";
import { printAst } from "../../ast/printer";
import { LexerError } from "../../lexer/errors";
import { ParserError } from "../../parser/errors";
import { formatError } from "../output";
import { readSource } from "../read-source";

export async function runParse(args: string[]): Promise<number> {
  if (args.length === 0) {
    console.error("Missing file argument.\nUsage: promptlang parse <file>");
    return 1;
  }

  const filePath = args[0];
  const read = await readSource(filePath);
  if (!read.ok) {
    console.error(read.message);
    return 1;
  }
  const source = read.text;

  try {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    console.log(printAst(ast));
    return 0;
  } catch (error) {
    if (error instanceof LexerError || error instanceof ParserError) {
      console.error(formatError(filePath, source, error));
      return 1;
    }
    throw error;
  }
}
