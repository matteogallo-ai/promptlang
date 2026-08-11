# Contributing to PromptLang

Thank you for your interest in contributing. PromptLang is in early alpha — contributions
of all kinds are welcome, from fixing typos in docs to implementing core compiler stages.

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
bun test
```

If `bun test` reports no test files found, that is expected for v0.1 — the test
infrastructure is in place but tests are added incrementally starting from v0.2.

---

## Project Structure

```
src/
  index.ts          # Public entry point and re-exports
  cli/              # Command-line interface (v0.2+)
  lexer/            # Tokenizer: .prompt text → token stream (v0.2)
  parser/           # Recursive-descent parser: tokens → CST (v0.2)
  ast/              # AST node definitions and visitor pattern (v0.2)
  compiler/
    typescript/     # TS code generator (v0.3)
    python/         # Python code generator (v0.8)
  linter/           # Static analysis and AI-powered linter (v0.7)
  runtime/          # Runtime helpers for compiled output (v0.5+)

docs/
  architecture.md   # Technical design document
  syntax-reference.md
  roadmap.md
  examples/         # Annotated .prompt files

tests/              # Integration and end-to-end tests
benchmarks/         # Performance benchmarks
```

Each module follows a colocated test pattern: `foo.ts` is tested by `foo.test.ts`
in the same directory.

---

## Coding Standards

### TypeScript

- **Strict mode is non-negotiable.** The `tsconfig.json` enables all strict flags.
  Never use `any` — use `unknown` and narrow explicitly.
- Files are kept under 300 lines. Split into sub-modules when approaching that limit.
- All exported functions and types must have JSDoc with `@param` and `@returns`.
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

1. **Check the roadmap** — `docs/roadmap.md` lists upcoming milestones. Features
   that fit a milestone are more likely to be merged quickly.
2. **Open an issue first** for anything non-trivial. Describe the problem you're
   solving, not the implementation. Wait for a maintainer to confirm direction
   before investing significant effort.
3. **Branch naming**: `feat/<short-description>` for features, `fix/<short-description>`
   for bug fixes, `docs/<short-description>` for documentation.
4. **Write tests** colocated with the implementation. Aim for behavior tests
   (input → output), not implementation tests.
5. **Update docs** if you add or change syntax, CLI flags, or public APIs.

---

## Reporting a Bug

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:

- PromptLang version (`bun run promptlang --version`)
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
docs(roadmap): add v0.5 chain milestone details
chore: update bun to 1.2.0
```

Breaking changes are marked with `!` after the type: `feat(ast)!: rename NodeKind`.

---

## Pull Request Checklist

Before submitting:

- [ ] `bun install` runs without errors
- [ ] `bun test` passes (or new tests added for the change)
- [ ] No `any` types introduced
- [ ] JSDoc added for all new exported symbols
- [ ] `docs/` updated if syntax or public API changed
- [ ] Commit messages follow Conventional Commits
- [ ] PR description explains *why*, not just *what*
- [ ] `CHANGELOG.md` entry added under `[Unreleased]`
