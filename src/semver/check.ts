/**
 * Does the `@version` change between two versions of a file cover the
 * interface changes between them? Rules: docs/adr/0003-semver-check.md.
 */
import { type Change, type Level, levelRank, requiredLevel } from "./interface";
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
