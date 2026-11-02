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

/**
 * AnthropicClient leaves `temperature` out (API version 2026-10-21 rejects it),
 * so a Claude file's `@temperature` would otherwise be dropped without notice.
 */
export function warnAboutTemperature(program: Program, file: string): void {
  const model = program.metadata.find((m) => m.kind === "ModelMetadata");
  const temperature = program.metadata.find((m) => m.kind === "TemperatureMetadata");
  if (!temperature || !model?.value.startsWith("claude-")) return;
  console.warn(
    `  [warn]    ${file}:${temperature.line}:${temperature.column}: @temperature is not sent to Anthropic (API version 2026-10-21 rejects it); it applies to OpenAI and Ollama only`
  );
}
