/**
 * Does the `@version` change between two versions of a file cover the
 * interface changes between them? Rules: docs/adr/0003-semver-check.md.
 */
import type { Program } from "../ast/nodes";
import { LexerError } from "../lexer/errors";
import { tokenize } from "../lexer/lexer";
import { ParserError } from "../parser/errors";
import { parse } from "../parser/parser";
import { type Change, diffPrograms, type Level, levelRank, requiredLevel } from "./interface";
import { compareVersions, parseVersion, type SemVer } from "./semver";

type Actual = Level | "none" | "downgrade" | "prerelease";

export interface VersionCheck {
  ok: boolean;
  required: Level | "none";
  /**
   * The bump the file made, judged the way `^` ranges judge it; "prerelease"
   * when it moved forward inside a pre-release cycle.
   */
  actual: Actual;
  baseVersion: string | null;
  currentVersion: string | null;
  /** The smallest version that would satisfy the check, when it fails on the version. */
  expected?: string;
  reason?: string;
  changes: Change[];
}

const triplet = (v: SemVer) => `${v.major}.${v.minor}.${v.patch}`;

/**
 * Reads a bump the way `^` reads compatibility, so that what the check accepts
 * is what consumers' `requires "^…"` ranges accept: at 0.0.z every bump is
 * breaking, at 0.y.z a minor bump is breaking and a patch bump compatible.
 * Moving forward from a pre-release to a later pre-release or to its release
 * satisfies any change: pre-releases promise no compatibility (SemVer 2.0.0,
 * item 9), and `^` ranges do not select them.
 */
function bumpOf(baseText: string, curText: string, base: SemVer, cur: SemVer): Actual {
  const cmp = compareVersions(curText, baseText);
  if (cmp < 0) return "downgrade";
  if (cmp === 0) return "none";
  if (base.prerelease.length > 0 && triplet(base) === triplet(cur)) return "prerelease";
  // Past its pre-release cycle, a version is judged against the release it led to.
  if (base.prerelease.length > 0) base = { ...base, prerelease: [] };
  const order = (["major", "minor", "patch"] as const).find((k) => base[k] !== cur[k]);
  if (!order) return "none";
  if (base.major === 0 && cur.major === 0) {
    if (base.minor === 0 && cur.minor === 0) return "major";
    return order === "minor" ? "major" : "minor";
  }
  return order;
}

function nextVersion(base: SemVer, level: Level): string {
  if (base.major === 0 && base.minor === 0) return `0.0.${base.patch + 1}`;
  if (base.major === 0) {
    return level === "major" ? `0.${base.minor + 1}.0` : `0.${base.minor}.${base.patch + 1}`;
  }
  if (level === "major") return `${base.major + 1}.0.0`;
  if (level === "minor") return `${base.major}.${base.minor + 1}.0`;
  return `${base.major}.${base.minor}.${base.patch + 1}`;
}

export function checkVersion(
  baseVersion: string | null,
  currentVersion: string | null,
  changes: Change[]
): VersionCheck {
  const required = requiredLevel(changes);
  const result = { required, baseVersion, currentVersion, changes };
  const base = baseVersion === null ? null : parseVersion(baseVersion);
  const cur = currentVersion === null ? null : parseVersion(currentVersion);

  if (base && cur && baseVersion && currentVersion) {
    const actual = bumpOf(baseVersion, currentVersion, base, cur);
    if (actual === "downgrade") {
      return {
        ...result,
        ok: false,
        actual,
        reason: `@version went down from ${baseVersion} to ${currentVersion}`,
      };
    }
    if (
      required === "none" ||
      actual === "prerelease" ||
      (actual !== "none" && levelRank(actual) >= levelRank(required))
    ) {
      return { ...result, ok: true, actual };
    }
    if (base.prerelease.length > 0) {
      const release = triplet(base);
      // Staying on the pre-release: the release itself is the next version that passes.
      const expected =
        actual === "none" ? release : nextVersion({ ...base, prerelease: [] }, required);
      const options =
        actual === "none"
          ? `a later pre-release of ${release}, or ${release}`
          : `a later pre-release of ${release}, ${release} itself, or at least ${expected}`;
      return {
        ...result,
        ok: false,
        actual,
        expected,
        reason: `a ${required} change after ${baseVersion} needs ${options}; got ${currentVersion}`,
      };
    }
    const expected = nextVersion(base, required);
    return {
      ...result,
      ok: false,
      actual,
      expected,
      reason: `a ${required} change needs at least ${expected}, got ${currentVersion}`,
    };
  }
  if (required === "none") return { ...result, ok: true, actual: "none" };
  if (!cur) {
    return {
      ...result,
      ok: false,
      actual: "none",
      reason: "the file changed but declares no @version",
    };
  }
  // A file versioned for the first time has no earlier contract to break.
  return { ...result, ok: true, actual: required };
}

type FileStatus = "ok" | "fail" | "new" | "error";

export interface FileCheck extends Partial<VersionCheck> {
  file: string;
  status: FileStatus;
  /** Set when `status` is "error": a version of the file did not parse. */
  error?: string;
}

function versionOf(program: Program): string | null {
  const m = program.metadata.find((x) => x.kind === "VersionMetadata");
  return m ? m.value : null;
}

type Parsed = { program: Program } | { error: string };

function parseText(text: string, label: string): Parsed {
  try {
    return { program: parse(tokenize(text)) };
  } catch (error) {
    // Only syntax errors are a verdict about the file; anything else is a bug and propagates.
    if (error instanceof LexerError || error instanceof ParserError) {
      return { error: `${label}: ${error.message}` };
    }
    throw error;
  }
}

/**
 * Checks one file. `baseText` is null when the file does not exist at the base.
 * A version that does not parse is reported, not thrown: the check cannot say
 * anything about that file, and the other files still deserve a verdict.
 */
export function checkFile(file: string, baseText: string | null, currentText: string): FileCheck {
  const current = parseText(currentText, "current version");
  if ("error" in current) return { file, status: "error", error: current.error };
  if (baseText === null) return { file, status: "new", currentVersion: versionOf(current.program) };
  const base = parseText(baseText, "base version");
  if ("error" in base) return { file, status: "error", error: base.error };
  const result = checkVersion(
    versionOf(base.program),
    versionOf(current.program),
    diffPrograms(base.program, current.program)
  );
  return { file, status: result.ok ? "ok" : "fail", ...result };
}
