# How this was built

Built with coding agents: I write the specs, review the pull requests and their tests, and answer for what gets merged.

## History

PromptLang was written mostly by a coding agent (Claude Code) working from the
maintainer's specifications, one milestone per release; the git history up to
v1.2.0 shows one large commit per milestone.

On 2026-11-02 an independent external audit compared the README with the code. It found
that the two headline features — "SemVer for prompts" and "Native tests" — were
marked ✅ but not implemented; that `src/index.ts` exported only a hard-coded
`VERSION = "0.1.0-alpha.0"` in v1.2.0; that the test badge double-counted the
workspace package's tests; that cross-provider fallback could not work; and that
the package could not be published under its name. A follow-up review of the
docs found that `parallel` steps and calls to imported prompts, both documented,
do not parse. Both headline features were then implemented, with the scope stated
in [`docs/usage.md`](usage.md) (Tests, Versioning).

What changed in response:

- every README capability is now listed in [`docs/CLAIMS.md`](CLAIMS.md)
  with its test, and CI (`claims`) fails if the README shows an unshipped one as ✅;
- CI (`stale-narrative`) rejects forward-looking release talk and untracked TODOs in code and docs;
- Biome and knip run in CI; dead code they reported was removed;
- the package is `@promptlang/core` and its entry point exports the compiler API;
- the rules followed for every change are in
  [`docs/ENGINEERING_STANDARDS.md`](ENGINEERING_STANDARDS.md).

Design decisions are recorded in [`docs/adr/`](adr/).

## What I'd do differently

**Evaluation before shipping.** The AI linter shipped before it had an evaluation set. Once measured on a held-out split, it caught 44/45 and 45/45 planted defects across two runs, but only 20% of its flags were scored correct, against 12.5% for a linter that flags every category; a pre-registered human review of 40 flags measured about 30% (95% CI 18–45%), not distinguishable from that 20%. It stays a reviewer aid, not a gate. Today, an AI feature ships with its eval set, metric and confidence interval, or it ships behind an explicit "unmeasured" label in [CLAIMS](CLAIMS.md). ([#11](https://github.com/matteogallo-ai/promptlang/pull/11), [#14](https://github.com/matteogallo-ai/promptlang/pull/14))

**Claims enforced by CI, not by discipline.** Every feature the README advertises now maps to a passing test in `docs/CLAIMS.md`, and CI fails if one isn't backed. I'd have built that gate first. ([#1](https://github.com/matteogallo-ai/promptlang/pull/1))

**Supply-chain and test-quality gates from day one.** Signed releases with provenance, Scorecard, fuzzing and mutation testing on the lexer, parser and semver (96%) were added in a dedicated hardening pass. In a new project, Scorecard runs in CI from the first commit, and fuzzing, mutation testing and signed releases are [Definition of Done](DEFINITION_OF_DONE.md) items (G1–G3). ([#5](https://github.com/matteogallo-ai/promptlang/pull/5), [#8](https://github.com/matteogallo-ai/promptlang/pull/8), [#10](https://github.com/matteogallo-ai/promptlang/pull/10), [#13](https://github.com/matteogallo-ai/promptlang/pull/13))

**A per-call spending cap before the first paid call.** The first live linter run was guarded only by a check, in its script, that the whole run's worst-case estimate stayed under the approved $0.05; a cap checked before every call against the spend so far came after it. Now `analyze --ai`, `test --live`, the linter eval and the live linter run go through `BudgetedClient`, which does not send a call whose worst case would take the spend past the approved amount. ([ADR 0004](adr/0004-spending-cap.md))
