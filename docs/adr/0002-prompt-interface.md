# ADR 0002 — What counts as a prompt's interface

- Status: accepted, amended 2026-11-03 (declared type names)
- Date: 2026-11-02

## Context

`semver-check` must decide, for each change to a `.prompt` file, whether it breaks
consumers (major), extends them compatibly (minor) or only changes behaviour behind
the same contract (patch). The project decision is that the interface is the
parameters (names, types, optionality), the output schema and the target model.

## Decision

`src/semver/interface.ts` builds, for each prompt and chain, a canonical form:

- **Parameters** keyed by name, each with its rendered type and its optionality.
  Order is ignored: generated functions take one named `input` object.
- **Output type** with named types replaced by their structure, enum values sorted
  and struct fields keyed by name. `type Category = enum { a, b }` and
  `type Kind = enum { b, a }` are the same output.
- **Target model**: the file's `@model`, attached to each prompt (chains have no
  model of their own).
- **Declared type names** (amendment): the generated TypeScript and Python export
  every `type` under its name, so consumers import it. A declared type removed or
  renamed is major, one added is minor. A changed type is reported on the prompts
  and chains that use it; a changed type that none uses is major on its own.
- **Body**, not interface: a prompt's sections, a chain's steps and return
  expression, compared without source positions; plus `@temperature` and
  `@max_tokens`. Any difference is patch.

## Why these levels

- **Any output change is major except adding an optional struct field.** The output
  type is read by consumers *and* is what the model is asked to produce. Adding an
  enum value looks compatible, but a consumer with an exhaustive `switch` breaks;
  removing one looks compatible for consumers, but callers relying on that value
  break. Treating both as major is conservative and easy to explain. A struct
  field becoming optional is major for the same reason (consumers read it).
- **A model change is major.** Same parameters and schema do not mean the same
  behaviour; the project decision says so explicitly.
- **Making a required parameter optional is minor**: existing calls still type-check.
- **Prompt replaced by a chain of the same name is major**: the function signature
  can be identical, but the model contract no longer applies.

## Consequences

- Some changes that are compatible in practice (a new enum value nobody switches on)
  require a major bump. The cost is a version number; the alternative is a
  consumer's build or runtime breaking under a `^` range.
- `output:` sections are not read by the code generators, so changing one is patch.
- Types the file references but does not declare (imported types) are compared by
  name only.

## Amendment 2026-11-03

The first version compared types by structure only, so renaming `Category` to
`Kind` read as no interface change and a patch release passed, while every
consumer importing `Category` failed to build (audit F1, finding C6). Prompt
contracts are still compared by structure; the names are compared separately
because they are a second, backend-independent surface: both code generators
export them.

## Rejected

- **Comparing generated TypeScript signatures.** It couples the check to one
  backend, and loses the model, which is not in the signature.
- **Enum additions as minor.** Matches some API-versioning guides, but breaks
  exhaustive consumers silently under `^` ranges.
