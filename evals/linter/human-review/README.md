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

With verity's annotation tool, which reads this CSV as it is (same columns):

```bash
cd ~/dev/verity && uv run python scripts/annotate.py ~/dev/promptlang/evals/linter/human-review/review.csv
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

## Limits

One annotator, 30 of 120 cases: at 30/30 the lower bound of the interval is about
89%, so a small share of wrong labels can still go unseen. The decoy covers one
other category per case, not all five.
