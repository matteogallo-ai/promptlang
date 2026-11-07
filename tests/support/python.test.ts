import { describe, expect, test } from "bun:test";
import { pythonSkipReason } from "./python";

const answers =
  (stdout: string, exitCode = 0) =>
  () => ({ exitCode, stdout });

describe("pythonSkipReason", () => {
  test("Python 3.11 and later run the tests", () => {
    expect(pythonSkipReason(answers("3 11\n"))).toBeNull();
    expect(pythonSkipReason(answers("3 13\n"))).toBeNull();
  });

  test("the python3 that macOS ships (3.9) is named with the requirement", () => {
    expect(pythonSkipReason(answers("3 9\n"))).toBe("python3 is 3.9; Python 3.11+ is required");
  });

  test("a python3 that fails or is missing is a reason, not an exception", () => {
    expect(pythonSkipReason(answers("", 1))).toBe("python3 exited 1; Python 3.11+ is required");
    const missing = () => {
      throw new Error("Executable not found in $PATH");
    };
    expect(pythonSkipReason(missing)).toContain("python3 not found on PATH");
  });
});
