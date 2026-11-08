const CAUSES: Readonly<Record<string, string>> = {
  ENOENT: "no such file",
  EACCES: "permission denied",
  EPERM: "operation not permitted",
  EISDIR: "is a directory",
};

/**
 * Reads a source file for a CLI command. A file-system failure becomes the line
 * the command prints, with its errno code: a missing file and a permission problem
 * need different fixes. Any other error is not a reading problem and is rethrown.
 */
export async function readSource(
  file: string
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  try {
    return { ok: true, text: await Bun.file(file).text() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code !== "string") throw error;
    return {
      ok: false,
      message: `Could not read file: ${file}: ${CAUSES[code] ?? (error as Error).message} (${code})`,
    };
  }
}
