# ADR 0004 — The approved estimate is a spending cap

- Status: accepted
- Date: 2026-11-03

## Context

`analyze --ai`, `test --live` and `scripts/linter-eval.ts` call a paid API. Each
prints an estimate and asks for approval first, but an estimate alone does not
stop a run that costs more than what was approved: a longer input, a chain that
carries a long output, or a bug that loops.

## Decision

- **The approved estimate is the cap.** `BudgetedClient` (`src/testing/budget.ts`)
  wraps the client of every paid run. Before each call it reserves that call's
  estimated worst case (input at characters ÷ 3, the whole `max_tokens` of
  output); a call that would take spent plus reserved past the cap is not sent
  and fails with `BudgetExceededError`, a configuration error (exit 3). After the
  call it charges the usage the provider reports; a failed call stays charged
  at its worst case.
- **The estimate must bound what the cap measures**, or a run that behaves as
  estimated is refused. `src/testing/cost.ts` counts every call a chain makes and
  every placeholder at the longest value it can insert; tests run chains through
  the generated code with the cap set to the estimate.
- **What it does not guarantee** is stated where the cap is described
  (`docs/CLAIMS.md`): text that tokenizes at under 3 characters per token costs
  more than estimated, so the spend can pass the cap by what the calls in flight
  cost beyond their estimate; the next call is then refused.

## Rejected

- **Counting tokens with the provider before each call.** Exact input counts,
  but one more network call per request, with its own failures and latency, to
  refine the cheap side of the bill: output at `max_tokens` dominates.
- **A margin above the approved amount.** The approval names an amount; a cap
  above it spends what nobody approved.
- **A cap on the generated runtime.** Inside a user's application the budget is
  the application's; PromptLang caps only the runs it starts itself.

## Consequences

A run can be refused before it reaches what it would really have spent, since
every call reserves its worst case. The estimate is conservative by design
(characters ÷ 3, every call at `max_tokens`), so the approved amount is larger
than what a run usually costs; `docs/SLO.md` tracks the measured cost per call.
