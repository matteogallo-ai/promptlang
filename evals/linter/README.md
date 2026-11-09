# AI linter eval corpus

A frozen, labeled set of `.prompt` files with known defects, used by
`scripts/linter-eval.ts` to measure the AI linter's precision and recall.

## What is in it

- `scripts/linter-eval-corpus.ts`: the bases, the defect snippets and the rules
  that build every file below. Review the corpus there.
- `labels.json`: version, the six categories the linter reports
  (`src/analyzer/ai/prompts/analysis-prompt.ts`), and one entry per case: its file,
  split, base task and designed defects.
- `cases/`: 120 files, one prompt each.
- `SHA256SUMS`: the hash of `labels.json` and of every case. `tests/linter-eval.test.ts` fails if a
  case or a label changes without it, or if the files differ from what the script
  builds, and every run records the hash of this file, so a result names the exact
  corpus it was measured on.

## How the cases were built

30 base tasks (invoice extraction, ticket classification, meeting details…), each
written once as a clean prompt: concrete criteria, a JSON-only format line naming
the keys of the declared `struct`, a missing value left out (every field is
optional, so `null` would contradict the type), a boolean field false unless
shown true, and the input delimited as data. Each base also appears with exactly one
designed defect, in three different categories. The categories rotate across
bases so none is tied to one kind of task: each appears 15 times in all, 7 or 8
times per split.

| Category | How the defect is introduced |
| -------- | ---------------------------- |
| `VAGUE_INSTRUCTIONS` | the concrete criterion is replaced by a vague sentence ("Make sure everything looks right.") |
| `MISSING_FORMAT_SPEC` | the JSON format line is removed; the output stays a `struct` |
| `CONFLICTING_INSTRUCTIONS` | a sentence contradicts the JSON-only format line ("Respond in YAML…") |
| `UNDEFINED_TERMS` | a business term is used and never defined ("tier-2 partners") |
| `POTENTIAL_HALLUCINATION_RISK` | the "leave its key out" rule becomes "infer the most likely value" |
| `TOKEN_INEFFICIENCY` | a redundant, repetitive paragraph is inserted |

Each of the 15 snippets per category is different. Splits are by base task, so a
base and its variants are never on both sides: `dev` holds bases 0–14, `test`
bases 15–29. Each split has 45 defective cases and 15 clean ones. A snippet adds
one defect only: an undefined term changes which values are kept, for any field, and
padding does not repeat the vague phrases the linter is asked to find.

## How the results are scored

`scripts/linter-eval-metrics.ts`, over (case, category) pairs: a category the
linter reports on a case is a true positive if it is the designed defect and a
false positive otherwise; a designed defect it does not report is a false
negative. Precision, recall, per-category rates and the share of clean cases with
any issue are reported with k, n and a 95% Wilson interval. A case whose call
failed has no verdict and is listed, not scored. Each case runs twice, and the
difference between the two runs is the noise band.

## Limits

- The labels are the defects that were designed in. A clean case can have a real
  weakness nobody designed, which counts here as a false positive.
- The cases are templated: the same author wrote the bases, the snippets and the
  linter's prompt. The set measures whether the linter finds these defects in
  this form, not its quality on prompts written by others.
- One defect per case: interactions between defects are not measured.
- 7 or 8 cases per category per split: a per-category interval is wide
  (4 of 8 is 22%–78%), so per-category figures separate only large differences.
- The `dev` split exists for tuning the linter prompt; the figures that describe
  the linter are the `test` split's.

## Changing the corpus

Edit `scripts/linter-eval-corpus.ts`, bump its `VERSION`, and run
`bun run scripts/linter-eval-corpus.ts --write`, which rewrites `cases/`,
`labels.json` and `SHA256SUMS`. A change to any case or label is a new corpus:
compare results only between runs with the same corpus hash.
