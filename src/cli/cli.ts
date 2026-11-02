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
import { runSemverCheck } from "./commands/semver-check";
import { runTest } from "./commands/test";

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
  semver-check [paths] [flags]
                            Fail when a .prompt file's @version does not move
                            by at least what its interface changes require.
                            Flags: --base <git-ref>  (default: origin/main,
                                     else the latest tag)
                                   --json
                            Exit: 0 ok, 1 violation, 2 usage or git error

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
  test <paths> [flags]      Run the test blocks of .prompt files. By default
                            each test's mock: response is replayed through
                            the generated code, with no network call.
                            Flags: --json
                                   --live  Call the provider (Anthropic,
                                     ANTHROPIC_API_KEY) after showing a
                                     worst-case cost estimate and asking
                                   --yes   Approve the estimate without asking
                            Exit: 0 all pass, 1 a failure, 2 usage error
  version                   Show version and repository info

Examples:
  promptlang init
  promptlang install
  promptlang compile
  promptlang parse docs/examples/classify-ticket.prompt
  promptlang analyze docs/examples/
  promptlang compile docs/examples/ --out ./generated --emit-tsconfig
  promptlang semver-check docs/examples/ --base main
  promptlang test docs/examples/
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
      case "semver-check":
        return await runSemverCheck(args.slice(1));
      case "test":
        return await runTest(args.slice(1));
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
