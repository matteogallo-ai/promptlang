import { describe, test, expect } from "bun:test";
import type {
  Program,
  PromptDeclaration,
  TestDeclaration,
  ChainDeclaration,
  MessageSection,
  StringLiteral,
  Parameter,
  ChainStep,
  CallExpression,
} from "../ast/nodes";
import type { AnalysisContext } from "./analyzer";
import { analyze } from "./analyzer";
import { missingTestsRule } from "./rules/missing-tests";
import { unboundedTemplateRule } from "./rules/unbounded-template";
import { promptInjectionRiskRule } from "./rules/prompt-injection-risk";
import { tokenCostEstimateRule } from "./rules/token-cost-estimate";
import { chainComplexityRule } from "./rules/chain-complexity";
import { duplicatePromptsRule } from "./rules/duplicate-prompts";
import { formatJsonReport } from "./report";
import { tokenize } from "../lexer/lexer";
import { parse } from "../parser/parser";

// ---------------------------------------------------------------------------
// AST factory helpers
// ---------------------------------------------------------------------------

const POS = { line: 1, column: 1 };

function makeStringLiteral(value: string, isTemplate: boolean): StringLiteral {
  return { kind: "StringLiteral", value, isTemplate, ...POS };
}

function makeMessageSection(
  role: "system" | "user" | "assistant",
  content: string,
  isTemplate = false
): MessageSection {
  return {
    kind: "MessageSection",
    role,
    content: makeStringLiteral(content, isTemplate),
    ...POS,
  };
}

function makeParam(name: string): Parameter {
  return {
    kind: "Parameter",
    name,
    type: { kind: "PrimitiveType", name: "string", ...POS },
    ...POS,
  };
}

function makePrompt(
  name: string,
  params: string[] = [],
  sections: MessageSection[] = []
): PromptDeclaration {
  return {
    kind: "PromptDeclaration",
    name,
    parameters: params.map(makeParam),
    returnType: { kind: "PrimitiveType", name: "string", ...POS },
    sections,
    ...POS,
  };
}

function makeCallExpr(callee: string): CallExpression {
  return { kind: "CallExpression", callee, arguments: [], ...POS };
}

function makeTest(callee: string): TestDeclaration {
  return {
    kind: "TestDeclaration",
    description: `test for ${callee}`,
    input: makeCallExpr(callee),
    expectations: [],
    ...POS,
  };
}

function makeChain(name: string, stepCount: number): ChainDeclaration {
  const steps: ChainStep[] = Array.from({ length: stepCount }, (_, i) => ({
    kind: "ChainStep" as const,
    name: `step_${i}`,
    expression: makeCallExpr(`prompt_${i}`),
    ...POS,
  }));
  return {
    kind: "ChainDeclaration",
    name,
    parameters: [],
    returnType: { kind: "PrimitiveType", name: "string", ...POS },
    steps,
    returnExpression: { kind: "Identifier", name: "result", ...POS },
    ...POS,
  };
}

function makeProgram(declarations: Program["declarations"]): Program {
  return { kind: "Program", imports: [], metadata: [], declarations, ...POS };
}

function makeContext(file: string, declarations: Program["declarations"]): AnalysisContext {
  return { file, ast: makeProgram(declarations) };
}

// ---------------------------------------------------------------------------
// missing-tests
// ---------------------------------------------------------------------------

describe("missing-tests rule", () => {
  test("reports warning when prompt has no tests", () => {
    const ctx = makeContext("a.prompt", [makePrompt("my_prompt")]);
    const issues = missingTestsRule.check(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("missing-tests");
    expect(issues[0].message).toContain("my_prompt");
  });

  test("no issue when prompt has a matching test", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("my_prompt"),
      makeTest("my_prompt"),
    ]);
    const issues = missingTestsRule.check(ctx);
    expect(issues).toHaveLength(0);
  });

  test("reports only the prompt without tests when mixed", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("with_test"),
      makePrompt("without_test"),
      makeTest("with_test"),
    ]);
    const issues = missingTestsRule.check(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("without_test");
  });
});

// ---------------------------------------------------------------------------
// unbounded-template
// ---------------------------------------------------------------------------

describe("unbounded-template rule", () => {
  test("reports warning when template var is not a declared param", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("p", ["declared_param"], [
        makeMessageSection("user", "Hello {{undeclared_var}}", true),
      ]),
    ]);
    const issues = unboundedTemplateRule.check(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("undeclared_var");
  });

  test("no issue when template var is a declared param", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("p", ["ticket"], [
        makeMessageSection("user", "Classify: {{ticket}}", true),
      ]),
    ]);
    const issues = unboundedTemplateRule.check(ctx);
    expect(issues).toHaveLength(0);
  });

  test("no issue for non-template string sections", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("p", [], [
        makeMessageSection("system", "You are a helpful assistant.", false),
      ]),
    ]);
    const issues = unboundedTemplateRule.check(ctx);
    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// prompt-injection-risk
// ---------------------------------------------------------------------------

describe("prompt-injection-risk rule", () => {
  test("reports warning for undelimited user section template", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("p", ["input"], [
        makeMessageSection("user", "Process this: {{input}}", true),
      ]),
    ]);
    const issues = promptInjectionRiskRule.check(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe("prompt-injection-risk");
  });

  test("no issue when content uses --- delimiters", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("p", ["input"], [
        makeMessageSection("user", "Process:\n---\n{{input}}\n---", true),
      ]),
    ]);
    const issues = promptInjectionRiskRule.check(ctx);
    expect(issues).toHaveLength(0);
  });

  test("no issue for system sections (not user-controlled input)", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("p", ["lang"], [
        makeMessageSection("system", "Translate to {{lang}}", true),
      ]),
    ]);
    const issues = promptInjectionRiskRule.check(ctx);
    expect(issues).toHaveLength(0);
  });

  test("no issue when content uses XML-style delimiters", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("p", ["data"], [
        makeMessageSection("user", "Input: <DATA>{{data}}</DATA>", true),
      ]),
    ]);
    const issues = promptInjectionRiskRule.check(ctx);
    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// token-cost-estimate
// ---------------------------------------------------------------------------

describe("token-cost-estimate rule", () => {
  test("no issue for short prompts", () => {
    const ctx = makeContext("a.prompt", [
      makePrompt("p", [], [
        makeMessageSection("system", "You are helpful. Classify the ticket."),
        makeMessageSection("user", "Classify: {{ticket}}", true),
      ]),
    ]);
    const issues = tokenCostEstimateRule.check(ctx);
    expect(issues).toHaveLength(0);
  });

  test("reports info for prompts exceeding 500 estimated tokens", () => {
    // ~400 words * 1.3 ≈ 520 tokens
    const longContent = Array(400).fill("word").join(" ");
    const ctx = makeContext("a.prompt", [
      makePrompt("p", [], [
        makeMessageSection("system", longContent),
      ]),
    ]);
    const issues = tokenCostEstimateRule.check(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("info");
    expect(issues[0].rule).toBe("token-cost-estimate");
    expect(issues[0].message).toContain("tokens");
  });
});

// ---------------------------------------------------------------------------
// chain-complexity
// ---------------------------------------------------------------------------

describe("chain-complexity rule", () => {
  test("no issue for chains with 5 steps or fewer", () => {
    const ctx = makeContext("a.prompt", [makeChain("simple", 5)]);
    const issues = chainComplexityRule.check(ctx);
    expect(issues).toHaveLength(0);
  });

  test("reports warning for chains with more than 5 steps", () => {
    const ctx = makeContext("a.prompt", [makeChain("complex", 6)]);
    const issues = chainComplexityRule.check(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("6 steps");
  });

  test("warning message includes chain name", () => {
    const ctx = makeContext("a.prompt", [makeChain("my_workflow", 8)]);
    const issues = chainComplexityRule.check(ctx);
    expect(issues[0].message).toContain("my_workflow");
  });
});

// ---------------------------------------------------------------------------
// duplicate-prompts
// ---------------------------------------------------------------------------

describe("duplicate-prompts rule", () => {
  test("reports warning when same prompt name exists in two files", () => {
    const ctxA = makeContext("a.prompt", [makePrompt("classify")]);
    const ctxB = makeContext("b.prompt", [makePrompt("classify")]);
    const allFiles = [ctxA, ctxB];

    const issuesA = duplicatePromptsRule.check(ctxA, allFiles);
    const issuesB = duplicatePromptsRule.check(ctxB, allFiles);

    // Reported only once (from the lexicographically first file).
    expect(issuesA.length + issuesB.length).toBe(1);
    expect(issuesA[0].message).toContain("classify");
  });

  test("no issue when all prompt names are unique", () => {
    const ctxA = makeContext("a.prompt", [makePrompt("prompt_a")]);
    const ctxB = makeContext("b.prompt", [makePrompt("prompt_b")]);
    const allFiles = [ctxA, ctxB];

    const issues = [
      ...duplicatePromptsRule.check(ctxA, allFiles),
      ...duplicatePromptsRule.check(ctxB, allFiles),
    ];
    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: analyze real example files
// ---------------------------------------------------------------------------

// Note: summarize-and-translate.prompt uses future syntax (>, <=, regex)
// not yet supported by the lexer (v0.3). Integration tests use the two
// fully-parseable example files only.
describe("Integration — example files", () => {
  const PARSEABLE_FILES = [
    "docs/examples/classify-ticket.prompt",
    "docs/examples/extract-invoice.prompt",
  ];

  async function loadContext(filePath: string): Promise<AnalysisContext> {
    const source = await Bun.file(filePath).text();
    return { file: filePath, ast: parse(tokenize(source)) };
  }

  test("parses classify-ticket and extract-invoice without throwing", async () => {
    for (const f of PARSEABLE_FILES) {
      const ctx = await loadContext(f);
      expect(ctx.ast.kind).toBe("Program");
    }
  });

  test("detects prompt-injection-risk in classify-ticket (no delimiters)", async () => {
    const ctx = await loadContext("docs/examples/classify-ticket.prompt");
    const issues = promptInjectionRiskRule.check(ctx);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].rule).toBe("prompt-injection-risk");
  });

  test("extract-invoice has no injection warning (uses --- delimiters)", async () => {
    const ctx = await loadContext("docs/examples/extract-invoice.prompt");
    const issues = promptInjectionRiskRule.check(ctx);
    expect(issues).toHaveLength(0);
  });

  test("analyze across both files returns issues", async () => {
    const contexts = await Promise.all(PARSEABLE_FILES.map(loadContext));
    const issues = analyze(contexts);
    const injectionIssues = issues.filter((i) => i.rule === "prompt-injection-risk");
    expect(injectionIssues.length).toBeGreaterThan(0);
  });

  test("formatJsonReport returns valid JSON structure", () => {
    const issues = [
      {
        severity: "warning" as const,
        rule: "missing-tests",
        file: "a.prompt",
        line: 1,
        column: 1,
        message: "Prompt 'foo' has no tests.",
      },
    ];
    const counts = { prompts: 1, chains: 0, tests: 0, evals: 0 };
    const json = JSON.parse(formatJsonReport(issues, counts, 1));
    expect(json.files_analyzed).toBe(1);
    expect(json.issues).toHaveLength(1);
    expect(json.summary.warnings).toBe(1);
    expect(json.summary.errors).toBe(0);
  });

  test("both example files have no missing-tests issues", async () => {
    const contexts = await Promise.all(PARSEABLE_FILES.map(loadContext));
    const issues = contexts.flatMap((ctx) => missingTestsRule.check(ctx));
    expect(issues).toHaveLength(0);
  });
});
