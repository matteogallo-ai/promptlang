# CLAUDE.md — PromptLang

## What this is

PromptLang is a typed DSL for LLM prompts. A `.prompt` file declares types, prompts,
chains, tests and evals; the compiler turns it into typed TypeScript or Python
functions that call a provider through a `PromptClient`. The package is
`@promptlang/core` (CLI binary `promptlang`; published from `v*` tags by
`.github/workflows/release.yml`), built with Bun and TypeScript, with no third-party
runtime dependencies. `docs/CLAIMS.md` is the source
of truth for what is shipped, partial or roadmap — read it before touching docs.

## Architecture

```
.prompt ─► lexer ─► parser ─► AST ─┬─► compiler (TypeScript) ─► .ts + index.ts
                                   ├─► compiler/python        ─► .py + runtime
                                   └─► analyzer (static rules, optional AI linter)
           registry: resolver (imports) + integrity.json/manifest.json
generated code ─► runtime (PromptClient, Anthropic/OpenAI/Ollama/Routing clients)
```

There is no general semantic-analysis pass. The compilers check that each `test`
block calls a prompt or chain of the same file; `promptlang test` runs tests
against the generated TypeScript (`src/testing/`); `eval` blocks are parsed only.
`@version` is SemVer-validated by the parser; `src/semver/` holds the comparator,
the interface diff and the bump check behind `semver-check`.

## Layout

```
src/index.ts         public API of @promptlang/core
src/lexer/           tokens (token.ts, lexer.ts, errors.ts)
src/parser/          recursive descent parser; grammar.md is the EBNF
src/ast/             node types, printer
src/registry/        resolver.ts (imports, requires ranges), integrity.ts, registry.ts (install/check)
src/semver/          semver.ts (SemVer 2.0.0), interface.ts (interface diff), check.ts (bump check)
src/testing/         runner.ts (promptlang test), schema.ts, cost.ts (live estimate)
src/compiler/        TypeScript generator, chain-compiler.ts; python/ for Python
src/analyzer/        analyzer.ts, rules/ (6 static rules), ai/ (AI linter)
src/runtime/         client.ts (MockClient), errors.ts, providers/
src/config/          promptlang.yaml loading
src/cli/             cli.ts + commands/
packages/yaml-parser @promptlang/yaml-parser (published separately)
scripts/             check-claims.ts, check-stale-narrative.ts, check-commits.ts, demo.ts,
                     build.ts, consumer-test.ts, ai-linter-live-run.ts, check-workflows.ts
benchmarks/bench.ts  generates docs/benchmarks.md
tests/               cross-module tests; tests/support/ test helpers
docs/                reference docs, CLAIMS.md, ENGINEERING_STANDARDS.md, DEFINITION_OF_DONE.md, examples/
```

Tests are colocated (`foo.ts` → `foo.test.ts`).

## Commands (Bun >= 1.2.20)

```bash
bun install --frozen-lockfile
bun run typecheck                    # bunx tsc --noEmit (root) + packages/yaml-parser
bun test                             # all tests, root and packages
(cd packages/yaml-parser && bun test)
bun run lint                         # biome check . ; bun run lint:fix to apply
bun run knip                         # dead code / unused exports and deps
bun run check:claims                 # docs/CLAIMS.md vs README; runs each claim's test
bun run check:stale-narrative        # "coming in vX", sprint IDs, TODO without (#issue)
bun run check:commits main..HEAD     # Conventional Commits on a range
bun run bench --write                # regenerate docs/benchmarks.md
bun run demo                         # SemVer scenario in a temporary Git repo
bun run build                        # dist/: ESM + .d.ts (also run by npm pack)
bun run test:consumer                # npm pack → install → use from Node (needs npm, node)
bun run cli <command>                # parse | tokens | analyze | compile | init | install | list | check | semver-check | test | version
```

All of these run in CI (`.github/workflows/ci.yml`). Never make a paid provider call
(e.g. `analyze --ai`, `test --live`, real `AnthropicClient` requests) without a cost estimate and
Matteo's explicit approval.

---

## Appendix A — How coding agents must work in my repos

Every repo's `CLAUDE.md` reproduces this appendix verbatim, below a short repo-specific
section (what it is, layout, exact commands). Its purpose: make the agent engineer, not
generate.

### Engineer, don't generate
1. **Read before you write.** Find the existing module, contract and test for what you are
   changing. Extend it; never create a parallel version.
2. **Smallest change that meets the acceptance criteria.** No speculative abstractions, no
   "for future use" parameters, no options nobody asked for.
3. **Second copy = extract.** About to paste a helper? Move it to a shared module and test it once.
4. **Failing test first** for every bug: show it red, then fix, then show it green.
5. **Name the failure modes** of what you write (timeout, empty input, malformed model output,
   provider down, oversized input, hostile content) and test the ones that matter.
6. **Comments explain why — never what, never when.** No sprint IDs, no "will be added later",
   no restating the code.
7. **Deterministic code over model calls** whenever the answer is computable. The model
   proposes; code validates.
8. **Never report success without the command output that proves it.**
9. **Challenge with evidence.** If an instruction, finding or ADR looks wrong, say so with file,
   line and output — do not comply silently, do not "fix" something that is not broken.
10. **Explain trade-offs** in the PR: what you chose, what you rejected, why.
11. **Independent review before handing back**: a fresh-context reviewer subagent checks the
    diff against these standards; report what it found, what you fixed, what you rejected and why.

### Forbidden
- Claiming in README/docs a feature that has no passing test listed in `docs/CLAIMS.md`.
- Future tense or sprint references in source code or docs.
- Presenting any score computed on a stub, mock or fixture as a quality measure.
- Concatenating untrusted content (retrieved, ingested, scraped, tool output) into a prompt
  without delimiters and an explicit untrusted-content instruction.
- Catch-all exception handlers without a justifying comment and a typed re-raise or log.
- Secrets held in plain strings where the framework offers a secret type
  (e.g. pydantic `SecretStr`).
- Any paid model call without a cost estimate and explicit approval.
- Commits over ~400 changed lines (lockfiles and generated artefacts excluded).
- Pushing to main, force-pushing, tagging or publishing: the human does that. Pushing a work
  branch and opening a PR is allowed; GitHub rulesets protect main and release tags.

### Report format (end of every work unit, in French for Matteo)
1. What changed, point by point. 2. Evidence: commands + outputs. 3. Audit findings disproved,
with proof. 4. Reviewer findings: fixed / rejected + why. 5. Open items. 6. Walkthrough per
changed module — what it does, why this design, how it is verified, how it breaks — written
for someone who pilots agents well but did not hand-write the code. 7. Five comprehension
questions Matteo must answer before merging (expected answers folded at the end).
