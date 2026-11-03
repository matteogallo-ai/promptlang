import type { Program } from "../../ast/nodes";
import { CompilerError } from "../../compiler/errors";
import { LexerError } from "../../lexer/errors";
import { tokenize } from "../../lexer/lexer";
import { ParserError } from "../../parser/errors";
import { parse } from "../../parser/parser";
import type { PromptClient } from "../../runtime/client";
import { BudgetedClient } from "../../testing/budget";
import { type CostEstimate, estimateLiveCost, UnpricedModelError } from "../../testing/cost";
import {
  type ProviderFailure,
  type RunMode,
  runTests,
  type TestResult,
} from "../../testing/runner";
import { resolveFiles } from "../files";
import { confirmInTerminal, createLiveClient } from "../live";
import { UsageError } from "../usage-error";
import { warnAboutEvals, warnAboutTemperature } from "../warnings";

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
/** A provider error left at least one test without a verdict. */
const EXIT_PROVIDER = 3;

export interface TestCommandDeps {
  /** Builds the provider client for --live; tests inject a fake. */
  createClient: () => PromptClient;
  /** Asks the user to approve the estimated spend; true to proceed. */
  confirm: (question: string) => boolean;
}

const defaultDeps: TestCommandDeps = {
  createClient: () => createLiveClient("--live"),
  confirm: (question) => confirmInTerminal("--live", question),
};

interface FileOutcome {
  file: string;
  error?: string;
  results: TestResult[];
}

function load(text: string): Program | string {
  try {
    return parse(tokenize(text));
  } catch (error) {
    if (error instanceof LexerError || error instanceof ParserError) return error.message;
    throw error;
  }
}

function printEstimate(estimates: Array<{ file: string; estimate: CostEstimate }>): number {
  let total = 0;
  console.error(
    "Live run estimate (every call at its full max_tokens, input ≈ characters ÷ 3, no retries):"
  );
  for (const { file, estimate: e } of estimates) {
    total += e.estimatedUsd;
    console.error(
      `  ${file}: ${e.calls} call(s) on ${e.model}, ~${e.inputTokens} input + ≤${e.maxOutputTokens} output tokens, ≈ $${e.estimatedUsd.toFixed(4)}`
    );
  }
  console.error(`  total ≈ $${total.toFixed(4)}`);
  return total;
}

function describeFailure(f: ProviderFailure): string {
  return f.kind === "configuration"
    ? `configuration error, no verdict (fix the file, the key or the approved budget): ${f.message}`
    : `provider failure, no verdict (retry later): ${f.message}`;
}

function printHuman(outcomes: FileOutcome[]): void {
  for (const o of outcomes) {
    if (o.error) {
      console.log(`  ERROR  ${o.file}: ${o.error}`);
      continue;
    }
    for (const r of o.results) {
      const label = r.providerError ? "ERROR" : r.passed ? "pass " : "FAIL ";
      console.log(`  ${label}  ${o.file}:${r.line}  ${r.test}`);
      if (r.providerError) console.log(`           ${describeFailure(r.providerError)}`);
      for (const f of r.failures) console.log(`           ${f}`);
    }
  }
  const all = outcomes.flatMap((o) => o.results);
  const config = all.filter((r) => r.providerError?.kind === "configuration").length;
  const provider = all.filter((r) => r.providerError?.kind === "provider").length;
  const noVerdict = config + provider;
  const failed = all.filter((r) => !r.passed && !r.providerError).length;
  const errors = outcomes.filter((o) => o.error).length;
  const why = [
    config ? `${config} configuration error${config === 1 ? "" : "s"}` : "",
    provider ? `${provider} provider failure${provider === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  console.log(
    `\n${all.length - failed - noVerdict} passed, ${failed} failed` +
      (noVerdict ? `, ${noVerdict} without a verdict (${why.join(", ")})` : "") +
      (errors ? `, ${errors} file(s) with errors` : "")
  );
}

/**
 * `promptlang test <paths> [--json] [--live [--yes]]`: runs the `test` blocks of
 * each file. Default: each test's `mock:` response replays through the generated
 * code, with no network. `--live` calls the provider after printing a
 * cost estimate and getting approval (interactive, or `--yes`).
 */
export async function runTest(
  args: string[],
  deps: TestCommandDeps = defaultDeps
): Promise<number> {
  const json = args.includes("--json");
  const live = args.includes("--live");
  const yes = args.includes("--yes");
  const unknown = args.find(
    (a) => a.startsWith("--") && !["--json", "--live", "--yes"].includes(a)
  );
  const paths = args.filter((a) => !a.startsWith("--"));
  if (unknown || paths.length === 0 || (yes && !live)) {
    console.error(
      unknown
        ? `Error: unknown flag '${unknown}'`
        : paths.length === 0
          ? "Error: test needs at least one .prompt file or directory"
          : "Error: --yes only applies to --live"
    );
    return EXIT_USAGE;
  }

  const outcomes: FileOutcome[] = [];
  const programs: Array<{ file: string; program: Program }> = [];
  for (const file of (await resolveFiles(paths)).sort()) {
    const loaded = load(await Bun.file(file).text());
    if (typeof loaded === "string") outcomes.push({ file, error: loaded, results: [] });
    else {
      warnAboutEvals(loaded, file);
      warnAboutTemperature(loaded, file);
      programs.push({ file, program: loaded });
    }
  }

  let mode: RunMode = { kind: "mock" };
  if (live) {
    try {
      const estimates = programs.flatMap(({ file, program }) => {
        const estimate = estimateLiveCost(program);
        return estimate ? [{ file, estimate }] : [];
      });
      const total = printEstimate(estimates);
      if (!yes && !deps.confirm(`Spend about $${total.toFixed(4)}? [y/N] `)) {
        console.error("Aborted: no provider call was made.");
        return EXIT_USAGE;
      }
      // The approved total is enforced in code, not only shown: a call whose estimated
      // worst case would pass it is not sent (src/testing/budget.ts).
      mode = { kind: "live", client: new BudgetedClient(deps.createClient(), total) };
    } catch (error) {
      if (error instanceof UsageError || error instanceof UnpricedModelError) {
        console.error(`Error: ${error.message}`);
        return EXIT_USAGE;
      }
      throw error;
    }
  }

  for (const { file, program } of programs) {
    try {
      outcomes.push({ file, results: await runTests(program, file, mode) });
    } catch (error) {
      if (!(error instanceof CompilerError)) throw error;
      const at = error.line !== undefined ? `${error.line}:${error.column ?? 1}: ` : "";
      outcomes.push({ file, error: `${at}${error.message}`, results: [] });
    }
  }

  const all = outcomes.flatMap((o) => o.results);
  const ok = outcomes.every((o) => !o.error) && all.every((r) => r.passed);
  if (json) {
    const usage = all.reduce(
      (u, r) => ({
        input_tokens: u.input_tokens + r.usage.input_tokens,
        output_tokens: u.output_tokens + r.usage.output_tokens,
      }),
      { input_tokens: 0, output_tokens: 0 }
    );
    console.log(JSON.stringify({ ok, mode: mode.kind, usage, files: outcomes }, null, 2));
  } else {
    if (all.length === 0 && outcomes.every((o) => !o.error)) console.log("no test blocks found");
    else printHuman(outcomes);
  }
  if (ok) return EXIT_OK;
  const assertionFailed =
    outcomes.some((o) => o.error) || all.some((r) => !r.passed && !r.providerError);
  return assertionFailed ? EXIT_FAILED : EXIT_PROVIDER;
}
