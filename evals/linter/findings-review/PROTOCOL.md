# Human review of the AI linter's findings: pre-registered protocol

The scored precision (`docs/SYSTEM_CARD.md`) counts every category nobody
designed into a case as a false positive, so it is a lower bound. This review
asks a person, for a random sample of the linter's own findings, whether the
prompt has the defect the linter reported. The share confirmed is the precision.

This file, `review.csv` (unanswered) and `key.json` are committed before any
answer; the commit that first added them is the pre-registration, and git history
is what shows it came first. `tests/linter-findings-review.test.ts` makes a redraw
visible: "the sample is the one pre-registered: seed 20261104 and its SHA-256
digests" pins the seed and the digests of the key and of the unanswered sheet,
and "the committed sheet and key are exactly what build writes, while
unannotated" ties the committed files to the code, so changing the sample means
changing those constants in a reviewed diff.

## Population

Every category the linter reported on the **test split, repeat 1** of
`runs/live/linter-eval-2026-11-03T08-39-28-817Z.json`: 217 findings, of which the
construction scores 44 right (the published 20.3%). Repeat 2 is not sampled.

## Sample

- 40 findings, stratified by reported category, allocated in proportion to each
  category's share of the 217 and rounded by largest remainder:
  VAGUE_INSTRUCTIONS 9 (of 49), MISSING_FORMAT_SPEC 4 (of 23),
  CONFLICTING_INSTRUCTIONS 7 (of 36), UNDEFINED_TERMS 8 (of 43),
  POTENTIAL_HALLUCINATION_RISK 9 (of 50), TOKEN_INEFFICIENCY 3 (of 16).
- Within a category, a simple random draw without replacement; seed `20261104`
  (mulberry32, `scripts/linter-eval-review.ts`); the 40 items are then shuffled.
- Drawn by `bun run scripts/linter-findings-review.ts build`.

## What the annotator sees

Per item: the claim "This prompt has the defect X: <definition>", the prompt
without its label comment, and the linter's six definitions. Not shown: the case
id, the designed defect, whether the construction scored the finding right, and
the linter's own explanation. The same prompt can come back with another
category: 40 findings fall on 31 prompts.

## Answer

`s` supported: the prompt has the defect as the definition states it. `u`
unsupported: it does not. When unsure, answer and say why in a comment (`c`).
Answers are not changed after `score` has been run; a second look goes in a note
beside the score, as for the label review (`../human-review/README.md`).

## Analysis

`bun run scripts/linter-findings-review.ts score`, computed by
`scoreFindings` as committed with this file:

- **Headline:** precision = supported / answered, with a Wilson 95% interval,
  read as a measure only when all 40 are answered (`complete`); a partial sheet
  gives the number answered and no reading.
  The allocation is proportional, so the sample is self-weighting up to rounding;
  `precision_weighted`, each category weighted by its share of the 217, is
  reported beside it as a check.
- Per category: supported / answered with a Wilson interval, descriptive only
  (3 to 9 items each).
- Against the construction, on the same 40: the scored precision, the findings
  scored wrong that the annotator supported, and the findings scored right that
  the annotator rejected.
- **Reading, fixed before any answer:** the precision is above the published lower bound
  only when the whole interval lies above the population's scored precision,
  44/217 (`above_scored_lower_bound`); otherwise the review does not tell them
  apart.
- A repeated or missing row, an item not in the key, or a verdict other than
  supported or unsupported stops `score` with an error.

## Limits

- One annotator, 40 findings: at 8/40 the interval runs from about 10% to 35%,
  so this tells a lower bound of 20% from a precision near 50%, not 20% from 25%.
- The 40 findings fall on 31 prompts, so they are not independent: the Wilson
  interval treats them as if they were and is somewhat too narrow.
- The corpus builds each prompt from a base task, and the sample holds several
  variants of the same base. Comparing them can show the sentence a variant
  added, and so its designed defect. Judge each item on its own text.
- The annotator knows every item is a linter finding, which can pull answers
  toward agreement or toward suspicion; there are no control items.
- 22 of the 30 cases of the label review are on the test split, so some prompts
  have been read before.
- The review is blind by discipline only: `key.json` sits in the same folder.
  **Do not open it before annotating.**
