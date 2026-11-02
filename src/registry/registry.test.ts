import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config/config";
import { check, install } from "./registry";

const BASE = "/tmp/promptlang-registry-test";

async function makeProject(name: string): Promise<string> {
  const root = join(BASE, name);
  await mkdir(join(root, "prompts", "shared"), { recursive: true });
  await Bun.write(
    join(root, "promptlang.yaml"),
    "name: p\nversion: 1.0.0\nsources:\n  - path: ./prompts\n"
  );
  await Bun.write(
    join(root, "prompts", "shared", "a.prompt"),
    `@version "1.0.0"\nprompt a(x: string) -> string { user: "{{x}}" output: string }\n`
  );
  await Bun.write(
    join(root, "prompts", "b.prompt"),
    `import "./shared/a.prompt" as A\n@version "1.0.0"\nprompt b(x: string) -> string { user: "{{x}}" output: string }\n`
  );
  return root;
}

beforeAll(async () => {
  await rm(BASE, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(BASE, { recursive: true, force: true });
});

describe("integrity.json portability", () => {
  test("two checkouts at different roots write byte-identical integrity.json", async () => {
    const first = await makeProject("checkout-one");
    const second = await makeProject("elsewhere/checkout-two");
    await install(await loadConfig(join(first, "promptlang.yaml")), first);
    await install(await loadConfig(join(second, "promptlang.yaml")), second);

    const a = await Bun.file(join(first, ".promptlang", "integrity.json")).text();
    const b = await Bun.file(join(second, ".promptlang", "integrity.json")).text();
    expect(a).toBe(b);
    expect(Object.keys(JSON.parse(a)).sort()).toEqual([
      "prompts/b.prompt",
      "prompts/shared/a.prompt",
    ]);
  });

  test("a legacy integrity.json with absolute keys is migrated and still verifies", async () => {
    const root = await makeProject("legacy");
    const config = await loadConfig(join(root, "promptlang.yaml"));
    await install(config, root);
    const path = join(root, ".promptlang", "integrity.json");
    const relative = JSON.parse(await Bun.file(path).text()) as Record<string, string>;
    const legacy = Object.fromEntries(
      Object.entries(relative).map(([key, hash]) => [join(root, key), hash])
    );
    await Bun.write(path, JSON.stringify(legacy));

    expect(await check(config, root)).toEqual([]);

    await Bun.write(join(root, "prompts", "b.prompt"), `@version "1.0.1"\n`);
    const mismatches = await check(config, root);
    expect(mismatches.map((m) => m.file)).toEqual(["prompts/b.prompt"]);
  });
});
