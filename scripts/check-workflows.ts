/**
 * Supply-chain rules for GitHub Actions workflows, run by tests/workflows.test.ts
 * over every file in .github/workflows/. The rules read the parsed YAML, so flow
 * style (`steps: [{ uses: ... }]`) is checked like block style and `run:` scripts
 * are never mistaken for configuration. Comments are not in the parsed document:
 * the raw text is read only for them.
 */
const SHA_PIN = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;
const DIGEST_PIN = /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/;
// Dependabot rewrites this comment to the new tag; it may be "v7" or "1.2.3".
const VERSION_COMMENT = /^["']?\s*#\s*v?\d+(?:\.\d+)*\b/;

interface Job {
  uses?: unknown;
  steps?: unknown;
  permissions?: unknown;
  needs?: unknown;
}

const ATTEST = /^actions\/attest(-build-provenance)?@/;

function runScripts(job: Job): string[] {
  if (!Array.isArray(job.steps)) return [];
  return job.steps.map((s) => (typeof s?.run === "string" ? s.run : ""));
}

// Line continuations and runs of spaces are joined, so `gh  release \` + newline +
// `create` is still seen.
const GH_RELEASE = /\bgh\s+release\s+(create|upload)\b/;

/**
 * A `run:` script calling `gh release create` or `gh release upload` must itself
 * name a `.sigstore.json` file, and its job, or a job it lists directly in
 * `needs`, must have an attestation step. An unsigned release counts 0 in
 * Scorecard's Signed-Releases average, and a user could not verify the tarball.
 * This reads the script text: releases made by other actions or through
 * `gh api` are not recognised, and an attestation step's `if:` is not evaluated.
 */
function unsignedReleases(file: string, jobs: Record<string, Job>): string[] {
  const out: string[] = [];
  for (const [name, job] of Object.entries(jobs)) {
    const releasing = runScripts(job)
      .map((r) => r.replace(/\\\n/g, " "))
      .filter((r) => GH_RELEASE.test(r));
    if (releasing.length === 0) continue;
    const needs =
      typeof job.needs === "string" ? [job.needs] : Array.isArray(job.needs) ? job.needs : [];
    const attested = [name, ...needs].some((n) =>
      actionRefs(jobs[n] ?? {}).some((ref) => ATTEST.test(ref))
    );
    if (!attested)
      out.push(
        `${file}: job ${name}: makes a GitHub Release, but neither it nor a job it needs runs actions/attest-build-provenance`
      );
    if (releasing.some((r) => !r.includes(".sigstore.json")))
      out.push(
        `${file}: job ${name}: a gh release script does not attach the .sigstore.json attestation bundle`
      );
  }
  return out;
}

function actionRefs(job: Job): string[] {
  const refs = typeof job.uses === "string" ? [job.uses] : [];
  if (Array.isArray(job.steps))
    for (const step of job.steps) if (typeof step?.uses === "string") refs.push(step.uses);
  return refs;
}

function pinViolation(file: string, ref: string, lines: string[]): string | null {
  if (ref.startsWith("./") || DIGEST_PIN.test(ref)) return null;
  if (!SHA_PIN.test(ref)) return `${file}: ${ref} is not pinned to a full commit SHA`;
  const line = lines.find((l) => l.includes(ref) && l.includes("uses"));
  const after = line ? line.slice(line.indexOf(ref) + ref.length).trim() : "";
  return VERSION_COMMENT.test(after) ? null : `${file}: ${ref} has no version comment (# vX.Y.Z)`;
}

/**
 * The block-style `key: write` lines of each job's `permissions:`, keyed
 * "job/key", and whether the line right above each is a comment. The
 * workflow-level block (indent 0) is skipped: it may hold no write at all.
 */
function commentedWrites(lines: string[]): Map<string, boolean> {
  const found = new Map<string, boolean>();
  let blockIndent = -1;
  let inJobs = false;
  let job = "";
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) inJobs = /^jobs:\s*(#.*)?$/.test(line);
    const name = inJobs ? /^ {2}([\w-]+):\s*(#.*)?$/.exec(line) : null;
    if (name) job = name[1]!;
    if (blockIndent >= 0 && indent <= blockIndent) blockIndent = -1;
    const opens = /^(\s+)permissions:\s*(#.*)?$/.exec(line);
    if (opens) {
      blockIndent = opens[1]!.length;
      return;
    }
    const write = blockIndent >= 0 ? /^\s*([\w-]+):\s*write\s*(#.*)?$/.exec(line) : null;
    if (write) found.set(`${job}/${write[1]}`, lines[i - 1]?.trim().startsWith("#") ?? false);
  });
  return found;
}

/**
 * Returns one message per broken rule in a workflow file:
 * - every action is pinned to a full commit SHA followed by a version comment, or
 *   is a local workflow, or a Docker image pinned by digest;
 * - the workflow-level token is `contents: read`, or the stricter `{}`;
 * - a job never gets `write-all`, and every job-level `write` sits in a block-style
 *   `permissions:` with its own comment line right above it saying why;
 * - no `pull_request_target`, which runs with secrets on code from forks;
 * - no `github.event.*` or `github.head_ref` expression inside a `run:` script:
 *   a PR title or branch name is attacker-written, and interpolated it becomes
 *   shell code. Through `env:` it stays a value.
 * - no `gh release create` without a signed attestation bundle (see unsignedReleases).
 */
export function workflowViolations(file: string, text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  const doc = Bun.YAML.parse(text) as { on?: unknown; permissions?: unknown; jobs?: unknown };
  const jobs = Object.entries((doc.jobs ?? {}) as Record<string, Job>);

  for (const [, job] of jobs)
    for (const ref of actionRefs(job)) {
      const v = pinViolation(file, ref, lines);
      if (v) out.push(v);
    }

  const top = JSON.stringify(doc.permissions);
  if (top !== JSON.stringify({ contents: "read" }) && top !== "{}")
    out.push(`${file}: workflow-level permissions must be { contents: read } or {}, got ${top}`);

  const commented = commentedWrites(lines);
  for (const [name, job] of jobs) {
    if (job.permissions === "write-all") out.push(`${file}: job ${name}: permissions write-all`);
    if (typeof job.permissions !== "object" || job.permissions === null) continue;
    for (const [key, value] of Object.entries(job.permissions))
      if (value === "write" && !commented.get(`${name}/${key}`))
        out.push(
          `${file}: job ${name}: ${key}: write has no comment line right above it saying why`
        );
  }

  if (triggers(doc.on).includes("pull_request_target"))
    out.push(`${file}: uses pull_request_target`);
  out.push(...unsignedReleases(file, Object.fromEntries(jobs)));

  // Without a version, or with a moving tag, setup-bun installs the newest Bun, so
  // a rebuild of a tag does not run the Bun that built it. A matrix expression is
  // left alone: ci.yml tests "latest" on purpose, next to the 1.2.20 floor.
  for (const [name, job] of jobs)
    for (const step of Array.isArray(job.steps) ? job.steps : []) {
      if (typeof step?.uses !== "string" || !step.uses.startsWith("oven-sh/setup-bun@")) continue;
      const version = step.with?.["bun-version"];
      if (!version && !step.with?.["bun-version-file"])
        out.push(
          `${file}: job ${name}: oven-sh/setup-bun without bun-version or bun-version-file installs whatever Bun is newest`
        );
      else if (version === "latest" || version === "canary")
        out.push(
          `${file}: job ${name}: oven-sh/setup-bun with bun-version: ${version} installs whatever Bun is newest`
        );
    }

  for (const [name, job] of jobs)
    for (const step of Array.isArray(job.steps) ? job.steps : [])
      if (typeof step?.run === "string")
        for (const m of step.run.matchAll(UNTRUSTED_IN_SCRIPT))
          out.push(
            `${file}: job ${name}: ${m[0]} is interpolated into a run script; pass it through env`
          );
  return out;
}

const UNTRUSTED_IN_SCRIPT = /\$\{\{[^}]*\bgithub\.(?:event\.|head_ref\b)[^}]*\}\}/g;

function triggers(on: unknown): string[] {
  return typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on ?? {});
}

/**
 * The check-run names a workflow reports on a pull request, as a ruleset's
 * required status checks must spell them: the job's `name` (or its key), with
 * `${{ matrix.<key> }}` expanded, or `key (value)` for an unnamed one-key list
 * matrix. Throws on what it cannot name for certain (a reusable-workflow job,
 * any other matrix) and on what can leave a required check unreported, so that
 * the pull request waits forever: a `pull_request` filter or a job-level `if:`.
 */
export function pullRequestCheckNames(text: string): string[] {
  const doc = Bun.YAML.parse(text) as { on?: unknown; jobs?: Record<string, unknown> };
  if (!triggers(doc.on).includes("pull_request")) return [];
  const pr = (doc.on as Record<string, unknown>)?.pull_request;
  for (const filter of ["paths", "paths-ignore", "branches", "branches-ignore", "types"])
    if (pr && typeof pr === "object" && filter in pr)
      throw new Error(`pull_request filter ${filter}: a required check could never report`);
  const names: string[] = [];
  for (const [key, raw] of Object.entries(doc.jobs ?? {})) {
    const job = raw as {
      name?: unknown;
      if?: unknown;
      uses?: unknown;
      strategy?: { matrix?: Record<string, unknown> };
    };
    if (job.if !== undefined)
      throw new Error(`job ${key} has an if: a required check could never report`);
    if (job.uses !== undefined)
      throw new Error(
        `job ${key} calls a reusable workflow, whose check names are not derived here`
      );
    const matrix = Object.entries(job.strategy?.matrix ?? {});
    if (matrix.length === 0) {
      names.push(typeof job.name === "string" ? job.name : key);
      continue;
    }
    const [axis, values] = matrix[0]!;
    if (matrix.length > 1 || !Array.isArray(values))
      throw new Error(`job ${key} has a matrix whose check names are not derived here`);
    for (const v of values)
      names.push(
        typeof job.name === "string"
          ? job.name.replace(new RegExp(`\\$\\{\\{\\s*matrix\\.${axis}\\s*\\}\\}`, "g"), String(v))
          : `${key} (${String(v)})`
      );
  }
  return names;
}
