import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSource } from "./read-source";

describe("readSource", () => {
  test("returns the text of a readable file", async () => {
    expect(await readSource("docs/examples/classify-ticket.prompt")).toMatchObject({ ok: true });
  });

  test("a directory is named as a directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "promptlang-read-"));
    try {
      expect(await readSource(dir)).toEqual({
        ok: false,
        message: `Could not read file: ${dir}: is a directory (EISDIR)`,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
