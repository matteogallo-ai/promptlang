import { expect, test } from "bun:test";
import { Glob } from "bun";

// A fixed temporary path is shared by concurrent runs, which then delete each
// other's files; tests/support/scratch.ts gives each run its own directory.
test("no test writes to a fixed path under /tmp or the working directory", async () => {
  const offenders: string[] = [];
  for await (const file of new Glob("{src,tests,scripts,packages}/**/*.test.ts").scan(".")) {
    const text = await Bun.file(file).text();
    for (const m of text.matchAll(/["'`](\/tmp\/|\.\/tmp-)[^"'`]*["'`]/g))
      offenders.push(`${file}: ${m[0]}`);
  }
  expect(offenders).toEqual([]);
});
