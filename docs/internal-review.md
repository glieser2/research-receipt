# Internal review — 2026-11-05

This is an implementation review with a separate reviewing agent, not an external security certification.

## Current public-chain verification status

Latest candidate work is recorded in [the v6 staged review](v6-staged-review.md), [the unchanged 51-case plan](evidence/v6-validation-plan.json) and [read-only transport observations](evidence/v6-transport-observations.json). V6 is not deployed: both official RPC routes rejected default gas estimation after matching Phase 2 identity checks. A deployment-only fresh signer and bounded-gas proof are being reviewed separately; no new public release is implied.

**Bradbury acceptance remains incomplete.** The staged v5 release (source `60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65`, address `0xF21F4c3e49963a093F7e5b4De414f43E503f09B5`) was actually deployed. Its negative assessment passed complete per-finding and snapshot verification. Its corrected revision's source snapshot also matched the prelocked complete snapshot, but evaluation `0x016b18b61ec9f10c24299d5245c96778666b6a4e6c32a6382fb1dcc33ab41ba0` finalized `MAJORITY_DISAGREE` / undetermined. No further business cases or repeat evaluation were sent after that failure.

The public leader output marked the accurate absence-of-audit disclosure `CONTRADICTED` because no audit report was supplied, and marked the research boundary `NOT_ESTABLISHED` because it was not a substantive object-world fact. These are observable task interpretation problems. Four stored votes were `NONDET_DISAGREE` and one was `TIMEOUT`; neither their private classifications nor the timeout cause are known. This does not establish a source-fetch or resource root cause. Full failed transaction data and public leader extraction remain in the local artifacts.

An isolated typed-review diagnostic was implemented and independently reviewed, with buyer-locked verification kinds and author claim types. It distinguishes factual support, accurate scoped unknown disclosure, and boundary disclosure; `BOUNDARY_DISCLOSED` is not factual support. Unknown-disclosure review considers every verified material in the revision, including material omitted from the author's selected references. This is a new schema and explicit scope, not a reclassification of the failed v5 oracle.

Frozen typed source `db275c89e769e158e93db9632a2f0a61f5284e7d0048a064be372196293b77f3` passed its first three real public-node simulation pairs (positive, negative, false caution omitting the answering source). Its fourth pair, `unknownWithPromise`, failed: the leader rejected the unsupported instant-exit promise, while the validator classified that same disclosure as valid and produced `ACCEPTED`. The strict comparison returned false, so this execution did not establish acceptance. Both sides made four model calls and zero repairs. The fifth pair and both committee deployments were stopped, as prelocked; the eight gen_call attempts and complete public projections are retained in `evidence/typed-probe-simulations.json`. No typed diagnostic was deployed, and its expected oracle was not relaxed. This is a new observed semantic safety failure, not a reason to resample until agreement.

The diagnostic has not established public committee acceptance or application E2E. The production source, v5 fixture and frozen plan remain unchanged, and the public site's default deployment remains unchanged. A structural design that prevents author-written promises from being presented as an unknown disclosure was subsequently reviewed and tested separately, as recorded below.

The subsequent structured-disclosure experiment (`97ed1f7e6cbd42b42a84a35a6cb4491613022468c8d06cd518e9ff9a7f51ba4b`) passed three pairs and then failed its fourth leader oracle: the unsupported promise was rejected as `CONTRADICTED` with references `[0,1]`, while the prelocked outcome was `NOT_ESTABLISHED` with no support references. The validator and fifth case did not run, and no committee deployment was sent. This is an incorrect rejection category under that policy, not a false acceptance or evidence of a two-sided disagreement. All seven unsigned calls remain in `evidence/structured-probe-simulations.json`.

An independent review recommends a new, explicit evidence-sufficiency policy for factual/boundary tasks: `ESTABLISHED` only for complete, adequately grounded fulfillment; all other cases `NOT_ESTABLISHED`. This deliberately gives up consensus classification of refutation versus missing proof. A new `basis_scope_source_indices` records the author's declared combined materials, not model-selected support citations. The structured unknown-field branch remains unchanged. A separate sufficiency candidate is being implemented; no old failed oracle is relaxed and no production or publication readiness is asserted.

The frozen sufficiency probe (`b931e3b582ad96e934a985ca1d21a955ce3e2ea910eae2e3918e2c7896f290de`) subsequently passed all five prelocked public-node leader/validator pairs using the exact same structured input bytes (`73703b4f60883ae6c51eeca9dd42a4dc945e97d020d88e6616af10679982b0d9`). Ten unsigned calls matched complete nine-field findings, field outcomes, source hashes and strict comparison. See `evidence/sufficiency-probe-simulations.json`. This is bounded model evidence, not a real committee deployment or business E2E.

The first actual deployment request then failed at the L2 envelope layer: `eth_estimateGas` reverted, SDK 2rc2 fell back to 200,000 gas, and `eth_sendRawTransaction` returned `intrinsic gas too low`. No protocol ID was returned; fresh latest/pending nonces both remained 33, matching the immutable pre-send intent, and the signer history contained no new sufficiency deployment. The frozen source plus constructor serializes to 48,988 bytes; the ordinary-EVM calldata lower bound already exceeds that fallback. This explains the insufficient fallback but does not identify the original estimate revert. No deployment was resubmitted. A distinct read-only EVM diagnostic is investigating that original error without exporting the temporary private key, changing source or increasing gas.

### Earlier attempts retained

The earlier Studio review below is historical. Bradbury funding has arrived. Version 2 source SHA-256 `cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745` is deployed at `0xEE2F34aF1ef90938341a95B466769C92A96E61A8`; deployment inclusion, source identity, accepted consensus and initial final-state readback were independently verified in `evidence/bradbury-v2-deployment-independent.json`.

Public end-to-end acceptance is **not complete**. The original v2 negative assessment succeeded, but its corrected assessment finalized with majority disagreement. A new, pre-reviewed scope-controlled fixture supplemented Context and excluded derived overrides; its negative assessment `0x2b00f80e8046baf05ccfd8861ff9ef75bb4c6d05454882d39a2a78f99bfb4c19` also finalized with `MAJORITY_DISAGREE`, and final-state assessment `(2, 1)` remains empty. No success is inferred from `FINALIZED` or `FINISHED_WITH_RETURN` alone.

Architecture review identified a semantic ambiguity requiring resolution: `SUPPORTED` currently combines factual support with fulfillment through an allowed unknown disclosure, while permission to use an unknown is interpreted from prose. Exact per-criterion reference selection is also part of consensus. These are design concerns, **not proven private-validator root causes**. Failed attempts and frozen versions remain preserved. The public application must not switch its default deployment or claim completed Bradbury E2E until the replacement policy is reviewed and the required public cases actually pass.

The subsequent, undeployed v3 candidate (`19d6cd9a6ac04328f50236922fad9985aead47b3db215ca847dd854e216d241e`) failed its first real public-node simulation pair. Both independent executions marked the deliberately false permissions statement `SUPPORTED`; their limitations classifications also differed. The input fingerprints, source bytes and structured outputs were verified. This is an observed semantic safety failure, not merely a finality or SDK problem. The other two planned simulation pairs were stopped. Source, frozen plan, fixture and failed evidence remain preserved; the source is archived as `contracts/archive/research_receipt_v3_candidate_19d6.py`. A new v4 candidate restricts the acceptance object to a canonical structured report and isolates per-criterion tasks; it must not be called usable until the unchanged false-statement oracle passes actual validation.

Historical Studio review contract SHA-256: `3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3`.

## Findings and evidence

- No additional blocking contract defect was identified within the reviewed scope. Existing deployed source does not need to change for the UI clarifications below.
- Leader and validator independently fetch evidence, check bytes/hash and assess the locked criteria. Schema, citations, source checks and stable conclusions are compared; explanatory wording is not compared verbatim.
- Retrieval failure, invalid model structures, missing citations and validator disagreement fail closed. Only locked authors may submit; only the buyer or author may evaluate. Completed assessments and bounded revision history are preserved.
- All saved order/spec/submission/assessment hash links in `evidence/studio-e2e.json` were independently recomputed and matched. Its 9 checks and 13 finalized transactions concern the hosted Studio simulator; their null block fields cannot establish public-chain inclusion.
- Source-scoped criteria and strict protocol research criteria remain separate and immutable per order. The Ownable examples exercise source-scoped criteria, allowing explicit unknowns outside the submitted module. They do not establish complete protocol risk coverage.

## Clarifications applied

| Issue | Treatment |
| --- | --- |
| A fixed commit/hash does not prove that evidence existed at a historical date | Creation, detail and record views identify dates as the commissioner's self-declared reference date; source dates are also self-declared |
| Leader explanation text is not independently compared word-for-word | Findings label it as a model explanation; tooltip distinguishes structured conclusions from wording |
| Studio finality is not public-chain inclusion | UI, deployment metadata and evidence distinguish hosted development from Bradbury |
| Protocol transaction ID differs from EVM envelope hash | Public-chain verifier resolves exact protocol events to successful EVM receipts and checks sender, submitted source hash and final state |
| Wallet changes networks during asynchronous preparation | Sending/signing boundary rechecks chain ID, Phase 2 genesis and account |
| Broadcast succeeds but SDK receipt lookup fails | Persist intent first, immediately retain returned hash, then recover a known Bradbury envelope through its receipt and protocol event; Studio hashes remain protocol IDs |
| A trailing RPC slash bypasses existing pending state | Normalize keys and migrate legacy records without overwriting conflicts |
| An external SDK fails before it asks the provider to send | Clear only this route's own intent when the controlled provider proves the sending boundary was never entered |

Final local validation: 54 Vitest, 9 Node and 31 explicitly stubbed Python tests passed; production build passed. The separate reviewer also executed all 35 live/Bradbury frontend tests. These include real calls to the captured provider wrapper in failure fixtures, not just a successful mocked SDK return.

Implementation and review used the environment's Sol implementation and Astra review roles; the primary agent integrated and ran final checks. This L4 review concerns contract and transaction correctness. It does not establish an external human audit or production certification.

## Remaining limits

Hashes establish content integrity, not publisher authority, safety, historical existence or truth. Prompt instructions and current tests do not prove resistance to every prompt injection. Replay checks cover structural canonicalization and a five-revision bound, not semantic equivalence. Multiple real Bradbury deployments and some accepted business transactions are verified, but the complete public E2E suite remains incomplete because positive evaluation failed committee consensus. Broader adversarial trials, real-user validation and an external production audit remain future work.

If a wallet has actually been asked to send but returns no hash, or a local signer has an unknown raw-send outcome, the app retains the uncertain record for manual verification. It does not silently assume that nothing was broadcast.
