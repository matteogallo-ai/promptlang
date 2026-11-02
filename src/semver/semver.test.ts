import { describe, expect, test } from "bun:test";
import { compareVersions, parseRange, parseVersion, satisfies } from "./semver";

describe("parseVersion (SemVer 2.0.0)", () => {
  test("rejects numbers too large to compare exactly, including numeric pre-release identifiers", () => {
    expect(parseVersion("9007199254740992.0.0")).toBeNull();
    expect(parseVersion("1.0.0-99999999999999999999")).toBeNull();
    expect(parseVersion("9007199254740991.0.0-9007199254740991")).not.toBeNull();
  });

  test("accepts release, pre-release and build metadata versions", () => {
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
      build: [],
    });
    expect(parseVersion("1.0.0-alpha.1")?.prerelease).toEqual(["alpha", 1]);
    expect(parseVersion("1.0.0+20130313144700")?.build).toEqual(["20130313144700"]);
    expect(parseVersion("1.0.0-beta+exp.sha.5114f85")).toMatchObject({
      prerelease: ["beta"],
      build: ["exp", "sha", "5114f85"],
    });
    expect(parseVersion("0.0.0")).not.toBeNull();
  });

  test("rejects anything that is not MAJOR.MINOR.PATCH", () => {
    for (const bad of [
      "not-a-version",
      "",
      "1",
      "1.0",
      "v1.0.0",
      "1.0.0.0",
      "01.0.0",
      "1.02.0",
      "1.0.0-",
      "1.0.0-01",
      "1.0.0+",
      "1.0.0-al..pha",
      " 1.0.0",
    ]) {
      expect(parseVersion(bad)).toBeNull();
    }
  });
});

describe("compareVersions (precedence)", () => {
  test("follows the SemVer 2.0.0 precedence example", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
      "1.0.1",
      "1.1.0",
      "2.0.0",
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(compareVersions(ordered[i]!, ordered[i + 1]!)).toBe(-1);
      expect(compareVersions(ordered[i + 1]!, ordered[i]!)).toBe(1);
    }
  });

  test("ignores build metadata", () => {
    expect(compareVersions("1.0.0+a", "1.0.0+b")).toBe(0);
  });
});

describe("satisfies", () => {
  const cases: Array<[string, string, boolean]> = [
    ["1.2.3", "1.2.3", true],
    ["1.2.4", "1.2.3", false],
    ["1.2.3", "=1.2.3", true],
    ["1.9.0", "^1.2.0", true],
    ["2.0.0", "^1.2.0", false],
    ["1.1.9", "^1.2.0", false],
    ["0.2.5", "^0.2.0", true],
    ["0.3.0", "^0.2.0", false],
    ["0.0.3", "^0.0.3", true],
    ["0.0.4", "^0.0.3", false],
    ["1.2.9", "~1.2.0", true],
    ["1.3.0", "~1.2.0", false],
    ["1.2.0", ">=1.2.0", true],
    ["1.1.9", ">=1.2.0", false],
    ["1.2.1", ">1.2.0", true],
    ["1.2.0", ">1.2.0", false],
    ["1.9.9", "<2.0.0", true],
    ["2.0.0", "<2.0.0", false],
    ["2.0.0", "<=2.0.0", true],
    ["1.5.0", ">=1.2.0 <2.0.0", true],
    ["2.1.0", ">=1.2.0 <2.0.0", false],
  ];
  for (const [version, range, expected] of cases) {
    test(`${version} ${expected ? "satisfies" : "does not satisfy"} "${range}"`, () => {
      expect(satisfies(version, range)).toBe(expected);
    });
  }

  test("a pre-release only satisfies a range naming a pre-release of the same version", () => {
    expect(satisfies("2.0.0-rc.1", ">=1.0.0")).toBe(false);
    expect(satisfies("1.3.0-beta", "^1.2.0")).toBe(false);
    expect(satisfies("1.2.0-rc.2", ">=1.2.0-rc.1")).toBe(true);
    expect(satisfies("1.2.0", "^1.2.0-rc.1")).toBe(true);
  });
});

describe("parseRange", () => {
  test("rejects malformed ranges with a message naming the bad part", () => {
    expect(() => parseRange("")).toThrow(/empty/);
    expect(() => parseRange("^1.2")).toThrow(/'\^1\.2'/);
    expect(() => parseRange("1.x")).toThrow(/'1\.x'/);
    expect(() => parseRange(">=1.0.0 || <0.5.0")).toThrow(/'\|\|'/);
    expect(() => parseRange("=>1.0.0")).toThrow(/'=>1\.0\.0'/);
  });
});
