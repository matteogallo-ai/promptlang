import { Glob } from "bun";

/**
 * Expands CLI path arguments into `.prompt` files: a `.prompt` path is kept,
 * a path containing `*` is a glob relative to the cwd, anything else is a
 * directory scanned recursively. Duplicates are dropped; order is preserved.
 */
export async function resolveFiles(paths: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const p of paths) {
    if (p.includes("*")) {
      const glob = new Glob(p);
      for await (const file of glob.scan(".")) {
        if (file.endsWith(".prompt")) files.push(file);
      }
    } else if (p.endsWith(".prompt")) {
      files.push(p);
    } else {
      const dir = p.replace(/\/+$/, "");
      const glob = new Glob("**/*.prompt");
      for await (const file of glob.scan(dir)) {
        files.push(`${dir}/${file}`);
      }
    }
  }

  return [...new Set(files)];
}
