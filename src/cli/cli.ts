#!/usr/bin/env bun

import { runParse } from "./commands/parse";
import { runTokens } from "./commands/tokens";
import { runAnalyze } from "./commands/analyze";
import { runVersion } from "./commands/version";
import { runCompile } from "./commands/compile";

const HELP = `
promptlang — the typed language for production-grade LLM prompts

Usage:
  promptlang <command> [args]

Commands:
  parse <file>              Print AST of a .prompt file
  tokens <file>             Print token stream of a .prompt file
  analyze <path> [flags]    Run static analysis on .prompt files
                            Flags: --json, --strict
  compile <path> [flags]    Compile .prompt files to TypeScript
                            Flags: --out <dir>
                                   --emit-tsconfig  Emit a tsconfig.json with
                                     the correct paths mapping for promptlang/runtime.
                                     Use this for local/alpha development before
                                     promptlang is published to npm (v1.0).
                                   --runtime-path <path>  Override the path to
                                     promptlang/runtime in the emitted tsconfig
                                     (default: relative path to src/runtime/index.ts).
  version                   Show version and repository info

Examples:
  promptlang parse docs/examples/classify-ticket.prompt
  promptlang tokens docs/examples/extract-invoice.prompt
  promptlang analyze docs/examples/
  promptlang compile docs/examples/ --out ./generated
  promptlang compile docs/examples/ --out ./generated --emit-tsconfig
`.trim();

export async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case "parse":
        return await runParse(args.slice(1));
      case "tokens":
        return await runTokens(args.slice(1));
      case "analyze":
        return await runAnalyze(args.slice(1));
      case "compile":
        return await runCompile(args.slice(1));
      case "version":
        return runVersion();
      case undefined:
      case "help":
      case "--help":
      case "-h":
        console.log(HELP);
        return 0;
      default:
        console.error(`Unknown command: ${command}\n\n${HELP}`);
        return 1;
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv));
}
