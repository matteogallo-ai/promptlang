import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statOrNull } from "./stat-or-null";

describe("statOrNull", () => {
  test("returns the stats of a file and of a directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stat-or-null-"));
    await writeFile(join(dir, "f"), "x");
    expect((await statOrNull(join(dir, "f")))?.isFile()).toBe(true);
    expect((await statOrNull(dir))?.isDirectory()).toBe(true);
  });

  test("returns null when nothing is at the path", async () => {
    expect(await statOrNull(join(tmpdir(), "stat-or-null-missing", "nope"))).toBeNull();
  });

  test("rethrows a failure that is not ENOENT", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stat-or-null-"));
    await writeFile(join(dir, "f"), "x");
    // A path through a regular file fails with ENOTDIR, not ENOENT.
    await expect(statOrNull(join(dir, "f", "child"))).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});
