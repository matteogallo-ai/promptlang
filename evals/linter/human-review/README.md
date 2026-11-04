# Human review of the corpus labels

The labels in `../labels.json` are set by construction: they are the defects the
generator (`scripts/linter-eval-corpus.ts`) put in. This review checks them by
hand on a sample, so a wrong label or a defect nobody designed is found by a
person rather than assumed away.

- `review.csv`: 60 claims about 30 cases (6 clean, 4 per category, seeded draw).
  Each case gets its designed claim ("has defect X", or "has none of the six")
  and a decoy naming a category that was not designed in, in shuffled order.
  The annotator sees the claim, the prompt without its label comment, and the
  linter's six definitions; never the case id or the label.
- `key.json`: the answer key. **Do not open it before annotating.**

## Annotate

With the annotation tool of [verity](https://github.com/matteogallo-ai/verity)
(`scripts/annotate.py`), which reads this CSV as it is (same columns), from a
verity clone:

```bash
uv run python scripts/annotate.py <path to this repo>/evals/linter/human-review/review.csv
```

`s` supported (the prompt has what the claim says), `u` unsupported, `c` comment
(say why when you reject a designed claim or accept a decoy), `b` back, `q` quit.
Every answer is saved at once; a new session resumes at the first unanswered claim.

## Score

```bash
bun run scripts/linter-eval-review.ts score
```

- `designed_confirmed`: designed claims marked supported, the share of labels
  that hold.
- `decoys_rejected`: decoys marked unsupported, the share of cases without a
  defect nobody designed.
- `kappa`: Cohen's kappa between the annotator and the construction.

Each rate comes with k, n and a Wilson 95% interval; `disagreements` lists every
claim answered against the key, with its comment. Commit the annotated CSV; a
disagreement is fixed in the generator, which makes a new corpus version.

## Result

Annotated by the maintainer in one pass, 60 of 60 claims, with no comment
recorded. Scored from `review.csv` as committed; `tests/linter-eval-review.test.ts`
("the committed human review scores …") re-derives every figure below.

| Measure | Result | Wilson 95% CI |
| ------- | ------ | ------------- |
| Designed claims confirmed (labels that hold) | 27/30 (90%) | 74.4%–96.5% |
| Decoys rejected (cases without an undesigned defect) | 27/30 (90%) | 74.4%–96.5% |
| Cohen's kappa, annotator vs construction | 0.80 | |

The six disagreements stay as answered. The second look below was made after
scoring, by reading each prompt against the six definitions; it changes no answer
and no score.

| Item | Case | Claim | Answer | Second look |
| ---- | ---- | ----- | ------ | ----------- |
| r24 | b26-conflicting-instructions | designed: CONFLICTING_INSTRUCTIONS | unsupported | The label holds: "Prefix the answer with the word RESULT and a colon" contradicts "Return only a JSON object … and no other text". |
| r40 | b20-token-inefficiency | decoy: POTENTIAL_HALLUCINATION_RISK | supported | No instruction invites a guess; the prompt says "If a value does not appear in the payslip, leave its key out". Probably an annotator error. |
| r41 | b04-potential-hallucination-risk | decoy: CONFLICTING_INSTRUCTIONS | supported | Probably a real defect nobody designed: "estimate a plausible value when the review does not state it" contradicts "A boolean field is false unless the review shows it is true" and "the star rating … stated in the review". |
| r54 | b04-undefined-terms | designed: UNDEFINED_TERMS | unsupported | The label holds: "Trust values from a strategic vendor over the rest" leaves "strategic vendor" undefined. |
| r55 | b28-clean | designed: none of the six | unsupported | Probably an annotator error: the prompt follows the template of the five clean cases whose claim was confirmed, its decoy (r35, MISSING_FORMAT_SPEC) was rejected, and no comment names a defect. |
| r59 | b13-potential-hallucination-risk | decoy: CONFLICTING_INSTRUCTIONS | supported | Probably a real defect nobody designed, the same collision as r41: "use the most common value for this kind of document" contradicts "A boolean field is false unless the event announcement shows it is true". |

What follows from it:

- **A generator collision.** r41 and r59 have one cause: the hallucination variant
  adds an instruction to fill every missing value, and the base task already says
  a boolean is false unless the text shows it is true. 7 of the 15 hallucination
  cases carry both (dev: b01, b04, b08, b11, b13; test: b25, b27), so a linter that
  reports CONFLICTING_INSTRUCTIONS on them is scored as wrong when it may be
  right. The measured run (`runs/live/linter-eval-2026-11-03T08-39-28-817Z.json`)
  reports it on all seven, in both repeats. Were the two test cases scored right,
  test precision would read 46/217 and 47/229 instead of 44/217 and 45/229; that
  is a reading, not a measure, since nobody judged b25 or b27.
  `tests/linter-eval-review.test.ts` ("the generator collision behind r41 and
  r59 …") finds the seven cases in the corpus files and rescores the run. The fix
  belongs in `scripts/linter-eval-corpus.ts` and makes a new corpus version,
  which needs a new paid run; neither is done.
- **Not a precision measure.** Each case's decoy is one category drawn at random,
  not a category the linter reported, so the review says how often an
  undesigned defect is present (3 decoys of 30 accepted, Wilson 95% CI
  3.5%–25.6%), not how many of the linter's findings are right. Precision on
  the test split stays a lower bound.

## Limits

One annotator, 30 of 120 cases: at 30/30 the lower bound of the interval is about
89%, so a small share of wrong labels can still go unseen. The decoy covers one
other category per case, not all five. The review is blind by discipline only:
`key.json` and `../labels.json` sit in the same repository, since scoring reads
the key and the corpus is versioned with its labels.
