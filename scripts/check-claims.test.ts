import { describe, expect, test } from "bun:test";
import { checkConsistency, parseClaims, parseComparisonTable } from "./check-claims";

const CLAIMS = `
| Claim | Status | Module | Test file | Test name | Notes |
| ----- | ------ | ------ | --------- | --------- | ----- |
| Typed I/O | shipped | \`src/a.ts\` | \`src/a.test.ts\` | compiles (classify) | ok |
| Native tests | roadmap | — | — | — | not yet |
| Fallback | partial | \`src/r.ts\` | \`src/r.test.ts\` | falls back | limited |
`;

const README = `
## Comparison

| Feature | LangChain | **PromptLang** |
| ------- | :-------: | :------------: |
| Typed I/O | ❌ | ✅ |
| **Native tests** | ❌ | Roadmap (in progress) |
| Fallback | Partial | Partial |

## Next section
| not | a comparison |
`;

describe("parseClaims", () => {
  test("reads every row with its status and test reference", () => {
    const claims = parseClaims(CLAIMS);
    expect(claims.map((c) => [c.claim, c.status])).toEqual([
      ["Typed I/O", "shipped"],
      ["Native tests", "roadmap"],
      ["Fallback", "partial"],
    ]);
    expect(claims[0]).toMatchObject({ testFile: "src/a.test.ts", testName: "compiles (classify)" });
    expect(claims[1]!.testFile).toBeNull();
  });

  test("rejects an unknown status", () => {
    expect(() => parseClaims(CLAIMS.replace("roadmap", "done"))).toThrow(/status/);
  });

  test("rejects a shipped claim without a test", () => {
    expect(() =>
      parseClaims(CLAIMS.replace("| Native tests | roadmap |", "| Native tests | shipped |"))
    ).toThrow(/Native tests/);
  });
});

describe("parseComparisonTable", () => {
  test("reads feature labels (markup stripped) and the PromptLang column", () => {
    expect(parseComparisonTable(README)).toEqual([
      { feature: "Typed I/O", cell: "✅" },
      { feature: "Native tests", cell: "Roadmap (in progress)" },
      { feature: "Fallback", cell: "Partial" },
    ]);
  });
});

describe("checkConsistency", () => {
  test("passes when every ✅ is a shipped claim", () => {
    expect(checkConsistency(parseClaims(CLAIMS), parseComparisonTable(README))).toEqual([]);
  });

  test("fails when a roadmap claim is shown as ✅", () => {
    const readme = README.replace("| Roadmap (in progress) |", "| ✅ CLI |");
    expect(checkConsistency(parseClaims(CLAIMS), parseComparisonTable(readme))).toEqual([
      "README shows 'Native tests' as ✅ but docs/CLAIMS.md marks it roadmap",
    ]);
  });

  test("fails when a ✅ feature is missing from CLAIMS.md", () => {
    const readme = README.replace("| Fallback |", "| Telepathy | ❌ | ✅ |\n| Fallback |");
    expect(checkConsistency(parseClaims(CLAIMS), parseComparisonTable(readme))).toContain(
      "README shows 'Telepathy' as ✅ but it is not listed in docs/CLAIMS.md"
    );
  });
});
