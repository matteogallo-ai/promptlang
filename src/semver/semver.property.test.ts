import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { propertyParams } from "../../tests/support/property";
import { compareVersions, parseVersion, type SemVer, satisfies } from "./semver";

// Small components make equal and adjacent versions common, where precedence bugs live.
const part = fc.nat(3);
const prereleaseId = fc.oneof(fc.nat(12), fc.constantFrom("alpha", "beta", "rc", "x-1", "0a"));
const semver: fc.Arbitrary<SemVer> = fc.record({
  major: part,
  minor: part,
  patch: part,
  prerelease: fc.array(prereleaseId, { maxLength: 3 }),
  build: fc.array(fc.constantFrom("build", "001", "sha-5"), { maxLength: 2 }),
});
const release = semver.map((v) => ({ ...v, prerelease: [], build: [] }));

function format(v: SemVer): string {
  const pre = v.prerelease.length > 0 ? `-${v.prerelease.join(".")}` : "";
  const build = v.build.length > 0 ? `+${v.build.join(".")}` : "";
  return `${v.major}.${v.minor}.${v.patch}${pre}${build}`;
}

/** SemVer 2.0.0 section 11, written independently of src/semver/semver.ts. */
function precedence(a: SemVer, b: SemVer): number {
  for (const k of ["major", "minor", "patch"] as const) {
    if (a[k] !== b[k]) return Math.sign(a[k] - b[k]);
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return Math.sign(b.prerelease.length - a.prerelease.length) || 0;
  }
  for (let i = 0; i < Math.min(a.prerelease.length, b.prerelease.length); i++) {
    const [x, y] = [a.prerelease[i]!, b.prerelease[i]!];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return Math.sign(x - y);
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return Math.sign(a.prerelease.length - b.prerelease.length);
}

const OPS: Record<string, (c: number) => boolean> = {
  "": (c) => c === 0,
  "=": (c) => c === 0,
  ">": (c) => c > 0,
  ">=": (c) => c >= 0,
  "<": (c) => c < 0,
  "<=": (c) => c <= 0,
};

describe("semver properties", () => {
  test("parseVersion reads back every formatted version", () => {
    fc.assert(
      fc.property(semver, (v) => {
        expect(parseVersion(format(v))).toEqual(v);
      }),
      propertyParams(500)
    );
  });

  test("compareVersions agrees with the SemVer 2.0.0 precedence rules and ignores build metadata", () => {
    fc.assert(
      fc.property(semver, semver, (a, b) => {
        expect(compareVersions(format(a), format(b)) as number).toBe(precedence(a, b));
        expect(compareVersions(format(b), format(a)) as number).toBe(precedence(b, a));
      }),
      propertyParams(1000)
    );
  });

  test("a single comparator holds exactly when the precedence says so (release versions)", () => {
    fc.assert(
      fc.property(release, semver, fc.constantFrom(...Object.keys(OPS)), (v, bound, op) => {
        const holds = OPS[op]!(precedence(v, bound));
        expect(satisfies(format(v), `${op}${format(bound)}`)).toBe(holds);
      }),
      propertyParams(1000)
    );
  });

  test("^ and ~ ranges match their documented bounds on release versions", () => {
    fc.assert(
      fc.property(release, release, (v, base) => {
        const caretUpper =
          base.major > 0
            ? { ...base, major: base.major + 1, minor: 0, patch: 0 }
            : base.minor > 0
              ? { ...base, minor: base.minor + 1, patch: 0 }
              : { ...base, patch: base.patch + 1 };
        const tildeUpper = { ...base, minor: base.minor + 1, patch: 0 };
        const atLeast = precedence(v, base) >= 0;
        expect(satisfies(format(v), `^${format(base)}`)).toBe(
          atLeast && precedence(v, caretUpper) < 0
        );
        expect(satisfies(format(v), `~${format(base)}`)).toBe(
          atLeast && precedence(v, tildeUpper) < 0
        );
      }),
      propertyParams(1000)
    );
  });

  test("space-separated comparators are ANDed, whatever the spacing", () => {
    fc.assert(
      fc.property(
        release,
        fc.constantFrom(">=", "<", "<=", ">", "^", "~"),
        release,
        fc.constantFrom(">=", "<", "<=", ">", "^", "~"),
        release,
        fc.constantFrom(" ", "  ", "\t"),
        (v, op1, b1, op2, b2, gap) => {
          const [r1, r2] = [`${op1}${format(b1)}`, `${op2}${format(b2)}`];
          expect(satisfies(format(v), ` ${r1}${gap}${r2} `)).toBe(
            satisfies(format(v), r1) && satisfies(format(v), r2)
          );
        }
      ),
      propertyParams(500)
    );
  });

  test("a pre-release only satisfies a range when a bound is a pre-release of the same version", () => {
    fc.assert(
      fc.property(
        semver.filter((v) => v.prerelease.length > 0),
        semver,
        fc.constantFrom(">=", "<=", "=", ">", "<", "^", "~"),
        (v, bound, op) => {
          const sameTriple =
            v.major === bound.major && v.minor === bound.minor && v.patch === bound.patch;
          const result = satisfies(format(v), `${op}${format(bound)}`);
          if (!sameTriple || bound.prerelease.length === 0) expect(result).toBe(false);
          else if (op in OPS) expect(result).toBe(OPS[op]!(precedence(v, bound)));
          else expect(result).toBe(precedence(v, bound) >= 0);
        }
      ),
      propertyParams(1000)
    );
  });
});
