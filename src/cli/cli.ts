#!/usr/bin/env bun

import { runParse } from "./commands/parse";
import { runTokens } from "./commands/tokens";
import { runAnalyze } from "./commands/analyze";
import { runVersion } from "./commands/version";

const HELP = `
promptlang — the typed language for production-grade LLM prompts

Usage:
  promptlang <command> [args]

Commands:
  parse <file>              Print AST of a .prompt file
  tokens <file>             Print token stream of a .prompt file
  analyze <path> [flags]    Run static analysis on .prompt files
                            Flags: --json, --strict
  version                   Show version and repository info

Examples:
  promptlang parse docs/examples/classify-ticket.prompt
  promptlang tokens docs/examples/extract-invoice.prompt
  promptlang analyze docs/examples/
  promptlang analyze 'src/**/*.prompt' --json --strict
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
