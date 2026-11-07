import { describe, expect, test } from "bun:test";
import { changedLines, oversized } from "./check-commit-size";

describe("check-commit-size", () => {
  test("counts added and removed lines, without lockfiles and generated artefacts", () => {
    const numstat = [
      "120\t30\tsrc/a.ts",
      "900\t900\tbun.lock",
      "1651\t0\tevals/linter/labels.json",
      "300\t0\tevals/linter/human-review/key.json",
      "114\t114\tevals/linter/SHA256SUMS",
      "40\t0\truns/live/x.json",
      "-\t-\tdocs/media/demo.gif",
      "10\t2\tdocs/usage.md",
    ].join("\n");
    expect(changedLines(numstat)).toBe(162);
  });

  // An annotator's answers and a reason written per mutant are read by a reviewer,
  // even when a script laid out the file first.
  test("hand-written files next to generated ones count", () => {
    const numstat = [
      "30\t30\tevals/linter/human-review/review.csv",
      "12\t0\tdocs/mutation/survivors.md",
      "5\t0\tevals/linter/README.md",
      "900\t0\tdocs/mutation/summary.json",
    ].join("\n");
    expect(changedLines(numstat)).toBe(77);
  });

  test("a commit over 400 counted lines is reported, 400 is not", () => {
    expect(oversized([{ sha: "a", subject: "fix: x", lines: 400 }])).toEqual([]);
    expect(oversized([{ sha: "b", subject: "feat: y", lines: 401 }])).toEqual([
      "b feat: y: 401 changed lines (limit 400, lockfiles and generated artefacts excluded)",
    ]);
  });
});
