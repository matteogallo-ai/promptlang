import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const flat = (s: string) => s.replace(/\s*\n\s*/g, " ");

/**
 * In these docs a test is cited as `path/to/file.test.ts` followed by its quoted
 * name. A doc that names a test which was renamed or deleted claims a proof that
 * no longer exists, so every quoted string after a test path, up to the next
 * heading, must be in that file.
 */
async function missingCitations(doc: string): Promise<string[]> {
  const sections = (await Bun.file(resolve(ROOT, doc)).text()).split(/^#/m).map(flat);
  const missing: string[] = [];
  for (const text of sections) {
    let file: string | null = null;
    for (const m of text.matchAll(/`([\w./-]+\.test\.ts)`|"([^"]+)"/g)) {
      if (m[1]) {
        file = m[1];
        if (!(await Bun.file(resolve(ROOT, file)).exists())) missing.push(`${file}: no such file`);
        continue;
      }
      if (!file) continue;
      const src = flat(await Bun.file(resolve(ROOT, file)).text());
      if (!src.includes(m[2]!)) missing.push(`${file}: "${m[2]}"`);
    }
  }
  return missing;
}

describe("tests cited by the system docs", () => {
  for (const doc of [
    "docs/THREAT_MODEL.md",
    "docs/RUNBOOK.md",
    "docs/SLO.md",
    "docs/SYSTEM_CARD.md",
  ]) {
    test(`every test cited by ${doc} exists under that name`, async () => {
      expect(await missingCitations(doc)).toEqual([]);
    });
  }

  test("a renamed test is reported", async () => {
    const dir = await mkdtemp(join(tmpdir(), "promptlang-cite-"));
    const tmp = join(dir, "doc.md");
    await Bun.write(
      tmp,
      `# A\n\`tests/live-artefacts.test.ts\` "a changed artefact is reported" and "renamed away"\n\n# B\n"not under a test path"\n`
    );
    try {
      expect(await missingCitations(tmp)).toEqual(['tests/live-artefacts.test.ts: "renamed away"']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
