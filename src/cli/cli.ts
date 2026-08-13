#!/usr/bin/env bun

import { runParse } from "./commands/parse";
import { runTokens } from "./commands/tokens";
import { runAnalyze } from "./commands/analyze";
import { runVersion } from "./commands/version";
import { runCompile } from "./commands/compile";
import { runInit } from "./commands/init";
import { runInstall } from "./commands/install";
import { runList } from "./commands/list";
import { runCheck } from "./commands/check";

const HELP = `
promptlang — the typed language for production-grade LLM prompts

Usage:
  promptlang <command> [args]

Commands:

Project commands:
  init                      Scaffold a new project (promptlang.yaml + prompts/)
  install                   Resolve imports and write .promptlang/manifest.json
  list [--json]             List every prompt in the project (local + imported)
  check                     Verify integrity + import resolution

File commands:
  parse <file>              Print AST of a .prompt file
  tokens <file>             Print token stream of a .prompt file
  analyze <path> [flags]    Run static analysis on .prompt files
                            Flags: --json, --strict, --ai
  compile [path] [flags]    Compile .prompt files to TypeScript or Python.
                            When no path is given, reads sources from
                            promptlang.yaml.
                            Flags: --out <dir>
                                   --target typescript|python
                                   --config <path>  Alternative config file
                                   --emit-tsconfig  Emit tsconfig.json with
                                     the correct paths mapping for
                                     promptlang/runtime.
                                   --runtime-path <path>  Override the path to
                                     promptlang/runtime in the emitted tsconfig.
  version                   Show version and repository info

Examples:
  promptlang init
  promptlang install
  promptlang compile
  promptlang parse docs/examples/classify-ticket.prompt
  promptlang analyze docs/examples/
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
      case "init":
        return await runInit(args.slice(1));
      case "install":
        return await runInstall(args.slice(1));
      case "list":
        return await runList(args.slice(1));
      case "check":
        return await runCheck(args.slice(1));
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
