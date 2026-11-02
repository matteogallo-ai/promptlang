import { describe, expect, test } from "bun:test";
import { invalidSubjects } from "./check-commits";

describe("check-commits: invalidSubjects", () => {
  test("accepts Conventional Commit subjects", () => {
    expect(
      invalidSubjects([
        "feat(core)!: expose the compiler API",
        "fix: reject empty files",
        "docs(readme): show only what the code delivers",
        "chore(ci): add claims checker",
        "revert: undo x",
      ])
    ).toEqual([]);
  });

  test("rejects subjects without a known type, a colon-space or a description", () => {
    expect(
      invalidSubjects(["Update README", "feature: x", "fix:no space", "fix(scope): ", "WIP"])
    ).toEqual(["Update README", "feature: x", "fix:no space", "fix(scope): ", "WIP"]);
  });
});
