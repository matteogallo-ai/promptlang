import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveImport, resolveGraph, ResolverError } from "./resolver";

const ROOT = "/tmp/promptlang-resolver-test";
const PROJECT = join(ROOT, "project");
const PROMPTS = join(PROJECT, "prompts");
const SHARED = join(PROJECT, "shared");
const VENDOR = join(PROJECT, "vendor", "support-templates");

const MIN_PROMPT = (name: string) =>
  `@version "1.0.0"\nprompt ${name}(x: string) -> string { user: "{{x}}" output: string }\n`;

beforeAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
  await mkdir(PROMPTS, { recursive: true });
  await mkdir(SHARED, { recursive: true });
  await mkdir(VENDOR, { recursive: true });

  // Basic files
  await Bun.write(join(PROMPTS, "root.prompt"), MIN_PROMPT("root"));
  await Bun.write(join(PROMPTS, "sibling.prompt"), MIN_PROMPT("sibling"));
  await Bun.write(join(SHARED, "classify.prompt"), MIN_PROMPT("classify"));
  await Bun.write(join(VENDOR, "greeting.prompt"), MIN_PROMPT("greeting"));

  // Root file with a relative import
  await Bun.write(
    join(PROMPTS, "with-relative.prompt"),
    `import "./sibling.prompt" as Sibling\n` + MIN_PROMPT("with_rel")
  );

  // Root file importing via `sources` (bare path)
  await Bun.write(
    join(PROMPTS, "with-shared.prompt"),
    `import "classify.prompt" as Classify\n` + MIN_PROMPT("with_shared")
  );

  // Vendor-style path
  await Bun.write(
    join(PROMPTS, "with-vendor.prompt"),
    `import "vendor/support-templates/greeting.prompt" as Greeting\n` + MIN_PROMPT("with_vendor")
  );

  // Multiple imports in one file
  await Bun.write(
    join(PROMPTS, "with-many.prompt"),
    `import "./sibling.prompt" as S\n` +
      `import "classify.prompt" as C\n` +
      MIN_PROMPT("with_many")
  );

  // Circular imports
  await Bun.write(join(PROMPTS, "cycle-a.prompt"), `import "./cycle-b.prompt" as B\n` + MIN_PROMPT("a"));
  await Bun.write(join(PROMPTS, "cycle-b.prompt"), `import "./cycle-a.prompt" as A\n` + MIN_PROMPT("b"));
});

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

describe("resolveImport", () => {
  test("resolves a relative import (./sibling.prompt) from the importing file", async () => {
    const from = join(PROMPTS, "with-relative.prompt");
    const resolved = await resolveImport("./sibling.prompt", from);
    expect(resolved).toBe(resolve(join(PROMPTS, "sibling.prompt")));
  });

  test("resolves a bare import via sources[*].path in config", async () => {
    const from = join(PROMPTS, "with-shared.prompt");
    const resolved = await resolveImport("classify.prompt", from, {
      sources: [{ path: "shared" }],
      projectRoot: PROJECT,
    });
    expect(resolved).toBe(resolve(join(SHARED, "classify.prompt")));
  });

  test("resolves a vendor-style path via sources", async () => {
    const from = join(PROMPTS, "with-vendor.prompt");
    const resolved = await resolveImport(
      "vendor/support-templates/greeting.prompt",
      from,
      { sources: [{ path: "." }], projectRoot: PROJECT }
    );
    expect(resolved).toBe(resolve(join(VENDOR, "greeting.prompt")));
  });

  test("throws ResolverError when the file cannot be found anywhere", async () => {
    const from = join(PROMPTS, "root.prompt");
    await expect(
      resolveImport("nonexistent.prompt", from, {
        sources: [{ path: "shared" }],
        projectRoot: PROJECT,
      })
    ).rejects.toThrow(ResolverError);
  });
});

describe("resolveGraph", () => {
  test("resolves multiple imports in a single file", async () => {
    const entry = join(PROMPTS, "with-many.prompt");
    const result = await resolveGraph([entry], {
      sources: [{ path: "shared" }],
      projectRoot: PROJECT,
    });
    expect(result.imports).toHaveLength(2);
    const aliases = result.imports.map((i) => i.alias).sort();
    expect(aliases).toEqual(["C", "S"]);
    expect(result.files).toHaveLength(3);
  });

  test("caches resolutions in the resulting manifest (no duplicate files)", async () => {
    const entry = join(PROMPTS, "with-many.prompt");
    const result = await resolveGraph([entry], {
      sources: [{ path: "shared" }],
      projectRoot: PROJECT,
    });
    const unique = new Set(result.files);
    expect(unique.size).toBe(result.files.length);
  });

  test("returns topological order (dependencies before dependents)", async () => {
    const entry = join(PROMPTS, "with-relative.prompt");
    const result = await resolveGraph([entry]);
    const idxSibling = result.order.indexOf(resolve(join(PROMPTS, "sibling.prompt")));
    const idxRoot = result.order.indexOf(resolve(entry));
    expect(idxSibling).toBeLessThan(idxRoot);
  });

  test("detects and rejects a direct circular import", async () => {
    const entry = join(PROMPTS, "cycle-a.prompt");
    await expect(resolveGraph([entry])).rejects.toThrow(ResolverError);
  });

  test("cycle error message names the offending files", async () => {
    const entry = join(PROMPTS, "cycle-a.prompt");
    try {
      await resolveGraph([entry]);
      throw new Error("expected error");
    } catch (e) {
      expect((e as Error).message).toContain("Circular import");
      expect((e as Error).message).toContain("cycle-a.prompt");
      expect((e as Error).message).toContain("cycle-b.prompt");
    }
  });
});
