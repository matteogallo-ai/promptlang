# ADR 0001 — SemVer comparison is implemented in-house

- Status: accepted
- Date: 2026-11-02

## Context

`@version` must be validated as SemVer 2.0.0, and `import ... requires "<range>"`
must check an imported file's version against a range. That needs three operations:
parse a version, order two versions, and test a version against a range.

The two options were the `semver` npm package (the reference implementation used
by npm) or a module in this repository.

## Decision

`src/semver/semver.ts` implements the three operations, about 175 lines including
comments, with no dependency.

## Why

- **The zero-third-party-runtime-dependency claim is tested.** `docs/CLAIMS.md`
  lists "No third-party runtime dependencies" as shipped, pinned by
  `tests/v1-stability.test.ts`. Adding `semver` would retract a claim for a small
  amount of code.
- **The needed surface is small and fully specified.** Version parsing uses the
  regular expression published with the SemVer 2.0.0 specification; precedence
  follows section 11 of the specification; the range operators are a deliberate
  subset (exact, `^`, `~`, `>`, `>=`, `<`, `<=`, space-separated AND).
- **Ranges are a subset on purpose.** `||`, partial versions (`^1.2`), `x`
  wildcards and hyphen ranges are rejected with an error naming the unsupported
  part, instead of being accepted with semantics we would have to document and test.

## Consequences

- We own the correctness. `src/semver/semver.test.ts` covers the specification's
  precedence example, invalid versions (leading zeros, missing parts, empty
  identifiers, numbers above 2^53 - 1: npm's `semver` rejects them in MAJOR.MINOR.PATCH;
  this module also rejects them in numeric pre-release identifiers, which npm keeps
  as strings, so that every accepted version compares exactly), every operator and the pre-release rule (a pre-release only
  satisfies a range that names a pre-release of the same version, as npm does).
- If users need the operators we do not support, switching to `semver` stays
  cheap: the module exposes `parseVersion`, `compareVersions`, `parseRange` and
  `satisfies`, and callers do not depend on the internal comparator shape.

## Rejected

- **`semver` as a dependency**: correct and complete, but it breaks a tested claim,
  and it brings far more range syntax than we document.
- **Accepting full npm range syntax by hand**: more to test and document for no
  current user need.
