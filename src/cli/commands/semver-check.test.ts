import { afterAll, beforeAll, describe, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runProcess, subprocessTest } from "../../../tests/support/subprocess";

// End to end: the real CLI, in a real Git repository with real commits.
const CLI = resolve(import.meta.dir, "../cli.ts");
let repo: string;

function file(version: string, params: string, text = "Hi {{x}}"): string {
  return `@version "${version}"\n@model claude-opus-5-5\nprompt p(${params}) -> string {\n  user: "${text}"\n}\n`;
}

async function sh(...cmd: string[]): Promise<string> {
  const r = await runProcess(cmd, repo);
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

async function semverCheck(...args: string[]) {
  return runProcess([process.execPath, CLI, "semver-check", ...args], repo);
}

beforeAll(async () => {
  repo = await mkdtemp(join(tmpdir(), "promptlang-semver-check-"));
  await sh("git", "init", "-q", "-b", "main");
  await sh("git", "config", "user.email", "test@example.com");
  await sh("git", "config", "user.name", "test");
  await sh("git", "config", "commit.gpgsign", "false");
  await Bun.write(join(repo, "prompts/a.prompt"), file("1.0.0", "x: string"));
  await sh("git", "add", ".");
  await sh("git", "commit", "-q", "-m", "v1");
  await sh("git", "tag", "v1.0.0");
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("semver-check in a Git repository", () => {
  subprocessTest("an unchanged tree passes against the latest tag by default", async () => {
    const r = await semverCheck();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("semver-check against v1.0.0");
    expect(r.stdout).toContain(
      "ok     prompts/a.prompt  1.0.0 → 1.0.0  (no interface or text change)"
    );
  });

  subprocessTest(
    "a removed parameter without a major bump fails with a readable report",
    async () => {
      await Bun.write(join(repo, "prompts/a.prompt"), file("1.1.0", "y?: string", "Hi {{y}}"));
      const r = await semverCheck("--base", "main");
      expect(r.exitCode).toBe(1);
      expect(r.stdout).toContain("FAIL   prompts/a.prompt  1.0.0 → 1.1.0");
      expect(r.stdout).toContain(
        "major bump required: a major change needs at least 2.0.0, got 1.1.0"
      );
      expect(r.stdout).toContain("- major: p: parameter 'x' removed");
    }
  );

  subprocessTest("--json reports the same verdict for tools", async () => {
    const r = await semverCheck("--base", "main", "--json");
    expect(r.exitCode).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report).toMatchObject({ base: "main", ok: false });
    expect(report.files[0]).toMatchObject({
      file: "prompts/a.prompt",
      status: "fail",
      required: "major",
      expected: "2.0.0",
    });
  });

  subprocessTest(
    "bumping to 2.0.0 and committing makes it pass; a new file is reported as new",
    async () => {
      await Bun.write(join(repo, "prompts/a.prompt"), file("2.0.0", "y?: string", "Hi {{y}}"));
      await Bun.write(join(repo, "prompts/b.prompt"), file("0.1.0", "x: string"));
      await sh("git", "add", ".");
      await sh("git", "commit", "-q", "-m", "v2");
      const r = await semverCheck("--base", "v1.0.0");
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("ok     prompts/a.prompt  1.0.0 → 2.0.0  (major required)");
      expect(r.stdout).toContain("new    prompts/b.prompt  0.1.0");
    }
  );

  subprocessTest("paths restrict the check, relative to the cwd", async () => {
    await Bun.write(join(repo, "prompts/b.prompt"), file("0.1.0", "x: string", "Changed"));
    expect((await semverCheck("--base", "HEAD", "prompts/a.prompt")).exitCode).toBe(0);
    expect((await semverCheck("--base", "HEAD", "prompts")).exitCode).toBe(1);
  });

  subprocessTest("an absolute path through a symlinked temp dir still finds the base", async () => {
    // On macOS tmpdir() is /var/..., a symlink to /private/var/... where Git reports the top.
    await Bun.write(join(repo, "prompts/a.prompt"), file("2.0.0", "z: string", "Hi {{z}}"));
    const r = await semverCheck("--base", "HEAD", join(repo, "prompts/a.prompt"));
    expect(r.stdout).not.toContain("new ");
    expect(r.exitCode).toBe(1);
    await sh("git", "checkout", "--", "prompts/a.prompt");
  });

  subprocessTest(
    "a renamed file is compared with its old path, so a breaking rename fails",
    async () => {
      await sh("git", "mv", "prompts/a.prompt", "prompts/renamed.prompt");
      await Bun.write(join(repo, "prompts/renamed.prompt"), file("2.0.0", "w: string", "Hi {{w}}"));
      const r = await semverCheck("--base", "HEAD", "prompts/renamed.prompt");
      expect(r.stdout).toContain("FAIL   prompts/renamed.prompt  2.0.0 → 2.0.0");
      expect(r.exitCode).toBe(1);
      await sh("git", "mv", "prompts/renamed.prompt", "prompts/a.prompt");
      await sh("git", "checkout", "HEAD", "--", "prompts/a.prompt");
    }
  );

  subprocessTest(
    "an unrelated file added while another is deleted is new, not a rename",
    async () => {
      await sh("git", "rm", "-q", "prompts/a.prompt");
      // Same header and shape as a.prompt, so Git's similarity alone would pair them.
      const other = file("2.0.0", "y?: string", "Hi {{y}}").replace(
        "prompt p(",
        "prompt summarize("
      );
      await Bun.write(join(repo, "prompts/other.prompt"), other);
      await sh("git", "add", "prompts/other.prompt");
      const r = await semverCheck("--base", "HEAD", "prompts/other.prompt");
      await sh("git", "rm", "-q", "-f", "prompts/other.prompt");
      await sh("git", "checkout", "HEAD", "--", "prompts/a.prompt");
      expect(r.stdout).toContain("new    prompts/other.prompt");
      expect(r.exitCode).toBe(0);
    }
  );

  subprocessTest("non-ASCII file names are checked, renamed or edited in place", async () => {
    const e = "prompts/\u00e9.prompt";
    await Bun.write(join(repo, e), file("1.0.0", "x: string"));
    await sh("git", "add", e);
    await sh("git", "commit", "-q", "-m", "accented");
    await Bun.write(join(repo, e), file("1.0.0", "q: string", "Hi {{q}}"));
    const inPlace = await semverCheck("--base", "HEAD");
    expect(inPlace.stdout).toContain("FAIL   prompts/\u00e9.prompt");
    const u = "prompts/\u00fc.prompt";
    await sh("git", "mv", e, u);
    const renamed = await semverCheck("--base", "HEAD", u);
    expect(renamed.stdout).toContain("FAIL   prompts/\u00fc.prompt");
    await sh("git", "mv", u, e);
    await sh("git", "checkout", "HEAD", "--", e);
  });

  subprocessTest("a file whose name starts with '..' is inside the repository", async () => {
    await Bun.write(join(repo, "..x.prompt"), file("1.0.0", "x: string"));
    const r = await semverCheck("--base", "HEAD", "..x.prompt");
    await rm(join(repo, "..x.prompt"));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("new    ..x.prompt");
  });

  subprocessTest(
    "from a subdirectory, a file present at the base is never read as new",
    async () => {
      await Bun.write(join(repo, "prompts/a.prompt"), file("2.0.0", "z: string", "Hi {{z}}"));
      const r = await runProcess(
        [process.execPath, CLI, "semver-check", "--base", "HEAD", "a.prompt"],
        join(repo, "prompts")
      );
      await sh("git", "checkout", "--", "prompts/a.prompt");
      expect(r.stdout).toContain("FAIL   a.prompt");
    }
  );

  subprocessTest("a base blob that cannot be read is an error, not a new file", async () => {
    const missing = "0123456789abcdef0123456789abcdef01234567";
    // A tree whose only file has no object: what a broken partial clone looks like.
    const flat = (
      await runProcess(
        ["sh", "-c", `printf '100644 blob ${missing}\\ta.prompt\\n' | git mktree --missing`],
        repo
      )
    ).stdout.trim();
    const top = (
      await runProcess(
        ["sh", "-c", `printf '040000 tree ${flat}\\tprompts\\n' | git mktree --missing`],
        repo
      )
    ).stdout.trim();
    const commit = (await sh("git", "commit-tree", top, "-m", "broken")).trim();
    const r = await semverCheck("--base", commit, "prompts/a.prompt");
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("cannot read prompts/a.prompt");
  });

  subprocessTest("a file outside the repository is a usage error", async () => {
    const outside = await mkdtemp(join(tmpdir(), "promptlang-outside-"));
    await Bun.write(join(outside, "x.prompt"), file("1.0.0", "x: string"));
    const r = await semverCheck("--base", "HEAD", join(outside, "x.prompt"));
    await rm(outside, { recursive: true, force: true });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("is outside the Git repository");
  });

  subprocessTest("an unknown ref, flag, or a directory outside Git exits 2", async () => {
    expect((await semverCheck("--base", "no-such-ref")).exitCode).toBe(2);
    expect((await semverCheck("--bogus")).exitCode).toBe(2);
    const outside = await mkdtemp(join(tmpdir(), "promptlang-no-git-"));
    const r = await runProcess([process.execPath, CLI, "semver-check"], outside);
    await rm(outside, { recursive: true, force: true });
    expect(r.exitCode).toBe(2);
  });
});
