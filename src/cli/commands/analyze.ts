import { AiLinter } from "../../analyzer/ai/ai-linter";
import { estimateLinterCost } from "../../analyzer/ai/estimate";
import type { PromptClient } from "../../runtime/client";
import { resolveFiles } from "../files";
import { confirmInTerminal, createLiveClient } from "../live";
import { UsageError } from "../usage-error";
import { tokenize } from "../../lexer/lexer";
import { parse } from "../../parser/parser";
import type { AnalysisContext, Issue } from "../../analyzer/analyzer";
import { analyze } from "../../analyzer/analyzer";
import {
  formatTerminalReport,
  formatJsonReport,
  type DeclarationCounts,
} from "../../analyzer/report";

const EXIT_USAGE = 2;

export interface AnalyzeDeps {
  /** Builds the provider client for --ai; tests inject a fake. */
  createClient: () => PromptClient;
  /** Asks the user to approve the estimated spend; true to proceed. */
  confirm: (question: string) => boolean;
}

const defaultDeps: AnalyzeDeps = {
  createClient: () => createLiveClient("--ai"),
  confirm: (question) => confirmInTerminal("--ai", question),
};

export async function runAnalyze(args: string[], deps: AnalyzeDeps = defaultDeps): Promise<number> {
  const jsonOutput = args.includes("--json");
  const strict = args.includes("--strict");
  const aiEnabled = args.includes("--ai");
  const yes = args.includes("--yes");
  const paths = args.filter((a) => !a.startsWith("--"));

  if (yes && !aiEnabled) {
    console.error("Error: --yes only applies to --ai");
    return EXIT_USAGE;
  }

  if (paths.length === 0) {
    console.error(
      "Missing path argument.\nUsage: promptlang analyze <file|dir|glob> [--json] [--strict]"
    );
    return 1;
  }

  const files = await resolveFiles(paths);

  if (files.length === 0) {
    console.error("No .prompt files found at the specified path(s).");
    return 1;
  }

  const contexts: AnalysisContext[] = [];

  const parseErrors: string[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = await Bun.file(file).text();
    } catch {
      console.error(`Could not read file: ${file}`);
      return 1;
    }

    try {
      const tokens = tokenize(source);
      const ast = parse(tokens);
      contexts.push({ file, ast });
    } catch (error) {
      const msg = (error as Error).message;
      console.error(`  [skip] ${file}: ${msg}`);
      parseErrors.push(file);
    }
  }

  if (contexts.length === 0) {
    console.error("No files could be parsed successfully.");
    return 1;
  }

  const staticIssues = analyze(contexts);

  let aiIssues: Issue[] = [];
  if (aiEnabled) {
    let client: PromptClient | undefined;
    try {
      client = deps.createClient();
    } catch (error) {
      // A missing key keeps the static results; anything else is a bug and propagates.
      if (!(error instanceof UsageError)) throw error;
      if (!jsonOutput) {
        console.error(`\n  AI linter error: ${error.message}`);
        console.error("  Static analysis results only.\n");
      }
    }
    if (client) {
      const e = estimateLinterCost(contexts);
      console.error(
        `AI linter estimate: ${e.calls} call(s) on ${e.model}, ~${e.inputTokens} input + ≤${e.maxOutputTokens} output tokens, ≈ $${e.estimatedUsd.toFixed(4)} (every call at its full max_tokens, no retries)`
      );
      if (e.calls > 0 && !yes) {
        let approved: boolean;
        try {
          approved = deps.confirm(`Spend about $${e.estimatedUsd.toFixed(4)}? [y/N] `);
        } catch (error) {
          if (!(error instanceof UsageError)) throw error;
          console.error(`Error: ${error.message}`);
          return EXIT_USAGE;
        }
        if (!approved) {
          console.error("Aborted: no provider call was made.");
          return EXIT_USAGE;
        }
      }
      const aiLinter = new AiLinter({
        client,
        onProgress: (current, total) => {
          if (!jsonOutput) {
            process.stderr.write(`\r  AI analysis: ${current}/${total} prompts...`);
          }
        },
      });
      aiIssues = await aiLinter.analyze(contexts);
      if (!jsonOutput) process.stderr.write("\n");
    }
  }

  const allIssues = [...staticIssues, ...aiIssues];
  const counts = countDeclarations(contexts);

  if (jsonOutput) {
    console.log(formatJsonReport(allIssues, counts, contexts.length));
  } else {
    console.log(formatTerminalReport(allIssues, counts, contexts.length));
  }

  const hasErrors = allIssues.some((i) => i.severity === "error");
  const hasWarnings = allIssues.some((i) => i.severity === "warning");

  if (parseErrors.length > 0) return 1;
  if (hasErrors) return 1;
  if (strict && hasWarnings) return 1;
  return 0;
}

function countDeclarations(contexts: AnalysisContext[]): DeclarationCounts {
  const counts: DeclarationCounts = { prompts: 0, chains: 0, tests: 0, evals: 0 };
  for (const ctx of contexts) {
    for (const decl of ctx.ast.declarations) {
      if (decl.kind === "PromptDeclaration") counts.prompts++;
      if (decl.kind === "ChainDeclaration") counts.chains++;
      if (decl.kind === "TestDeclaration") counts.tests++;
      if (decl.kind === "EvalDeclaration") counts.evals++;
    }
  }
  return counts;
}
