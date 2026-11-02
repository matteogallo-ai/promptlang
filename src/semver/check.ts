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
import { parseVersion, type SemVer } from "./semver";

export interface VersionCheck {
  ok: boolean;
  required: Level | "none";
  /** The bump the file actually made, judged the way `^` ranges judge it. */
  actual: Level | "none" | "downgrade";
  baseVersion: string | null;
  currentVersion: string | null;
  /** The smallest version that would satisfy the check, when it fails on the version. */
  expected?: string;
  reason?: string;
  changes: Change[];
}

/**
 * Below 1.0.0, `^0.y.z` treats a minor bump as breaking and a patch bump as
 * compatible; the check uses the same reading so that what it accepts is
 * exactly what consumers' `requires "^…"` ranges accept.
 */
function bumpOf(base: SemVer, cur: SemVer): Level | "none" | "downgrade" {
  const order = (["major", "minor", "patch"] as const).find((k) => base[k] !== cur[k]);
  if (!order) return "none";
  if (cur[order] < base[order]) return "downgrade";
  if (base.major === 0 && cur.major === 0) return order === "minor" ? "major" : "minor";
  return order;
}

function nextVersion(base: SemVer, level: Level): string {
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
  if (!base) return { ...result, ok: true, actual: required };

  const actual = bumpOf(base, cur);
  if (actual !== "downgrade" && levelRank(actual) >= levelRank(required)) {
    return { ...result, ok: true, actual };
  }
  return {
    ...result,
    ok: false,
    actual,
    expected: nextVersion(base, required),
    reason:
      actual === "downgrade"
        ? `@version went down from ${baseVersion} to ${currentVersion}`
        : `a ${required} change needs at least ${nextVersion(base, required)}, got ${currentVersion}`,
  };
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
