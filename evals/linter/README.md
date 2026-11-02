# AI linter eval corpus

A frozen, labelled set of `.prompt` files with known defects, used by
`scripts/linter-eval.ts` to measure the AI linter's precision and recall.

## What is in it

- `labels.json`: version, the six categories the linter reports
  (`src/analyzer/ai/prompts/analysis-prompt.ts`), and one entry per case: its file,
  split, base task and designed defects.
- `cases/`: 120 files, one prompt each.
- `SHA256SUMS`: the hash of every file above. `tests/linter-eval.test.ts` fails if a
  case or a label changes without it, and every run records the hash of this file,
  so a result names the exact corpus it was measured on.

## How the cases were built

30 base tasks (invoice extraction, ticket classification, meeting details…), each
written once as a clean prompt: concrete criteria, a JSON-only format line naming
the keys of the declared `struct`, `null` for missing values, and the input
delimited as data. Each base also appears with exactly one designed defect, in
three different categories, 15 times per category in all:

| Category | How the defect is introduced |
| -------- | ---------------------------- |
| `VAGUE_INSTRUCTIONS` | the concrete criterion is replaced by a vague sentence ("Make sure everything looks right.") |
| `MISSING_FORMAT_SPEC` | the JSON format line is removed; the output stays a `struct` |
| `CONFLICTING_INSTRUCTIONS` | a sentence contradicts the JSON-only format line ("Respond in YAML…") |
| `UNDEFINED_TERMS` | a business term is used and never defined ("tier-2 partners") |
| `POTENTIAL_HALLUCINATION_RISK` | the "set it to null" rule becomes "infer the most likely value" |
| `TOKEN_INEFFICIENCY` | a redundant, repetitive paragraph is inserted |

Each of the 15 snippets per category is different. Splits are by base task, so a
base and its variants are never on both sides: `dev` holds bases 0–14, `test`
bases 15–29. Each split has 45 defective cases and 15 clean ones.

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
- The `dev` split exists for tuning the linter prompt; the figures that describe
  the linter are the `test` split's.

## Changing the corpus

A change to any case or label is a new corpus: bump `version` in `labels.json`,
regenerate `SHA256SUMS` (`shasum -a 256 labels.json cases/*.prompt > SHA256SUMS`),
and compare results only between runs with the same corpus hash.
