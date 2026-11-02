import { describe, expect, test } from "bun:test";
import { parseConfigFlag } from "./args";

describe("parseConfigFlag", () => {
  test("returns the value after --config", () => {
    expect(parseConfigFlag(["check", "--config", "custom.yaml"])).toBe("custom.yaml");
  });

  test("returns undefined when the flag is absent, last, or given an empty value", () => {
    expect(parseConfigFlag(["check"])).toBeUndefined();
    expect(parseConfigFlag(["check", "--config"])).toBeUndefined();
    expect(parseConfigFlag(["check", "--config", ""])).toBeUndefined();
  });
});
