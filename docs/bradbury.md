# Public Bradbury Phase 2 verification and preparation

**Latest state (2026-11-08 Asia/Shanghai):** `v6-wallet-4` (`policy_version = 'research-receipt/6'`, deployed source `contracts/research_receipt_v6_compact_v3.py`, SHA-256 `5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf`) has been deployed at `0x10d41bf2e9b54440ced622171ceff191754bcf73` (protocol tx `0x1a7dd2f1a54e56108c4d0170a213ffd495184bb6c7d0a37bfb68409d976ecbb5`, envelope `0xa84743e494bbe47affbc8d739fd15860ee605a8e05a46016b07d118865c1328a`, block `242922`) by the user's self-controlled wallet `0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd` and has completed all `51 / 51` prelocked business cases with `FINALIZED + accepted + MAJORITY_AGREE` consensus and verified final-state readbacks ([v6-wallet-4 public evidence](evidence/bradbury-v6-wallet-4-e2e.json)). Earlier halted/reverted runs ([v5 attempts](evidence/bradbury-v5-attempt.json), [typed simulations](evidence/typed-probe-simulations.json), [v6-wallet-2 deployment revert](evidence/v6-wallet-2-deployment-revert.json), and [v6-wallet-3 46/51 attempt halted at Case #47](evidence/bradbury-v6-wallet-3-attempt.json)) remain preserved in full without reinterpretation.

Studio-dev is an official hosted development environment. Its real GenVM/model execution does not by itself establish public L2 inclusion. This adapter targets the persistent public test chain and keeps protocol finality, execution success, block references, and VM state readback separate.

## Current version boundaries

- Historical v1 deployment `0x503b620680306533D43D57a859aB308eE9a9F7e1` has [independent deployment evidence](evidence/bradbury-deployment-independent.json).
- Historical v2 deployment `0xEE2F34aF1ef90938341a95B466769C92A96E61A8`, source SHA-256 `cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745`, has [separate independent evidence](evidence/bradbury-v2-deployment-independent.json). Both proofs are deployment-only. Public business E2E remains incomplete after model disagreements; old results retain their original policy semantics.
- V3 policy `research-receipt/3`, source SHA-256 `19d6cd9a6ac04328f50236922fad9985aead47b3db215ca847dd854e216d241e`, is frozen and not deployed. Its first real negative paired `gen_call` simulation failed semantic validation: both models incorrectly labeled the permissions statement `SUPPORTED`, and another criterion disagreed. Source/fixture fingerprints matched without schema/I/O/repair errors; root cause is unproved and false acceptance is a concern. The remaining two planned pairs were stopped. The prelocked 11-case plan is incomplete, and v3 cannot be described as validated safe or reliable. Simulation is not a finalized transaction or deployment proof.
- V4 policy `research-receipt/4`, source SHA-256 `f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61`, passed exactly one pair each for negative/positive/strict-unknown (6 `gen_call`, 24 `exec_prompt`, no signed transaction). The [simulation evidence](evidence/public-semantic-simulations.json) preserves these alongside v3's failed pair. This is bounded evidence, not stability/accuracy statistics or proof of the original root cause.
- V4 deployed at `0x4e95cB64A0AD4fb443B0304dA850162BbEF7d973`, protocol `0x811fb897a3dc207b7a6b3e55f6c4b61c169aac0a555eaa93367a5db56bbe9a5c`, envelope `0x0a880e7227bf94c4a4737e5032f23ad383151385aad0ba8ecd52544406510685`, block `217130`. Its [independent proof](evidence/bradbury-v4-deployment-independent.json) covers deployment/zero baseline only. Its subsequent business committee assessment failed; observed leader correctness, initial timeout and third-party appeal/budget changes do not identify the private-validator failure cause or establish that 600 TU is insufficient.
- Separate [source-only](evidence/source-only-probe-independent.json) and [fixed-inline four-task](evidence/inline-source-probe-independent.json) deployments passed their full diagnostic receipt gates. Inline recorded 3 RETURN and 1 NONDET_DISAGREE, not unanimity. They are auxiliary paths, not business cases or root-cause proofs.
- Current V5 policy `research-receipt/5`, source `60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65`, deployed at `0xF21F4c3e49963a093F7e5b4De414f43E503f09B5`. Protocol ID `0x0211015cf386239dadbcb41dec60e8dc1a265cf73f27c705afa4ce396dc7518a`, envelope `0x8407880d9dd488c448189da11f77e3913f3c00d079ea3e8341b3165b64649fe5`, block `217521`, hash `0x2410fde08276be15d2053b68206181e614b5b282c9d9d4ff2bbf255a8e140bf6`. The [independent proof](evidence/bradbury-v5-deployment-independent.json) verifies accepted successful finality, exact source and zero-order baseline. The [prelocked 24-case suite](evidence/v5-validation-plan.json) is in progress, not completed or contribution-ready.

V5 inputs require `evidence_requirement` per criterion. The model never receives
that field: it labels evidence `SUPPORTED`, `CONTRADICTED`, `SCOPED_UNKNOWN`, or
`NOT_ESTABLISHED`; source failures are code-only `SOURCE_UNAVAILABLE`. Code maps
evidence to delivery, accepting a complete scoped unknown only when the buyer
explicitly permits it. Contradictions, failed hashes and incomplete coverage
cannot be overridden. The body must exactly join bound statements in locked order;
each prompt excludes full body/other criteria/claims. Requested facts must all be
established for `SUPPORTED`; at least one accurately requested unknown is needed
for `SCOPED_UNKNOWN`, excluding out-of-scope deployment disclaimers. Titles/links
are outside accepted report content. See the [v5 schema and policy](contract.md); do not send its
new methods to legacy deployments or reuse an old verification flag for a new source.

V5 verification and assessment are separate transactions. `verify_evidence` accepts
only order/revision IDs, independently web-checks every committed source in leader
and validator, and stores a fully bound immutable snapshot. `evaluate` revalidates
that snapshot in both sides and makes no source HTTP request. Failed sources have
null material and cannot be rescued by a model. One snapshot is allowed per
revision, even on transient failure: assess with affected claims ineligible, then
genuinely correct evidence/research in a new revision if the order is not accepted. Identical-content re-fetch
and meaningless edits are not an approved recovery path. The UI exposes two
explicit wallet operations and preserves pending stage context on interruption.

## Verified network identity

- Intelligent Contract RPC: `https://rpc-bradbury.genlayer.com`.
- Chain ID: `4221`.
- Block-zero hash: `0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4`.
- AddressManager: `0x3F71AE080BD6270A91dBcc7960d88797828538E0`.
- Official manifest: <https://docs.genlayer.com/validators/bradbury.protocol-manifest.json>.
- Explorer: <https://scan.bradbury.genlayer.com>.

The RPC appears in the official SDK source. Read-only observation on 2026-11-05 confirmed the exact Phase 2 genesis and a synced `gen_syncing` response. `gen_getContractSchema` reached the real GenVM. `gen_protocolVersion` was not implemented at that observation and is not used as an availability check.

`bradbury-client.mjs` verifies chain ID and genesis before constructing a client, and repeats verification before every write. It fetches the official manifest, then reads AddressManager at one chain snapshot and checks every required address and deployed-code presence. ConsensusData's own registry must agree. SDK `2.0.0-rc.2` chain ABIs are retained, while addresses are replaced with verified Phase 2 addresses. `roundsStorageContract` maps to the exact `RoundsStorage` registry entry, not `Rounds`; the SDK also resolves `ConsensusDataBigRounds` and `TransactionManager` internally.

## Start a read-only session

```powershell
node scripts/bradbury-session.mjs
```

The process creates independent owner/author/outsider test accounts in memory only. Its first JSON output includes public addresses, balance, the current protocol deposit quote, and the sanitized evidence file path. It never prints, accepts or persists private keys. Keep the process alive if test GEN will be sent to its address; closing it permanently loses control of those temporary actors.

To enable authorized source disclosure and test-chain writes, start a new session with:

```powershell
$env:RR_BRADBURY_DEPLOY_ACK='1'
node scripts/bradbury-session.mjs
```

ACK does not fund an account or bypass network identity/funding checks. There are no faucet, transfer, fund, reset or administrator commands. No user wallet is accessed.

Each stdin command is one JSON line:

Write examples are separate actions: wait for protocol FINALIZED, successful
execution and expected state readback before issuing the next dependent write.

```json
{"op":"balance"}
{"op":"quote"}
{"op":"schema","file":"contracts/research_receipt.py"}
{"op":"deploy","file":"contracts/research_receipt.py","args":[],"readback":{"method":"get_order_count","args":[],"expected":0}}
{"op":"status","hash":"0x<64-hex-transaction-id>"}
{"op":"bind","address":"0x<40-hex-contract-address>"}
{"op":"read","method":"get_order_count","args":[]}
{"op":"read","method":"get_evidence_snapshot","args":[1,1]}
{"op":"write","role":"owner","method":"create_order","inputFile":"artifacts/live/fixtures.json","case":"valid","prefixArgs":[]}
{"op":"write","role":"owner","method":"verify_evidence","args":[1,1]}
{"op":"write","role":"owner","method":"evaluate","args":[1,1]}
{"op":"quit"}
```

Source/fixture files must be real project-relative files under the current project (symlink escapes and traversal outside it are rejected). Deployment never depends on the schema endpoint succeeding: introspection errors are recorded separately. The session does not auto-retry writes. Once a hash exists, request its status rather than submitting another transaction.

## Fees and funding dependency

Quotes use `src/fee-profile.json` and current public prices. Metadata is now `bradbury-development` and includes `verify_evidence`; numeric allocations remain leader/validator 600/600 TU, per-round budget `1e16`, APR 0 and SDK rotations `[3]`. This is **not** a measured worst-case profile or single-committee promise. Earlier profile bytes remain in `tests/fixtures/fee-profile-v4-development.json`. Each stage has a separate quote/deposit plus L2 envelope gas, and balance is checked before a write.

The scoped quote uses rc.2's exported fee-distribution builder, 120% rounded-up price caps, configured rotations, and the live FeeManager's `calculateRoundFees`. Because the profile explicitly supplies `executionBudgetPerRound`, it omits rc.2's unused default-budget `estimateProposeReceiptGas` call, which currently fails on this RPC when the SDK omits `from` but supplies `gasPrice`. Read-only verification on 2026-11-05 returned a deposit of `40000000000033882` wei (about 0.04 test GEN) per operation, before envelope gas. Prices and requirements are refreshed rather than hard-coded.

`appealRounds=0` is the application's configured allocation, not a guarantee that
no third party can invoke protocol appeal/top-up paths. No automatic application
appeal is implemented. Keep observed effective round budgets separate from the
original quote when analyzing failures.

At the recorded preparation observation, the normal public faucet at <https://testnet-faucet.genlayer.foundation> stated **100 GEN per claim, once per week, at least 0.01 ETH on Ethereum mainnet**, with Cloudflare Turnstile. A fresh zero-ETH account could not satisfy that route. The user subsequently supplied 2 test GEN to the independent temporary account for the recorded public tests. Do not use Studio's `sim_fundAccount` on the public chain, bypass eligibility, use a user's wallet or acquire real ETH for this task. Further writes require adequate test funding and existing authorization.

## What counts as a passed public-chain test

1. Verified Phase 2 network identity and registry addresses.
2. A real submitted transaction ID, retained on interruption.
3. Protocol status `FINALIZED` and a successful execution result.
4. A matching indexed `NewTransaction` or `CreatedTransaction` event links the protocol ID to its EVM envelope hash, whose successful receipt supplies the block hash/number. The protocol ID is never used as an EVM hash. Searches are bounded from the pre-submission block; no matching event means unverified inclusion.
5. An explicit `latest-final` `gen_call`/SDK readback of that transaction's contract address matches a supplied expected result. A read without an expected result is only an observation. BigInt values serialize as strings.
6. ResearchReceipt create, author submission, independently accepted bound evidence snapshots, normal/failed-evidence evaluation, revision preservation and actor/repeated-snapshot/missing-snapshot rejection using dedicated actors.

Raw artifacts/session/RPC records stay local and are ignored by Git, not published wholesale. Sanitized public evidence, frozen reviewed inputs, MIT fixtures/license and archives are retained separately. V1/v2/v4/v5 deployment proofs establish only their own scopes; v3 is undeployed. The collector retains 21 historical business transactions plus the 2 auxiliary deployments separately from the 24 v5 business cases; historical failures/undetermined results cannot be removed or counted as new successes. V5 business E2E is still in progress.

`fullyVerified` requires a tracked independent actor's sender, protocol finality, successful execution, matching event/receipt evidence and expected final-state readback together. For deployment, the decoded on-chain source must also hash to the submitted project source fingerprint. A tracked deployment is bound only after that gate passes. Status for a pre-existing transaction may specify a decimal `fromBlock` in the last 20,000 blocks; this session does not search unbounded history, and untracked history cannot claim full project verification.

If a retained session was started before these guards were loaded, do not restart it and lose its keys. A second, read-only process may import `connectBradbury` and `verifyDeploymentEvidence` from `scripts/bradbury-client.mjs`, pass the public transaction ID, actor address, submitted source SHA256, pre-submission block and expected readback, and save the returned evidence. This independent verifier requires no private account or signing operation.

## Primary sources

- <https://docs.genlayer.com/developers/networks>
- <https://docs.genlayer.com/validators/bradbury.protocol-manifest.json>
- <https://github.com/genlayerlabs/genlayer-js/blob/1b7f50a3a3f2963ea857941b0fb386081dd5c326/src/chains/testnetBradbury.ts>
- <https://testnet-faucet.genlayer.foundation>
