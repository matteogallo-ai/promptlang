import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  hashFile,
  hashString,
  buildIntegrity,
  verifyIntegrity,
  mergeIntegrity,
} from "./integrity";

const ROOT = "/tmp/promptlang-integrity-test";

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe("hashFile / hashString", () => {
  test("computes a SHA-256 hex digest of a .prompt file", async () => {
    const file = join(ROOT, "a.prompt");
    await Bun.write(file, `@version "1.0.0"\n`);
    const h = await hashFile(file);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("same input always produces same hash (stability)", async () => {
    const file = join(ROOT, "stable.prompt");
    await Bun.write(file, `@version "1.0.0"\n`);
    const h1 = await hashFile(file);
    const h2 = await hashFile(file);
    expect(h1).toBe(h2);
    // Also stable across hashString for the same content.
    expect(hashString(`@version "1.0.0"\n`)).toBe(h1);
  });

  test("normalizes CRLF to LF so cross-platform hashes match", () => {
    const unix = hashString("line1\nline2\n");
    const win = hashString("line1\r\nline2\r\n");
    expect(unix).toBe(win);
  });
});

describe("buildIntegrity / verifyIntegrity", () => {
  test("verifyIntegrity returns [] when files are unchanged", async () => {
    const file = join(ROOT, "u.prompt");
    await Bun.write(file, `@version "1.0.0"\nprompt u() -> string { user: "x" output: string }\n`);
    const record = await buildIntegrity([file]);
    const mismatches = await verifyIntegrity(record);
    expect(mismatches).toEqual([]);
  });

  test("verifyIntegrity flags a file whose contents changed after recording", async () => {
    const file = join(ROOT, "changed.prompt");
    await Bun.write(file, `@version "1.0.0"\nprompt orig() -> string { user: "a" output: string }\n`);
    const record = await buildIntegrity([file]);
    // Mutate the file after building integrity.
    await Bun.write(file, `@version "1.0.0"\nprompt mutated() -> string { user: "b" output: string }\n`);
    const mismatches = await verifyIntegrity(record);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.file).toBe(file);
    expect(mismatches[0]!.expected).not.toBe(mismatches[0]!.actual);
  });

  test("verifyIntegrity flags a file that has been deleted", async () => {
    const file = join(ROOT, "deleted.prompt");
    await Bun.write(file, `@version "1.0.0"\n`);
    const record = await buildIntegrity([file]);
    await rm(file);
    const mismatches = await verifyIntegrity(record);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.actual).toBe("<missing>");
  });

  test("mergeIntegrity: newer entries override older ones", () => {
    const base = { "/a.prompt": "aaa", "/b.prompt": "bbb" };
    const update = { "/b.prompt": "b-new", "/c.prompt": "ccc" };
    const merged = mergeIntegrity(base, update);
    expect(merged).toEqual({
      "/a.prompt": "aaa",
      "/b.prompt": "b-new",
      "/c.prompt": "ccc",
    });
  });
});
