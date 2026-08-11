import { Glob } from "bun";
import { tokenize } from "../../lexer/lexer";
import { parse } from "../../parser/parser";
import type { AnalysisContext } from "../../analyzer/analyzer";
import { analyze } from "../../analyzer/analyzer";
import {
  formatTerminalReport,
  formatJsonReport,
  type DeclarationCounts,
} from "../../analyzer/report";

export async function runAnalyze(args: string[]): Promise<number> {
  const jsonOutput = args.includes("--json");
  const strict = args.includes("--strict");
  const paths = args.filter((a) => !a.startsWith("--"));

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

  const issues = analyze(contexts);
  const counts = countDeclarations(contexts);

  if (jsonOutput) {
    console.log(formatJsonReport(issues, counts, contexts.length));
  } else {
    console.log(formatTerminalReport(issues, counts, contexts.length));
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  const hasWarnings = issues.some((i) => i.severity === "warning");

  if (parseErrors.length > 0) return 1;
  if (hasErrors) return 1;
  if (strict && hasWarnings) return 1;
  return 0;
}

async function resolveFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const p of paths) {
    if (p.includes("*")) {
      const glob = new Glob(p);
      for await (const file of glob.scan(".")) {
        if (file.endsWith(".prompt")) files.push(file);
      }
    } else if (p.endsWith(".prompt")) {
      files.push(p);
    } else {
      const dir = p.replace(/\/+$/, "");
      const glob = new Glob("**/*.prompt");
      for await (const file of glob.scan(dir)) {
        files.push(`${dir}/${file}`);
      }
    }
  }

  return [...new Set(files)];
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
