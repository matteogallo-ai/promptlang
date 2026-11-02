import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";

/**
 * `stat`, or null when nothing is at `path`. Any other failure (permissions, I/O)
 * is rethrown: a script that silently treats an unreadable path as absent would
 * pass while checking nothing.
 */
export async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
