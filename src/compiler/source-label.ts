/**
 * A source path as it may appear in a generated header or docstring. The path
 * is user input: a newline in it would end a `//` comment and start code, and
 * `"""` would close a Python docstring. Escaped as in a JSON string, it stays
 * readable and cannot leave the comment or string it is written into.
 */
export function sourceLabel(path: string): string {
  return JSON.stringify(path).slice(1, -1);
}
