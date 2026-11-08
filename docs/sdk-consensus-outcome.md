# Consensus-outcome integration regression — local report draft

This document has not been submitted to an upstream issue tracker.

Observed on public Bradbury Phase 2, 2026-11-05, with `genlayer-js@2.0.0-rc.2`.

## Reproduction evidence

ResearchReceipt evaluation protocol transaction:

`0x9fa815aa73a7bac515811960bd9368e25958d5b43ae20f63d86b59cc05eeca3e`

The public transaction reached these simultaneous values:

```json
{
  "statusName": "FINALIZED",
  "txExecutionResultName": "FINISHED_WITH_RETURN",
  "result": 5,
  "resultName": "NO_MAJORITY",
  "lifecycle": { "state": "finalized", "outcome": "undetermined" }
}
```

The last round revealed all four votes: two `FINISHED_WITH_RETURN` and two `NONDET_DISAGREE`. A final-state read of `get_assessment(1, 1)` returned an empty string, and the order remained `SUBMITTED` with one revision. The leader's return therefore did not establish a committed application assessment.

For comparison, the successful deployment transaction `0x165cf7c5ec1034706c2b69495f362f814cee7feb91b3e2c95cc64561b4c5161b` had `result:1`, `resultName:MAJORITY_AGREE`, and lifecycle outcome `accepted`, in addition to `FINALIZED` and `FINISHED_WITH_RETURN`.

## Integration requirement

Do not classify public-chain state changes as successful using only `FINALIZED` and an execution return. Require an accepted protocol-consensus outcome, successful execution, and the intended final-state readback. Keep envelope inclusion, consensus, execution and application state as separate evidence fields.

A finalized undetermined transaction is not a successful assessment. It must not trigger an automatic retry. Releasing a pending lock requires a matching operation and a successful final-state read showing that the requested record was not written; missing data caused by an RPC error is not such evidence.

The nondeterministic disagreement's deeper cause was not established by the vote totals alone. Semantic judgment, retrieval and output-format differences must be investigated separately; this report does not attribute the split to a specific private validator model.
