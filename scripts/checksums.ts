/**
 * SHA256SUMS files (the `shasum -a 256` format) for the corpus in evals/linter/
 * and the live records in runs/live/: a listed file that changed or vanished is
 * reported, so committed data cannot be edited in place unnoticed.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const sha256 = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

/** Every line of a SHA256SUMS file whose file is missing or differs from its hash. */
export async function checksumMismatches(dir: string): Promise<string[]> {
  const sums = await Bun.file(resolve(dir, "SHA256SUMS")).text();
  const bad: string[] = [];
  for (const line of sums.split("\n").filter(Boolean)) {
    const [hash, name] = line.split(/\s+\*?/, 2) as [string, string];
    const file = Bun.file(resolve(dir, name));
    if (!(await file.exists())) bad.push(`${name}: missing`);
    else if (sha256(new Uint8Array(await file.arrayBuffer())) !== hash)
      bad.push(`${name}: changed`);
  }
  return bad;
}
