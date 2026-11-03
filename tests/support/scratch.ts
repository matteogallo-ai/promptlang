import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A temporary directory of this test process. Test files name their paths
 * inside it: a fixed path under /tmp is shared by every concurrent run (two
 * worktrees, two terminals), whose tests then delete each other's files.
 * `scratch-cleanup.ts`, preloaded by bunfig.toml, removes it after the run.
 */
export const SCRATCH = mkdtempSync(join(tmpdir(), "promptlang-test-"));
