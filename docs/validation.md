# Validation record

**Latest checkpoint (2026-11-08 Asia/Shanghai) overrides earlier “incomplete” wording:** Policy `research-receipt/6` (`v6-wallet-4`, deployed source `contracts/research_receipt_v6_compact_v3.py`, SHA-256 `5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf`, canonical source `contracts/research_receipt_v6_r2_candidate.py`, SHA-256 `ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f`) is deployed on public Bradbury Phase 2 (`chainId = 4221`) at `0x10d41bf2e9b54440ced622171ceff191754bcf73` by the user's self-controlled wallet `0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd` and has passed **all `51 / 51` prelocked business cases** (`40` `FINISHED_WITH_RETURN` + `11` `FINISHED_WITH_ERROR`, all `FINALIZED + accepted + MAJORITY_AGREE`). Read-only public evidence collection is complete in [bradbury-v6-wallet-4-e2e.json](evidence/bradbury-v6-wallet-4-e2e.json) (`status: "COLLECTED"`, `ready: true`, `allRequiredCasesPassed: true`, `firstGatePassed: true`, `latestFinalVerified: true`, `orders: 9`, `retainedHistory: 33`). All earlier historical failures ([v5 attempts](evidence/bradbury-v5-attempt.json), [typed simulations](evidence/typed-probe-simulations.json), [structured simulations](evidence/structured-probe-simulations.json), [v6-wallet-2 deployment revert](evidence/v6-wallet-2-deployment-revert.json), and [v6-wallet-3 46/51 attempt halted at Case #47](evidence/bradbury-v6-wallet-3-attempt.json)) remain preserved in full without retrospective relabeling.

Date: 2026-11-08 (Asia/Shanghai).

This record separates local tests, actual hosted development execution, browser integration and public-chain deployment. An unchecked item is not implied by a checked item.

## Local checks completed

- TypeScript compile and Vite production build (`tsc -b && vite build`).
- Current snapshot: **134 Vitest tests, 92 Node tests, 350 Python unit tests**, and production build passed. This covers frontend/transaction boundaries, bilingual (`EN` default / `ZH` toggle with zero CJK ideographs or fullwidth punctuation in English UI dictionaries, demo templates, and localized order projections across all 9 Bradbury orders and 3 Studio-dev orders in `src/lib/i18n.test.ts`), staged snapshot validation, pending recovery, `v6` field catalog & unknown-disclosure constraints, `compact` / `compact_v2` / `compact_v3` AST equivalence proofs, user-wallet execution guards, and `v6-wallet-4` collector bookkeeping (including verification of the collected 51-case `docs/evidence/bradbury-v6-wallet-4-e2e.json` artifact and all 33 historical transactions). No collector RPC is invoked during offline test runs.
- Full Python discovery passed 350 tests across `v1`–`v6`, `v6_r2_candidate`, `compact_v3`, wallet migration plans, and diagnostic probe stubs. Experimental/isolation probe tests remain separate from production model-accuracy evidence.
- Browser walkthrough: initial fictional report flags a withdrawal contradiction; revised report passes the local fixture; both versions remain visible.
- Read-only official RPC checks: Studionet returned chain ID 61999; Studio-dev returned 61997 and an enabled fee configuration. Studionet did not expose the v2 fee configuration method at this observation.

Python stub tests are not a simulation of real consensus. TypeScript transaction tests mock the SDK and do not prove wallet/network integration. Browser fixture results are local deterministic examples, not AI verdicts.

Final browser transport checks include broadcast/receipt failure, known-envelope recovery, Studio protocol-hash recovery, same-ID old-genesis refusal at the sending boundary, legacy pending-key migration and failures proven to occur before an external provider was asked to send. See [internal review](internal-review.md). An actual browser read against Bradbury passed the identity/CORS path and correctly rejected the Studio-only address as nonexistent; it did not send a public-chain transaction.

The historical v3 UI positive/negative template pair was compared structurally with
the frozen fixture (ignoring JSON key order), with matching results. At a 390 px
mobile viewport, observed layout/content width was 375 px without horizontal
overflow. Actual UI readback shows unknown allowance only for withdrawals/audit;
other template criteria retain the default strict requirement. These are browser
and input-consistency checks, not semantic-model validation.

## Hosted development execution completed

The user explicitly authorized source upload and isolated tests at `https://studio-dev.genlayer.com/api` using independent temporary development accounts. No user wallet/private key or real funds were used.

| Identity | Observed value |
| --- | --- |
| Environment | Official hosted Studio-dev development simulation |
| Chain ID reported by endpoint | `61997` |
| Contract | `0xa73d09fE5f065ECa8d05b3371cDC5E91213319f1` |
| Deployment transaction | `0xc00b0bf48ee9933373956fab6cec14660403d89ecb7b2b7656ec845741399291` |
| Deployment source SHA-256 | `3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3` |
| Python metadata | `# v0.3.0`, `py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0` |
| Deployment outcome | `FINALIZED`, successful execution, deployed state read back |
| Public block evidence | `blockHash: null`, `blockNumber: null` in observed development receipts |

This establishes actual requests to the hosted development GenVM and model services. It does **not** establish public L2 inclusion, public validator independence, persistent public-chain deployment or production readiness.

| Scenario | Confirmed result / remaining scope |
| --- | --- |
| Order 1, initial incorrect statement | Actual assessment `NOT_ACCEPTED` |
| Order 1, corrected revision | Actual assessment `ACCEPTED`; earlier revision remains in history |
| Owner attempts submission reserved to the locked author | `FINALIZED` / `FINISHED_WITH_ERROR`, rollback `Only the locked author may submit a revision` |
| Repeated evaluation of an assessed revision | Development transaction fails/rolls back without overwriting assessment |
| Order 2, deliberately incorrect source digest | `FINALIZED` / `FINISHED_WITH_RETURN`; final readback `INSUFFICIENT_EVIDENCE`, source check `HASH_MISMATCH` |
| Already-submitted content replay | `FINALIZED` / `FINISHED_WITH_ERROR`, rollback `Research content already appeared...`; order 2 `revision_count` remains 1. Nonadjacent A→B→A and structural reordering are additionally covered by local tests, not separate live cases |
| Browser-driven order 3 positive flow | UI create → source/digest retrieval → author submit → evaluate → finalized state readback completed; `ACCEPTED` and all four findings `SUPPORTED` |

The [sanitized E2E evidence](evidence/studio-e2e.json), collected with read-only `LATEST_FINAL` reads (see its `collectedAt` timestamp), records 9 checks as true and preserves the final orders/revisions/assessments. Full local request/receipt artifacts under `artifacts/live/` remain Git-ignored; browser screenshot: `artifacts/live-workspace.jpg`. Neither is a public blockchain explorer. `src/deployment.json` now separately records deployment verification and `e2eVerified:true` for this hosted development environment.

| Final check | Development transaction ID |
| --- | --- |
| Hash-mismatch evaluation | `0xd8d5a0bd8c0cb45b089101cb82e3d2c9e97532813e9bdc0ebcc52f0ce37cdfd9` |
| Content-replay rollback | `0xd382a6c57e0efc2f0559ed9b65a699cd84e5d3a55aa566f0a5c40a8c10e204de` |
| Browser order 3 evaluation | `0x69a3cbfa6db2cb0cfe30c3ce4651568a51ac86db70b1e1fc0f83305a575115c8` |

The Studio deployment helper now always generates a fresh in-memory account and uses only the official Studio-dev simulation faucet after confirming chain identity. It does not read `RR_PRIVATE_KEY` or use a user wallet. `RR_DEPLOY_SOURCE_ACK=1` remains required for authorized source upload. Rerunning this helper creates a new deployment and updates configuration; it is not a status command or public-chain funding route.

## Historical public Bradbury deployments; business E2E incomplete

The user supplied 2 test GEN to the independent temporary test account. Public Bradbury Phase 2 deployment is now complete and independently verified by a separate read-only review. The [deployment proof](evidence/bradbury-deployment-independent.json), observed at `2026-11-05T03:53:12.262Z`, reports `fullyVerified:true` with **deployment-only scope**.

| Public deployment field | Independently checked value |
| --- | --- |
| Network | Bradbury Phase 2, chain `4221`, verified genesis/registry |
| Contract address | `0x503b620680306533D43D57a859aB308eE9a9F7e1` |
| Protocol transaction ID | `0x165cf7c5ec1034706c2b69495f362f814cee7feb91b3e2c95cc64561b4c5161b` |
| EVM envelope hash | `0xdbc727485a33a3ae57cef89e1b90491f28c2954de0f3e0df044a064e9c0e6bf1` |
| Inclusion block | `216419` |
| Inclusion block hash | `0x85f3766e9ad9b9dfc316282f6065ae8800a7c9446020a0465b6fd91edf356500` |
| Deployed source SHA-256 | `3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3` |
| Protocol/execution | `FINALIZED` / `FINISHED_WITH_RETURN` |

Source fingerprint, sender, operation, contract address, block evidence and finalized contract readback were independently checked. This establishes public **test-chain deployment**, not mainnet deployment, production readiness or external security certification.

V1 public order creation/readback completed, but its assessment attempts became
undetermined: one observed 2:2 no-majority return, and a later disagreement with
an invalid evidence-reference error. These records are retained rather than
counted as successful business evaluations.

V2 (`research-receipt/2`) was separately deployed and independently verified:

| V2 field | Verified value |
| --- | --- |
| Contract | `0xEE2F34aF1ef90938341a95B466769C92A96E61A8` |
| Source SHA-256 | `cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745` |
| Protocol transaction | `0x1923ca36b3db8874e03de50e728e3d2250b60eb5a30d67b792b2b1815ac2dd6c` |
| Envelope hash | `0xf8f1ab60a42b585a009ab2dde3793712ff681b99d41067a8c0426c00215abb2d` |
| Block / hash | `216652` / `0x50d3eb9b2fd8f233ef9410d8bac3725cd6580be4f448427a68628eba52d389ee` |

The [v2 proof](evidence/bradbury-v2-deployment-independent.json) has
`fullyVerified:true` with deployment-only scope. A v2 scope-negative assessment
also produced `MAJORITY_DISAGREE`; public business E2E remains incomplete. The
[public E2E record](evidence/bradbury-e2e.json) preserves observations and their
version-specific boundaries. V1/v2 outcomes are not relabeled under v3 semantics.

## V3 frozen candidate; first negative simulation failed

Policy `research-receipt/3` source SHA-256 is
`19d6cd9a6ac04328f50236922fad9985aead47b3db215ca847dd854e216d241e`.
Independent review approved this frozen candidate; there is no v3 deployment yet.
The [prelocked validation plan](evidence/v3-validation-plan.json) contains 11 cases
(fixture SHA-256 `f89ea1dfd5d963c792171a65eb03ed0f8925ead1a15be5a4b46501a85589002e`).
Only the first three pairs were planned for bounded public `gen_call` simulation.
The first real negative pair failed semantic validation: both independent models
labeled the negative report's permissions claim `SUPPORTED`, although the report
incorrectly asserted no `onlyOwner` restriction and no owner comparison. For
limitations, leader returned `NOT_ESTABLISHED` while validator returned
`SUPPORTED`. The actual source and fixture fingerprints matched the frozen
inputs; no schema, I/O or format-repair error was observed. These facts indicate
possible false acceptance, not merely a consensus-liveness problem. The root
cause has not been established. The remaining two planned pairs were stopped;
no full-plan completion, safety or reliability claim is justified.

The source, fixture, plan and failure observations are preserved unchanged.
This failure motivated a separately reviewed v4 structural change; its root cause
is not proven, and the original failure is not retrospectively reclassified.
Simulation execution is distinct from transaction finality, deployment proof and
an exhaustive model-accuracy evaluation.

Each v3 criterion explicitly locks `fact_required` or `scoped_unknown_allowed`.
That field is excluded from model prompts; models classify `SUPPORTED`,
`CONTRADICTED`, `SCOPED_UNKNOWN`, or `NOT_ESTABLISHED`. Missing/unverified sources
yield code-only `SOURCE_UNAVAILABLE`. Code maps evidence to delivery, permitting
scoped unknown only when the buyer allows it; contradiction/hash failure cannot
be overridden. Both support and scoped unknown require complete criterion
coverage. Policy-blinding, mapping and coverage tests verify input/control-flow
properties with scripted outputs, not that real models always follow them.

## V4 bounded simulation and deployment; public committee assessment failed

Policy `research-receipt/4`, source SHA-256
`f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61`,
passed independent review before the following bounded checks. Body text must now
exactly join bound statements in locked-criterion order; each model call excludes
the full body and other criteria/claims. `SUPPORTED` and requested-fact unknown
labels are explicitly mutually exclusive. This is a separate version, not a
reinterpretation of v3.

The [public semantic simulation record](evidence/public-semantic-simulations.json)
retains the failed v3 pair and three v4 cases. For v4 only, negative, positive and
strict-unknown each ran exactly once as a leader/validator pair, totaling 6 public
`gen_call` requests and 24 `exec_prompt` calls, with no signed chain transaction.
Each matched its prelocked expectation: respectively `NOT_ACCEPTED`, `ACCEPTED`
and `INSUFFICIENT_EVIDENCE`. These three observations are neither model-accuracy
statistics nor proof of repeatable stability or elimination of false acceptance.
The file's aggregate four pairs/8 requests/32 model calls includes the v3 failure;
do not count all four as successful v4 cases.

| V4 deployment field | Independently verified value |
| --- | --- |
| Contract | `0x4e95cB64A0AD4fb443B0304dA850162BbEF7d973` |
| Protocol transaction | `0x811fb897a3dc207b7a6b3e55f6c4b61c169aac0a555eaa93367a5db56bbe9a5c` |
| EVM envelope | `0x0a880e7227bf94c4a4737e5032f23ad383151385aad0ba8ecd52544406510685` |
| Block / hash | `217130` / `0x4b2c86b4f476e7295c837069e75436f1b1cd9fff56e69e6b219c1445c1d57bd2` |
| Protocol / execution | `FINALIZED`, accepted / `FINISHED_WITH_RETURN` |
| Final-state zero baseline | Numeric `get_order_count() == 0` |

The [v4 independent proof](evidence/bradbury-v4-deployment-independent.json) verifies
source, sender, operation, receipt/block and the zero-order baseline, with
`fullyVerified:true` for that scope only. The actual v4 business assessment failed
committee agreement, so its 18-case suite did not complete. Observed leader output
matched the negative oracle, while validator results included three nondeterministic
disagreements and one agreement. An earlier leader timeout and third-party
`topupAndAppeal` with changed effective budget were observed. These facts do not
establish why the private validator executions diverged, prove that 600 TU was
insufficient, or justify attributing the result to SDK encoding. Original receipts
and bytecode/inputs remain retained rather than relabeled as successful E2E.

## Separate on-chain isolation diagnostics

The [source-only proof](evidence/source-only-probe-independent.json) verifies
deployment `0xe02c2548d34facec52dfef7e619d47e802f0c260311b9dcdd7b86e4deee53cad`
at `0x7825b6e308152e6B980142A0Ba2c34B95b104A58`, source
`54e47ed1ebd4c92832723e242dc86acf5d665a0b46a1b0bdc1611ca5d5b47a5d`.
Its complete receipt contains both exact `VERIFIED` source hashes/lengths, with
five recorded initial-round RETURN votes and zero model work by design.

The [inline-source proof](evidence/inline-source-probe-independent.json) verifies
deployment `0xccbd92b3e0dc0787d2c528de8188b0c1ef0f4eebabfe24ec98a837be8c638ac2`
at `0xf8a4Ac4A0CdD72841513b536fed4690D14c18670`, source
`ded346ad9d6b8f454401074b95b246e25526075cc809122726165ecf8d2ad75c`.
`fullyVerified:true` and `fullReceiptMatch:true` bind the fixed constructor bytes,
complete four-criterion stable receipt, source fingerprint, sender, finality and
block/readback evidence. Its latest recorded votes were three RETURN and one
NONDET_DISAGREE, not unanimity. It performs no HTTP; the raw materials are checked
against the fixed Ownable/Context commitments before model work. These two
diagnostics have different execution paths/committees from v4 business evaluation
and do not prove the original cause or v5 production stability. They remain
auxiliary deployments, never substitute business cases.

## V5 staged candidate deployed; 24-case suite in progress

Frozen source SHA-256:
`60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65`,
policy `research-receipt/5`. Independent review covered the new transaction
boundary and client snapshot binding before deployment.

| V5 deployment field | Independently verified value |
| --- | --- |
| Contract | `0xF21F4c3e49963a093F7e5b4De414f43E503f09B5` |
| Protocol transaction | `0x0211015cf386239dadbcb41dec60e8dc1a265cf73f27c705afa4ce396dc7518a` |
| EVM envelope | `0x8407880d9dd488c448189da11f77e3913f3c00d079ea3e8341b3165b64649fe5` |
| Block / hash | `217521` / `0x2410fde08276be15d2053b68206181e614b5b282c9d9d4ff2bbf255a8e140bf6` |
| Finality / execution | `FINALIZED`, accepted / `FINISHED_WITH_RETURN` |
| Zero baseline | Numeric `get_order_count() == 0` |

The [v5 independent proof](evidence/bradbury-v5-deployment-independent.json) has
deployment/zero-baseline scope only. The [prelocked v5 plan](evidence/v5-validation-plan.json)
retains the prior criteria/claims/oracles, adds four exact snapshot hashes, and
defines 24 business cases: the previous 18 plus four verification transactions,
evaluation-before-evidence and duplicate-snapshot guards. Current execution has
begun with deployment/create/submission; no completed 24-case result is asserted.
The collector is adapted offline but has not been run against the completed suite.

V5 first independently web-verifies all committed sources into a one-shot snapshot,
then revalidates its complete binding and bytes in each model callback without
source HTTP. `snapshot_hash` and source checks must match the assessment. Failed
snapshot entries have null material and cannot be rescued by a model. Failure
snapshots are immutable too: transient HTTP unavailability keeps affected claims
ineligible. Complete the assessment before genuinely correcting evidence/research
in a new revision of a non-accepted order. Unused/optional source failures do not
override the unchanged required-criterion aggregate policy. Identical-content re-fetch and meaningless edits are not supported
recovery workflows. UI has two explicit operations, fresh wallet checks and stage
recovery; unresolved transactions remain locked rather than automatically retried.

The development fee metadata now says `bradbury-development` and includes
`verify_evidence`; numerical allocations remain 600/600 TU, per-round budget
`1e16`, APR 0 and SDK rotations `[3]`. The previous profile bytes are retained at
`tests/fixtures/fee-profile-v4-development.json`. These values are not a worst-case
certification or a promise of one committee. Raw artifacts remain local; sanitized
public evidence, reviewed frozen inputs, MIT fixtures/license and archives remain
available separately for reproducibility.
The collector separates required business-case success from acceptance of every
historical attempt: `allRequiredCasesPassed` and `allAttemptsConsensusAccepted`
are different fields. All 21 older business transactions and two auxiliary
deployments must remain declared and independently attributable; old undetermined
attempts are not counted as passed new cases. No final v5 collector result is
claimed before the suite finishes.

## Runtime investigation and resolution

Initial schema requests failed with `invalid_contract runner malformed` on GenVM `v0.3.0-rc10`. An official current-main Storage control using runner `9b8kjyda2ycxyq4ea6g4yfpnydxhd52gqba5rb8dw7krkh5mn9p0` also failed, including deployment. Earlier documentation/boilerplate used an older API and dependency. These failures were not treated as evidence that ResearchReceipt's Python business logic had executed.

The working `babwp9...` pin was then matched to official executor revision `536c58ffd517e1548db33807e81f5047b7c7e79e` in `runners/support/versions/current.nix`. A minimal Storage control succeeded with that pin. ResearchReceipt was migrated to its v0.3 API before the successful development deployment and executed scenarios above. The earlier runner failure is resolved for this pinned development configuration; it is not the current deployment status.

- [Pinned official runtime versions](https://github.com/genlayerlabs/genvm-executor/blob/536c58ffd517e1548db33807e81f5047b7c7e79e/runners/support/versions/current.nix)
- [Pinned custom-consensus API](https://github.com/genlayerlabs/genvm-executor/blob/536c58ffd517e1548db33807e81f5047b7c7e79e/runners/genlayer-py-std/src/genlayer/vm/__init__.py)
- [Current-main control source used in diagnosis](https://raw.githubusercontent.com/genlayerlabs/genlayer-studio/c94072951e483510329670aa427fba3fa6944f45/examples/contracts/storage.py)

## V6 (`research-receipt/6`) lineage and completed `v6-wallet-4` 51-case public E2E

Policy `research-receipt/6` combines factual/boundary evidence-sufficiency judgments with buyer-locked four-field unknown disclosures (`unknown_disclosure`), while retaining immutable one-shot `verify_evidence` source snapshots and zero-source-HTTP `evaluate` execution.

- **Superseded `v6-wallet-1` (`0xfdb942f537095d8e0c36b97a3b0324de81db9c3f`)**: Frozen in [v6-wallet-1-validation-plan.json](evidence/v6-wallet-1-validation-plan.json) (`04dbef08dc757f7457808d04f320b8cade446ca507596388e9f275e830753f77`), zero transactions sent after the user switched to `0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd`.
- **Reverted `v6-wallet-2` (`compact`, `43,437` bytes, `e053f1b4250b6a0e7717722c54dfe97717a5d341b374d9404d7b5b2c057e1fcb`)**: Deployment envelope `0xfa51562ff02e0e19346723c3ba2687654b2c4682d86d28104851c62b7db6ba23` (`nonce = 0`, block `233978`) reverted on L2 due to exhausting the `15,000,000` gas limit (`gasUsed = 15,000,000`), emitting `0` events and creating `0` protocol transactions. Preserved in [v6-wallet-2-deployment-revert.json](evidence/v6-wallet-2-deployment-revert.json).
- **Halted `v6-wallet-3` (`compact_v2`, `35,916` bytes, `2af33b26424a8bc2399d71cdb6a2ccdbd53acb0e4fc06de1ede14bb7791e42e2`)**: Deployed at `0xc7d9a5e9fa776f76b1348c7009ea23de6d873885` (`nonce = 1`, protocol tx `0xb779bee838ba50edfaeadab383a243f380f47bcabbe8a6c7fd2fcf6aca6bd97d`). Cases `#1..#46` (including the first-13 hard gate) passed `FINALIZED + accepted + MAJORITY_AGREE`, but Case `#47` (`evaluateOptionalOmitted`, `evaluate(8, 2)`, protocol tx `0x39b4178dff177c52a319270efafe9618d944606421c30210e53a38c0d52b80a9`, block `239660`) finalized as `undetermined / MAJORITY_DISAGREE` (1 validator `RETURN` matching leader + 3 validators `VM_ERROR` due to transient sub-VM prompt exception). Per the no-resampling rule, `v6-wallet-3` halted at `46 / 51` and is archived in [bradbury-v6-wallet-3-attempt.json](evidence/bradbury-v6-wallet-3-attempt.json).
- **Completed `v6-wallet-4` (`compact_v3`, `36,128` bytes, `5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf`)**: Canonical source `contracts/research_receipt_v6_r2_candidate.py` (`ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f`, `50,227` bytes) hardened `_prompt_json` (`max_attempts: int = 2`), `_run_nondet_json` (`try/except Exception` returning structured `{"ok": False, "error": ...}` inside the sub-VM), and validator fallback retry (`_validator_ok(1)` -> `_validator_ok(2)`). Under [v6-wallet-4-validation-plan.json](evidence/v6-wallet-4-validation-plan.json) (`e65905d24990f7f1bc0fd20ae8b172d57c3290f7ae531b9711077205a46839d0`), all `51 / 51` cases (`nonce = 49..99`) finalized with `accepted` (`MAJORITY_AGREE`) consensus:

| `v6-wallet-4` public field | Independently verified value |
| --- | --- |
| Network | Bradbury Phase 2 (`chainId = 4221`, genesis `0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4`) |
| Owner / Author wallet | `0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd` (`nonce = 49..99`) |
| Contract address | `0x10d41bf2e9b54440ced622171ceff191754bcf73` |
| Deployment protocol tx (`Case #1`) | `0x1a7dd2f1a54e56108c4d0170a213ffd495184bb6c7d0a37bfb68409d976ecbb5` |
| Deployment EVM envelope | `0xa84743e494bbe47affbc8d739fd15860ee605a8e05a46016b07d118865c1328a` (block `242922`, `logIndex = 15`) |
| Deployed source (`compact_v3`) | `5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf` (`36,128` bytes) |
| Canonical source (`v6_r2_candidate`) | `ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f` (`50,227` bytes) |
| Case `#47` (`evaluateOptionalOmitted`) | Protocol tx `0x8983f7a5e3ed9ac4b62df0645cdf494903f7428e51d17bab6672ffe964aee889`, block `248133`, `FINALIZED + accepted + MAJORITY_AGREE` |
| Case `#51` (`evaluateSixValid`) | Protocol tx `0x6b5a551a567e8478bd1d145be2a77d43899bb3506aefd6773b2407004ffe6749`, block `248322`, `FINALIZED + accepted + MAJORITY_AGREE` |
| Collector output | [bradbury-v6-wallet-4-e2e.json](evidence/bradbury-v6-wallet-4-e2e.json) (`status: "COLLECTED"`, `ready: true`, `passed: 51/51`, `orders: 9`, `retainedHistory: 33`) |

## Remaining scope boundaries and non-claims

- Public Bradbury Phase 2 51-case business E2E is complete for `v6-wallet-4` (`0x10d41bf2e9b54440ced622171ceff191754bcf73`). Historical `v1`/`v2` disagreements, `v3` false support, `v4` committee failure, `v5` positive disagreement, `v6-wallet-2` gas revert, and `v6-wallet-3` Case `#47` halt remain recorded as part of the engineering audit trail. Passing the 51-case `v6-wallet-4` suite proves those 51 committed public test-chain executions, not universal model accuracy across arbitrary external inputs.
- Measured worst-case public-chain deploy/method fee profiles across arbitrary input sizes, broader adversarial-model tests and long-running mainnet behavior remain outside this test-chain validation scope.
- Real user trials, repeated usage/retention evidence and external production security audit are not claimed.
- Public site access is authorized and verified by anonymous HTTP 200 without login redirection. The sanitized source archive (`ResearchReceipt-reviewed-source.zip`), site bundle (`research-receipt-site.tar.gz`), and Portal draft (`docs/portal-projects-submission-draft.json`) are prepared and audited for public release to `https://github.com/glieser2/research-receipt` upon publication; the Portal contribution form has **not** been submitted yet.
- Contributor approval or awarded points are not claimed.

Before any future public submission, retain the exact source commit/deployment fingerprint, environment identity, final receipts, post-finalization reads, normal/negative/missing-evidence outcomes, permission/replay failures and a reproducible walkthrough. Never replace absent block or transaction evidence with generated values.
