import { describe, expect, test } from "bun:test";
import {
  checkConsistency,
  checkFeatureBullets,
  parseClaims,
  parseComparisonTable,
  parseFeatureBullets,
} from "./check-claims";

const CLAIMS = `
| Claim | Status | Module | Test file | Test name | Notes |
| ----- | ------ | ------ | --------- | --------- | ----- |
| Typed I/O | shipped | \`src/a.ts\` | \`src/a.test.ts\` | compiles (classify) | ok |
| Native tests | roadmap | — | — | — | not yet |
| Fallback | partial | \`src/r.ts\` | \`src/r.test.ts\` | falls back | limited |
`;

const README = `
## Why PromptLang

- **Typed I/O**: generated code type-checks
- plain bullet, not a claim

Not delivered:

- **Native tests**: parsed only

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
      "README shows 'Native tests' as '✅ CLI' but docs/CLAIMS.md marks it roadmap (expected the cell to start with 'Roadmap')",
    ]);
  });

  test("fails when a ✅ feature is missing from CLAIMS.md", () => {
    const readme = README.replace("| Fallback |", "| Telepathy | ❌ | ✅ |\n| Fallback |");
    expect(checkConsistency(parseClaims(CLAIMS), parseComparisonTable(readme))).toContain(
      "README comparison row 'Telepathy' is not listed in docs/CLAIMS.md"
    );
  });

  test("fails when a roadmap claim is shown as delivered without the ✅ glyph", () => {
    for (const cell of ["✔️", "Yes", "Shipped", "Done"]) {
      const readme = README.replace("| Roadmap (in progress) |", `| ${cell} |`);
      expect(checkConsistency(parseClaims(CLAIMS), parseComparisonTable(readme))).toEqual([
        `README shows 'Native tests' as '${cell}' but docs/CLAIMS.md marks it roadmap (expected the cell to start with 'Roadmap')`,
      ]);
    }
  });

  test("fails when a shipped claim is shown as partial", () => {
    const readme = README.replace("| Typed I/O | ❌ | ✅ |", "| Typed I/O | ❌ | Partial |");
    expect(checkConsistency(parseClaims(CLAIMS), parseComparisonTable(readme))).toEqual([
      "README shows 'Typed I/O' as 'Partial' but docs/CLAIMS.md marks it shipped (expected the cell to start with '✅')",
    ]);
  });
});

describe("feature bullets", () => {
  test("reads bold labels of the delivered list only", () => {
    expect(parseFeatureBullets(README)).toEqual(["Typed I/O"]);
  });

  test("passes when every bullet is a shipped claim", () => {
    expect(checkFeatureBullets(parseClaims(CLAIMS), parseFeatureBullets(README))).toEqual([]);
  });

  test("fails on a bullet missing from CLAIMS.md or not shipped", () => {
    const readme = README.replace(
      "- plain bullet",
      "- **Telepathy**: reads minds\n- **Fallback**: switches\n- plain bullet"
    );
    expect(checkFeatureBullets(parseClaims(CLAIMS), parseFeatureBullets(readme))).toEqual([
      "README feature bullet 'Telepathy' is not listed in docs/CLAIMS.md",
      "README feature bullet 'Fallback' is listed as delivered but docs/CLAIMS.md marks it partial",
    ]);
  });
});
