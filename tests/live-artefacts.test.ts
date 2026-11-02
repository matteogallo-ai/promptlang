import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checksumMismatches } from "../scripts/checksums";

const ROOT = join(import.meta.dir, "..");

describe("runs/live artefacts", () => {
  const LIVE = join(ROOT, "runs/live");

  test("every artefact is listed in SHA256SUMS and matches its hash: committed results are immutable", async () => {
    expect(await checksumMismatches(LIVE)).toEqual([]);
    const listed = (await Bun.file(join(LIVE, "SHA256SUMS")).text())
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split(/\s+\*?/, 2)[1]);
    const files = (await readdir(LIVE)).filter((f) => f !== "README.md" && f !== "SHA256SUMS");
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => !listed.includes(f))).toEqual([]);
  });

  test("a changed artefact is reported", async () => {
    const dir = join(ROOT, "runs/live");
    const sums = await Bun.file(join(dir, "SHA256SUMS")).text();
    const t = await mkdtemp(join(tmpdir(), "promptlang-live-"));
    try {
      const first = sums.split("\n")[0]!.split(/\s+/)[1]!;
      await Bun.write(join(t, "SHA256SUMS"), `${sums.split("\n")[0]!}\n`);
      await Bun.write(join(t, first), `${await Bun.file(join(dir, first)).text()} `);
      expect(await checksumMismatches(t)).toEqual([`${first}: changed`]);
    } finally {
      await rm(t, { recursive: true, force: true });
    }
  });
});
