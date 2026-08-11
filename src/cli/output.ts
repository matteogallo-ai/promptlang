export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RED = "\x1b[31m";
export const YELLOW = "\x1b[33m";
export const BLUE = "\x1b[34m";
export const CYAN = "\x1b[36m";
export const WHITE = "\x1b[37m";

export function formatError(
  filePath: string,
  source: string,
  error: { message: string; line: number; column: number }
): string {
  const lines = source.split("\n");
  const errorLine = lines[error.line - 1] ?? "";
  const marker = " ".repeat(Math.max(0, error.column - 1)) + "^";
  return [
    `${filePath}:${error.line}:${error.column}`,
    error.message,
    "",
    `  ${errorLine}`,
    `  ${marker}`,
  ].join("\n");
}
