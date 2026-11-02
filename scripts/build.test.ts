import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDeclarationExtensions } from "./build";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "promptlang-build-"));
  await mkdir(join(dir, "runtime"));
  await writeFile(join(dir, "errors.d.ts"), "");
  await writeFile(join(dir, "runtime", "index.d.ts"), "");
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("addDeclarationExtensions", () => {
  test("names the file or the directory index each relative import refers to", async () => {
    const text = `export { A } from "./errors";\nexport type * from "./runtime";\ntype T = import("./errors").A;\nimport x from "node:path";\n`;
    expect(await addDeclarationExtensions(join(dir, "index.d.ts"), text)).toBe(
      `export { A } from "./errors.js";\nexport type * from "./runtime/index.js";\ntype T = import("./errors.js").A;\nimport x from "node:path";\n`
    );
  });

  test("fails the build on an import with no declaration behind it", async () => {
    await expect(
      addDeclarationExtensions(join(dir, "index.d.ts"), `export * from "./missing";`)
    ).rejects.toThrow('cannot resolve declaration import "./missing"');
  });
});
