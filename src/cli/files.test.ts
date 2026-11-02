import { describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveFiles } from "./files";

describe("resolveFiles", () => {
  test("keeps .prompt paths, scans directories recursively and dedupes", async () => {
    const dir = "/tmp/promptlang-resolve-files";
    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, "nested"), { recursive: true });
    await Bun.write(join(dir, "a.prompt"), "");
    await Bun.write(join(dir, "nested", "b.prompt"), "");
    await Bun.write(join(dir, "notes.md"), "");
    const files = await resolveFiles([`${dir}/`, join(dir, "a.prompt")]);
    expect(files.sort()).toEqual([join(dir, "a.prompt"), join(dir, "nested", "b.prompt")]);
  });
});
