import type { Program } from "../ast/nodes";

/** `eval` blocks parse so files using them stay valid, but no command runs them. */
export function warnAboutEvals(program: Program, file: string): void {
  for (const d of program.declarations) {
    if (d.kind === "EvalDeclaration") {
      console.warn(
        `  [warn]    ${file}:${d.line}:${d.column}: eval blocks are parsed but not executed in this version`
      );
    }
  }
}
