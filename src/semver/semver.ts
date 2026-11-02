/**
 * Minimal SemVer 2.0.0 (https://semver.org/spec/v2.0.0.html): parsing,
 * precedence and range matching for `@version` and `import ... requires`.
 * Written in-house rather than depending on `semver`; see
 * docs/adr/0001-semver-in-house.md.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated pre-release identifiers; numeric ones are numbers. */
  prerelease: Array<string | number>;
  build: string[];
}

/** The regular expression published with the SemVer 2.0.0 specification. */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** Parses a SemVer 2.0.0 version, or returns null when `text` is not one. */
export function parseVersion(text: string): SemVer | null {
  const m = SEMVER.exec(text);
  if (!m) return null;
  // Beyond 2^53 - 1, distinct numbers compare equal as JavaScript numbers.
  const numbers = [m[1], m[2], m[3], ...(m[4] ?? "").split(".").filter((id) => /^\d+$/.test(id))];
  if (numbers.some((n) => !Number.isSafeInteger(Number(n)))) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split(".").map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
    build: m[5] ? m[5].split(".") : [],
  };
}

function requireVersion(text: string): SemVer {
  const v = parseVersion(text);
  if (!v) throw new RangeError(`'${text}' is not a valid SemVer 2.0.0 version`);
  return v;
}

function compareIdentifiers(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (typeof a === "number") return -1;
  if (typeof b === "number") return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareParsed(a: SemVer, b: SemVer): -1 | 0 | 1 {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  // A version without a pre-release ranks above any pre-release of it.
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const n = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < n; i++) {
    const x = a.prerelease[i];
    const y = b.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const c = compareIdentifiers(x, y);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return 0;
}

/** Precedence of two versions: -1, 0 or 1. Build metadata is ignored. Throws on invalid input. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  return compareParsed(requireVersion(a), requireVersion(b));
}

type Operator = "=" | ">" | ">=" | "<" | "<=";

interface Comparator {
  op: Operator;
  version: SemVer;
}

/** A range: every comparator must hold (space-separated constraints are ANDed). */
export interface Range {
  source: string;
  comparators: Comparator[];
}

const PART = /^(\^|~|>=|<=|>|<|=)?(.+)$/;

/**
 * Parses a version range. Supported: an exact version (`1.2.3` or `=1.2.3`),
 * `^1.2.3`, `~1.2.3`, `>`, `>=`, `<`, `<=`, and several of these separated by
 * spaces, all of which must hold. Every version must be full MAJOR.MINOR.PATCH.
 */
export function parseRange(text: string): Range {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new RangeError("version range is empty");
  const comparators: Comparator[] = [];
  for (const part of parts) {
    const m = PART.exec(part);
    const version = m ? parseVersion(m[2]!) : null;
    if (!m || !version) {
      throw new RangeError(
        `invalid version range part '${part}' in "${text}" (supported: 1.2.3, =1.2.3, ^1.2.3, ~1.2.3, >, >=, <, <=, space-separated)`
      );
    }
    const op = m[1] ?? "=";
    if (op === "^") comparators.push(...caret(version));
    else if (op === "~") comparators.push(...tilde(version));
    else comparators.push({ op: op as Operator, version });
  }
  return { source: text, comparators };
}

function release(
  major: number,
  minor: number,
  patch: number,
  prerelease: Array<string | number> = []
): SemVer {
  return { major, minor, patch, prerelease, build: [] };
}

/** `^1.2.3` = `>=1.2.3 <2.0.0`; `^0.2.3` = `>=0.2.3 <0.3.0`; `^0.0.3` = `>=0.0.3 <0.0.4`. */
function caret(v: SemVer): Comparator[] {
  const upper =
    v.major > 0
      ? release(v.major + 1, 0, 0)
      : v.minor > 0
        ? release(0, v.minor + 1, 0)
        : release(0, 0, v.patch + 1);
  // The `0` pre-release makes the bound exclude pre-releases of the next version too.
  return [
    { op: ">=", version: v },
    { op: "<", version: { ...upper, prerelease: [0] } },
  ];
}

/** `~1.2.3` = `>=1.2.3 <1.3.0`. */
function tilde(v: SemVer): Comparator[] {
  return [
    { op: ">=", version: v },
    { op: "<", version: release(v.major, v.minor + 1, 0, [0]) },
  ];
}

function holds(v: SemVer, c: Comparator): boolean {
  const cmp = compareParsed(v, c.version);
  switch (c.op) {
    case "=":
      return cmp === 0;
    case ">":
      return cmp > 0;
    case ">=":
      return cmp >= 0;
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
  }
}

/**
 * True when `version` satisfies `range`. A pre-release version only satisfies
 * a range when one of the range's own versions is a pre-release of the same
 * MAJOR.MINOR.PATCH (the npm rule): `^1.2.0` does not accept `1.3.0-beta`.
 */
export function satisfies(version: string, range: string | Range): boolean {
  const v = requireVersion(version);
  const r = typeof range === "string" ? parseRange(range) : range;
  if (!r.comparators.every((c) => holds(v, c))) return false;
  if (v.prerelease.length === 0) return true;
  return r.comparators.some(
    (c) =>
      c.version.prerelease.length > 0 &&
      // The internal `-0` bound of ^ and ~ does not opt in to pre-releases.
      !(c.version.prerelease.length === 1 && c.version.prerelease[0] === 0 && c.op === "<") &&
      c.version.major === v.major &&
      c.version.minor === v.minor &&
      c.version.patch === v.patch
  );
}
