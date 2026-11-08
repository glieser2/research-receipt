# ResearchReceipt — contribution draft (not submitted)

**Do not submit this draft without separate explicit user instruction.** Public Bradbury Phase 2 (`chainId = 4221`) 51-case business E2E validation (`v6-wallet-4`, contract `0x10d41bf2e9b54440ced622171ceff191754bcf73`, deployed source `contracts/research_receipt_v6_compact_v3.py`, SHA-256 `5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf`, canonical source `contracts/research_receipt_v6_r2_candidate.py`, SHA-256 `ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f`) has now completed all `51 / 51` prelocked cases with `FINALIZED + accepted + MAJORITY_AGREE` consensus and verified final-state readbacks ([v6-wallet-4 public evidence](evidence/bradbury-v6-wallet-4-e2e.json)). All historical attempts and failures ([v5 evidence](evidence/bradbury-v5-attempt.json), [typed evidence](evidence/typed-probe-simulations.json), [structured evidence](evidence/structured-probe-simulations.json), [v6-wallet-2 deployment revert](evidence/v6-wallet-2-deployment-revert.json), and [v6-wallet-3 46/51 attempt halted at Case #47](evidence/bradbury-v6-wallet-3-attempt.json)) remain preserved in full.

Preparation material for a Projects submission. The website is public by explicit user authorization; anonymous HTTP access returned 200 without credentials or redirects. The sanitized source archive (`ResearchReceipt-reviewed-source.zip`) and site bundle (`research-receipt-site.tar.gz`) are audited and prepared for publication to `https://github.com/glieser2/research-receipt` and `https://glieser2.github.io/research-receipt/`. **No Portal contribution form has been submitted yet, and no review decision or points award is claimed.**

## Name and one-line description

**ResearchReceipt**

- **English (Default)**: A GenLayer research delivery workbench that locks buyer criteria, commit-pinned GitHub sources, and four-field unknown disclosures for verifiable consensus receipts.

Suggested primary category: `AI & Agents` or `Dispute Resolution`. Choose secondary themes only from the form's actual options when submission is authorized.

## User problem and value

A buyer commissions a DeFi research report covering administrator privileges, withdrawal constraints, audit coverage and evidence limits. A polished report can still contain an unsupported permission claim, cite a different version or overstate the source's scope. Buyer and author need agreed acceptance criteria and a specific correction list rather than an unexplained overall AI score.

ResearchReceipt locks the criteria, date context, author and permitted repositories before submission. The author commits public report text, per-criterion statements and commit-pinned source fingerprints. Reviewers inspect findings, source checks, the complete revision history and an exported receipt.

The v6 (`research-receipt/6`) policy locks whether each criterion requires established facts (`fact_required`) or permits a structured four-field unknown disclosure (`unknown_disclosure`: `target_aspect`, `examined_sources`, `unverified_reason`, `risk_boundary` from the locked field catalog). Evidence classification and the code-derived delivery result remain separate, making a fulfilled unknown disclosure distinguishable from a proven fact. Full criterion coverage is still required; an irrelevant true detail or a generic disclaimer cannot replace the requested analysis.

V6 accepts structured claims: the report body must exactly equal those rendered statements joined by one newline in locked-criterion order, with no free-form extra paragraphs. Each prompt receives only its own claim, criterion and selected snapshot sources. Titles and external report links are not accepted report content. Source verification and semantic assessment are separate explicit transactions: `verify_evidence` independently fetches and locks raw GitHub bytes into an immutable one-shot snapshot first; `evaluate` then judges that bound snapshot with zero source HTTP. Authors cannot supply their own verified snapshot.

The claimed benefit is a clearer, reproducible research-delivery workflow. Willingness to pay, retention and time saved remain product hypotheses. No customer adoption figures or performance improvements are asserted.

## Why GenLayer is central

The frontend collects inputs and prepares evidence hashes but does not choose the live verdict. The Intelligent Contract owns locked rules, source-integrity checks, per-criterion judgments, acceptance policy and shared order state.

In `verify_evidence`, the contract retrieves committed raw GitHub sources and verifies exact raw-byte SHA-256 digests and byte lengths into an immutable snapshot. In `evaluate`, leader and validators judge the bound snapshot with zero HTTP and classify each criterion's evidence (`SUPPORTED`, `CONTRADICTED`, `BOUNDARY_DISCLOSED`, `NOT_ESTABLISHED`; failed snapshot sources become code-only `SOURCE_UNAVAILABLE`). Code computes `delivery_status` (`FULFILLED`, `INSUFFICIENT`, `CONTRADICTED`, `UNSUPPORTED`) and the aggregate verdict (`ACCEPTED`, `REVISION_REQUIRED`, `NOT_ACCEPTED`, `INSUFFICIENT_EVIDENCE`). Validators compare evidence status, derived delivery, basis/references and source checks; free-text reasons may differ. Contradictions and bad sources cannot be overridden by an unknown allowance, and malformed output cannot silently become support.

This is a neutral acceptance decision between counterparties. It does not call a private frontend model and merely store that model's answer. Deterministic checks remain deterministic; GenLayer supplies evidence-based semantic judgment and a shared result.

## Scope and adjacent projects

The focus is versioned **research commissions**: source time/scope, supported claims, evidence boundaries and revision acceptance. It is not a generic statistics checker, code-correctness proof, audit certificate or token recommendation engine. Broader truth and the report outside locked claims are not certified.

Compare its actual research workflow and evidence/version behavior with MetricProof, Build Gate and general deliverable-acceptance projects. Do not claim global novelty.

## Implementation and verified environment

- React/TypeScript frontend, wallet integration, transaction recovery, version history and JSON receipt export.
- GenLayer Python v0.3 contract with author/evaluator permissions, mandatory buyer-approved repository roots, bounded public inputs and full-history structural content-replay checks.
- SDK `genlayer-js@2.0.0-rc.2`; runner `py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0`.
- Actual deployment in **Studio-dev hosted development simulation** at `https://studio-dev.genlayer.com/api`, reported chain ID `61997`.
- Contract: `0xa73d09fE5f065ECa8d05b3371cDC5E91213319f1`.
- Deployment ID: `0xc00b0bf48ee9933373956fab6cec14660403d89ecb7b2b7656ec845741399291`.
- Deployed source SHA-256: `3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3`.

Deployment finalized successfully and state was read back. Actual development-model assessment rejected order 1's incorrect statement and accepted its corrected revision. Order 2's wrong digest produced `HASH_MISMATCH` and `INSUFFICIENT_EVIDENCE`; replay failed without adding a revision. Wrong-author submission and duplicate evaluation also rolled back. Browser order 3 completed UI creation, digest retrieval, submission, evaluation and final readback with `ACCEPTED` and four `SUPPORTED` findings. The [read-only final-state E2E record](evidence/studio-e2e.json) preserves these bounded development results; detailed scope and transaction IDs are in [validation](validation.md).

Observed Studio-dev receipts have null block hash/number. Those development IDs are not public-chain evidence. A **separate public Bradbury Phase 2 deployment** has now completed and passed independent read-only deployment verification:

| Public test-chain evidence | Value |
| --- | --- |
| Chain ID / contract | `4221` / `0x503b620680306533D43D57a859aB308eE9a9F7e1` |
| Protocol transaction ID | `0x165cf7c5ec1034706c2b69495f362f814cee7feb91b3e2c95cc64561b4c5161b` |
| Envelope transaction hash | `0xdbc727485a33a3ae57cef89e1b90491f28c2954de0f3e0df044a064e9c0e6bf1` |
| Block / block hash | `216419` / `0x85f3766e9ad9b9dfc316282f6065ae8800a7c9446020a0465b6fd91edf356500` |
| Deployed source SHA-256 | `3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3` |

This is the historical v1 [independent deployment proof](evidence/bradbury-deployment-independent.json), not the current candidate's proof. V2 separately deployed at
`0xEE2F34aF1ef90938341a95B466769C92A96E61A8`, source
`cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745`;
its [independent proof](evidence/bradbury-v2-deployment-independent.json) is also
deployment-only. V1/v2 public assessments encountered undetermined/model
disagreement, so public business E2E is incomplete. Historical outcomes retain
their original policy meaning. This is a public **test chain**, not mainnet,
production or external security certification. A quoted deposit is not consumed
fees or a complete cost cap.

Historical undeployed v3 source is frozen at SHA-256
`19d6cd9a6ac04328f50236922fad9985aead47b3db215ca847dd854e216d241e`,
policy `research-receipt/3`. Its 11-case validation plan
is prelocked. The first real negative pair failed semantic validation: both
models marked an incorrect permissions claim `SUPPORTED`, with another criterion
also disagreeing. Source/fixture fingerprints matched and no schema/I/O/repair
error was observed; root cause remains unproved. The remaining two planned pairs
were stopped. This presents a possible false-acceptance risk and prevents claims
of v3 safety, stability or completed model validation. That failure remains in the
[public simulation record](evidence/public-semantic-simulations.json).

V4 source SHA-256 is
`f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61`.
Its negative, positive and strict-unknown cases each passed one bounded read-only
leader/validator pair: 6 `gen_call`, 24 `exec_prompt`, no signed chain transaction.
This does not prove accuracy rates, stability or the root cause of v3's failure.
V4 is separately deployed at `0x4e95cB64A0AD4fb443B0304dA850162BbEF7d973`;
[independent deployment proof](evidence/bradbury-v4-deployment-independent.json)
checks finality, successful execution, source/sender/receipt/block and numeric order
count 0. Its actual committee business assessment later failed, despite a leader
result matching the negative oracle. An early timeout and third-party appeal with
changed effective budget were observed, but do not prove the private-validator
failure cause, SDK error or insufficient 600 TU allocation. The original failure
and partial 18-case history remain retained.

Separate [source-only](evidence/source-only-probe-independent.json) and
[fixed-inline four-task](evidence/inline-source-probe-independent.json) deployments
passed independent complete-receipt checks. Inline recorded three RETURN votes and
one NONDET_DISAGREE, not unanimity. These diagnostics isolate different paths;
they are not business cases or proof that the historical cause is resolved.

Current v6 (`v6-wallet-4`, policy `research-receipt/6`) deployed source (`contracts/research_receipt_v6_compact_v3.py`) SHA-256 is
`5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf` (`36,128` bytes), AST/non-docstring-constant/runner equivalent to canonical source `contracts/research_receipt_v6_r2_candidate.py` (`ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f`, `50,227` bytes).
Deployed by the user's self-controlled wallet `0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd` at contract `0x10d41bf2e9b54440ced622171ceff191754bcf73` (protocol transaction `0x1a7dd2f1a54e56108c4d0170a213ffd495184bb6c7d0a37bfb68409d976ecbb5`, EVM envelope `0xa84743e494bbe47affbc8d739fd15860ee605a8e05a46016b07d118865c1328a`, block `242922`).
Under the [51-case prelocked plan](evidence/v6-wallet-4-validation-plan.json), all `51 / 51` cases (`40 RETURN` + `11 ERROR`, `9` orders, `10` snapshot/assessment projections) finalized with `accepted` (`MAJORITY_AGREE`) consensus and passed full readback verification in [bradbury-v6-wallet-4-e2e.json](evidence/bradbury-v6-wallet-4-e2e.json) (`status: "COLLECTED"`, `ready: true`, `retainedHistory: 33`).
Earlier `v6-wallet-2` (`0xfa5156...` gas revert) and `v6-wallet-3` (`0xc7d9a5...`, halted at Case `#47` `0x39b4178d...` after `46/51` passed) are preserved in [v6-wallet-2-deployment-revert.json](evidence/v6-wallet-2-deployment-revert.json) and [bradbury-v6-wallet-3-attempt.json](evidence/bradbury-v6-wallet-3-attempt.json).

Historical v5 source SHA-256:
`60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65`.
The [independent v5 deployment proof](evidence/bradbury-v5-deployment-independent.json)
binds contract `0xF21F4c3e49963a093F7e5b4De414f43E503f09B5`, protocol transaction
`0x0211015cf386239dadbcb41dec60e8dc1a265cf73f27c705afa4ce396dc7518a`,
envelope `0x8407880d9dd488c448189da11f77e3913f3c00d079ea3e8341b3165b64649fe5`,
block `217521` and its verified zero-order baseline. Its [24-case v5 plan](evidence/v5-validation-plan.json) stopped after positive evaluation disagreement ([bradbury-v5-attempt.json](evidence/bradbury-v5-attempt.json)).

Current local verification includes **134 Vitest, 92 Node and 350 Python unit tests**, plus production build (`tsc -b && vite build`). Python stubs and SDK mocks remain distinct from real execution. The Studio deployment helper uses
only a new in-memory account and the official simulation faucet; it does not read
`RR_PRIVATE_KEY` or access a user wallet. Rerunning it deploys new source and changes
configuration; acknowledgement and appropriate authorization remain required.

## Reviewer reproduction

Use a new order for writable review; only its author may submit, and only owner/author may assess. Accepted existing orders are read-only historical examples.

1. Open the app and inspect its explicit environment label. The no-wallet Northstar walkthrough is a fictional deterministic example, separate from live mode.
2. Select the intended environment and policy version explicitly: Studio-dev (`chainId = 61997`, contract `0xa73d09fE5f065ECa8d05b3371cDC5E91213319f1`) is a hosted development simulator running historical policy `research-receipt/1`, while public Bradbury Phase 2 (`chainId = 4221`, contract `0x10d41bf2e9b54440ced622171ceff191754bcf73`) runs `v6-wallet-4` (`policy research-receipt/6`, `51 / 51` cases finalized). Read-only inspection requires no wallet; for new writes, intentionally select the exact `v6` contract with a dedicated funded test wallet. A reviewer may be both owner and author; the app never needs the private key.
3. Lock each criterion's `evidence_requirement` explicitly under policy `research-receipt/6`. Use root `raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/` and state that the research concerns a pinned source module. Choose `fact_required` for facts that must be established and `unknown_disclosure` only when a structured four-field disclosure (`target_aspect`, `examined_sources`, `unverified_reason`, `risk_boundary` from the locked field catalog `research-receipt/field-catalog/1`) is acceptable. Enter each criterion's claim; the body is its read-only ordered aggregate, not independent report prose.
4. Prepare both fixed public files using the app or evidence script:

   `https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/3e6c86392c97fbc30d3d20a378a6f58beba08eba/contracts/access/Ownable.sol`

   Recorded fixture raw-byte SHA-256: `38578bd71c0a909840e67202db527cc6b4e6b437e0f39f0c909da32c1e30cb81`; length: `3102` bytes. Re-fetch and verify instead of blindly trusting this draft.
   Also use `https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/3e6c86392c97fbc30d3d20a378a6f58beba08eba/contracts/utils/Context.sol`, hash `9c1cc43aa4a2bde5c7dea0d4830cd42c54813ff883e55c8d8f12e6189bf7f10a`, `860` bytes. These fixtures concern default source implementations, excluding derived overrides and actual deployed instances.
5. Submit bound statements distinguishing source permissions from unknown withdrawal/audit/deployment facts. First `verify_evidence`, wait for finality, successful execution and freshly validated snapshot; then separately sign `evaluate` and inspect its final assessment. The UI rechecks wallet state and preserves uncertain pending writes. Assessment must reference the exact snapshot hash/checks; source HTTP happens only in verification.
6. In a separate negative order, claim that anyone can call the restricted ownership-transfer function without being owner. The intended outcome is a source-grounded contradiction; record the actual model result rather than assuming it.
7. In a separate missing-evidence order, alter the expected digest while keeping the URL fixed. Expected result: `INSUFFICIENT_EVIDENCE`, without positive support from the changed source. Record final result/readback.
8. Each revision gets one snapshot, including failed source checks. Transient unavailability cannot be re-fetched for identical content: assess with affected claims ineligible first, then genuinely correct evidence/research in a new bounded revision if not accepted. Inspect both versions/snapshots and export the receipt. Title/version-only changes, equivalent ordering and earlier-content replay are rejected; meaningless edits are not an approved workaround.

This is a review protocol, not a promise that every run agrees. Undetermined consensus, source failures, execution errors and pending outcomes must remain visible.

## Submission checklist

- [x] Actual contract, frontend and repository documentation exist locally.
- [x] Current 134 Vitest, 92 Node and 350 Python unit checks, plus production build, are documented with limits; experimental/isolation probe checks are kept separate from production model-accuracy claims.
- [x] Development deployment identity, source hash and finalized successful receipt are retained.
- [x] Negative-to-corrected-positive development assessment is observed.
- [x] Wrong-actor and duplicate-assessment development failures are observed.
- [x] Record final missing-digest, duplicate-content rejection and full browser E2E results; distinguish nonadjacent replay's local regression coverage from the live duplicate-content case.
- [x] Public reviewer website authorized and anonymous HTTP access verified.
- [x] Audited local source archive (`ResearchReceipt-reviewed-source.zip`) and site bundle (`research-receipt-site.tar.gz`) prepared for public GitHub (`https://github.com/glieser2/research-receipt`) and website release; verify HTTP 200 on all target URLs immediately upon publication.
- [x] Public Bradbury Phase 2 deployment independently verified with source, finality, execution and block evidence.
- [x] Complete and record public Bradbury business E2E (`v6-wallet-4`, `51 / 51` prelocked cases passed in `docs/evidence/bradbury-v6-wallet-4-e2e.json`).
- [ ] Establish the root cause or assess residual risk of the preserved v3 semantic failure; its remaining pairs were stopped and its 11-case plan remains incomplete. A separate reviewed v4/v6 does not retroactively pass this item.
- [x] Separately reviewed v4 structure, three one-attempt semantic pairs and independent deployment/zero baseline are recorded; these do not establish general safety.
- [x] V4 committee failure, the two auxiliary full-receipt diagnostics, independently deployed v5 zero baseline (`docs/evidence/bradbury-v5-attempt.json`), `v6-wallet-2` gas revert (`docs/evidence/v6-wallet-2-deployment-revert.json`), and `v6-wallet-3` 46/51 halted run (`docs/evidence/bradbury-v6-wallet-3-attempt.json`) are separately recorded.
- [x] Complete the 51-case `v6-wallet-4` signed suite (`0x10d41bf2e9b54440ced622171ceff191754bcf73`) and independent collector checks (`docs/evidence/bradbury-v6-wallet-4-e2e.json`), including 9 orders, 10 snapshots/assessments, 11 stored `UserError` proofs, Case `#47` `evaluateOptionalOmitted`, and Cases `#48..#51` six-criterion flow.
- [ ] Provide measured worst-case fees, accessible demo video and concise repeatable steps.
- [ ] Obtain genuine user feedback and retain failures/corrections alongside successes.
- [ ] Fill/submit the Portal contribution form **only** when separately instructed by the user.

## Known limits and remaining work

The source policy accepts public UTF-8 raw GitHub files pinned to a full commit, not private research, paywalled datasets or arbitrary web pages. Hashes fix bytes, not authority or truth. Repository roots require buyer judgment. Source-size checks happen after receipt; underlying redirects/DNS belong to the GenVM service.

Consensus can be wrong or undetermined. Results cover locked criteria and associated statements, not every sentence or an investment thesis. The product does not prove deployed bytecode provenance, formal correctness, security or future returns.

Structural fingerprints do not detect every semantic paraphrase. Successful revision counts do not count reverted/undetermined attempts. Public-chain worst-case fees, broad adversarial robustness and long-running behavior remain unverified. No 4000-point outcome or official approval is promised.

Next steps: publish the audited source archive to `https://github.com/glieser2/research-receipt`, sync the bilingual production bundle to `https://research-receipt-lab.milkyhoop.chatgpt.site/`, verify anonymous HTTP 200 across all target URLs, and fill the Portal contribution draft for user human-verification and final submission. **No contribution form has been submitted by this document.**
