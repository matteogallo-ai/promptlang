# Contributing to PromptLang

Thank you for your interest in contributing. Contributions of all kinds are welcome,
from fixing typos in docs to implementing compiler stages. Every change follows
[`docs/ENGINEERING_STANDARDS.md`](docs/ENGINEERING_STANDARDS.md).

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [Adding a Feature](#adding-a-feature)
- [Reporting a Bug](#reporting-a-bug)
- [Commit Style](#commit-style)
- [Pull Request Checklist](#pull-request-checklist)

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.1.0
- Git >= 2.30

### Local setup

```bash
git clone https://github.com/matteogallo-ai/promptlang.git
cd promptlang
bun install
```

### Checks (all run in CI)

```bash
bun run typecheck              # tsc --noEmit, root and packages/yaml-parser
bun test                       # every test, root and packages
bun run lint                   # Biome lint + format check (bun run lint:fix to apply)
bun run knip                   # dead code, unused exports and dependencies
bun run check:claims           # docs/CLAIMS.md vs README, runs each claim's test
bun run check:stale-narrative  # no "coming in vX", sprint IDs or untracked TODOs
bun run bench                  # regenerates the numbers in docs/benchmarks.md
```

Run the CLI from the repository with `bun run cli <command>` (for example
`bun run cli compile docs/examples/classify-ticket.prompt --out ./generated`).

---

## Project Structure

```
src/
  index.ts          # Public entry point of @promptlang/core
  lexer/            # .prompt text → tokens
  parser/           # tokens → AST (recursive descent; grammar.md)
  ast/              # AST node types and printer
  registry/         # import resolution, manifest.json, integrity.json
  compiler/         # TypeScript code generator (+ chain compiler)
    python/         # Python code generator and runtime template
  analyzer/         # static rules (rules/) and the AI linter (ai/)
  runtime/          # PromptClient, provider clients, error hierarchy
  config/           # promptlang.yaml loading and validation
  cli/              # promptlang CLI (commands/)

packages/
  yaml-parser/      # @promptlang/yaml-parser, published separately

scripts/            # CI checks: check-claims.ts, check-stale-narrative.ts
benchmarks/         # bench.ts, the source of docs/benchmarks.md
tests/              # cross-module tests and test helpers (support/)
docs/               # reference docs, CLAIMS.md, ENGINEERING_STANDARDS.md, examples/
```

Each module follows a colocated test pattern: `foo.ts` is tested by `foo.test.ts`
in the same directory.

---

## Coding Standards

### TypeScript

- **Strict mode is non-negotiable.** The `tsconfig.json` enables all strict flags.
  Never use `any` — use `unknown` and narrow explicitly.
- Split a module when it mixes unrelated responsibilities. (`parser.ts` and `lexer.ts`
  are single large files on purpose: one recursive-descent class each.)
- Exported functions and types carry a JSDoc comment saying what they do and why.
- Use named exports, not default exports (improves refactoring tooling).

### Naming

| Concept         | Convention     | Example               |
| --------------- | -------------- | --------------------- |
| Files           | kebab-case     | `token-kind.ts`       |
| Classes         | PascalCase     | `PromptDeclaration`   |
| Functions       | camelCase      | `parseExpression()`   |
| Constants       | UPPER_SNAKE    | `MAX_NESTING_DEPTH`   |
| Enum members    | PascalCase     | `TokenKind.Identifier`|

### Comments

Write comments only when the **why** is non-obvious. Code should be self-documenting
through clear naming. Do not write comments that restate what the code does.

### Dependencies

Adding a dependency requires a written justification in `docs/architecture.md`
under the "Dependencies" section. The bar is high: PromptLang intentionally keeps
its dependency tree minimal to stay auditable and fast to install.

---

## Adding a Feature

1. **Check the roadmap** — `docs/roadmap.md` lists what is in progress.
2. **Open an issue first** for anything non-trivial. Describe the problem you're
   solving, not the implementation. Wait for a maintainer to confirm direction
   before investing significant effort.
3. **Branch naming**: `feat/<short-description>` for features, `fix/<short-description>`
   for bug fixes, `docs/<short-description>` for documentation.
4. **Write tests** colocated with the implementation. Aim for behavior tests
   (input → output), not implementation tests.
5. **Update docs** if you add or change syntax, CLI flags, or public APIs. A new
   README capability needs a row in `docs/CLAIMS.md` with a passing test.

---

## Reporting a Bug

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:

- PromptLang version (`bun run cli version`)
- Bun version (`bun --version`)
- Operating system
- The `.prompt` file or minimal reproduction
- Expected vs actual output

For security vulnerabilities, see [SECURITY.md](SECURITY.md).

---

## Commit Style

PromptLang uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types:**

| Type       | When to use                                      |
| ---------- | ------------------------------------------------ |
| `feat`     | New user-facing feature                          |
| `fix`      | Bug fix                                          |
| `docs`     | Documentation only                               |
| `refactor` | Code change with no behavior change              |
| `test`     | Adding or fixing tests                           |
| `chore`    | Build scripts, CI, dependency updates            |
| `perf`     | Performance improvement                          |

**Examples:**

```
feat(lexer): add support for multiline string tokens
fix(parser): handle EOF inside block comment
docs(roadmap): describe chain parallelism status
chore: update bun to 1.3.14
```

Breaking changes are marked with `!` after the type: `feat(ast)!: rename NodeKind`.
CI (`commits` job) rejects commit subjects that do not follow this format. Keep each
commit to one logical change and about 400 changed lines at most (lockfiles and
generated files excluded).

---

## Pull Request Checklist

The [pull request template](.github/pull_request_template.md) holds the checklist.
Fill it in completely, including the walkthrough and the "What was AI-generated
and what I changed" section.
