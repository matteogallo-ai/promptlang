/**
 * SHA256SUMS files (the `shasum -a 256` format) for the corpus in evals/linter/
 * and the live records in runs/live/: a listed file that changed or vanished is
 * reported, so committed data cannot be edited in place unnoticed.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const sha256 = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

/** The (hash, file name) entries of a SHA256SUMS file; a malformed line is an error. */
export async function listedChecksums(dir: string): Promise<Array<[hash: string, name: string]>> {
  const sums = await Bun.file(resolve(dir, "SHA256SUMS")).text();
  return sums
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      // shasum writes "<hash>  <name>", or "<hash> *<name>" in binary mode; names may hold spaces.
      const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line);
      if (!m) throw new Error(`${dir}/SHA256SUMS: malformed line: ${line}`);
      return [m[1]!, m[2]!];
    });
}

/** Every line of a SHA256SUMS file whose file is missing or differs from its hash. */
export async function checksumMismatches(dir: string): Promise<string[]> {
  const bad: string[] = [];
  for (const [hash, name] of await listedChecksums(dir)) {
    const file = Bun.file(resolve(dir, name));
    if (!(await file.exists())) bad.push(`${name}: missing`);
    else if (sha256(new Uint8Array(await file.arrayBuffer())) !== hash)
      bad.push(`${name}: changed`);
  }
  return bad;
}
