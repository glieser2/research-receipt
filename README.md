# ResearchReceipt

Verifiable crypto research commissioning and public-evidence acceptance workbench built with React + TypeScript + Vite and a GenLayer Python Intelligent Contract (`research-receipt/6`). Non-custodial; no token transfers or trading functionality.

- **Bilingual Interface (`EN / ZH`)**: English (`en`) is the default language (`<html lang="en">`, persisted in `localStorage` under `rr:lang:v1`). In English mode, **zero Chinese characters** appear anywhere in the UI, templates, error/status messages, demo data, or on-chain order displays. Users can switch between English and Simplified Chinese at any time using the topbar `EN / ZH` language toggle.
- **Public Bradbury Phase 2 (`chainId = 4221`) `v6-wallet-4` Full E2E Passed (`51 / 51` `FINALIZED + accepted + MAJORITY_AGREE`)**: The read-only public evidence bundle [bradbury-v6-wallet-4-e2e.json](docs/evidence/bradbury-v6-wallet-4-e2e.json) is verified on disk (`status: "COLLECTED"`, `ready: true`, `allRequiredCasesPassed: true`, `firstGatePassed: true`, `latestFinalVerified: true`). Historical failures (including `v6-wallet-3` halting at Case #47, `v6-wallet-2` L2 deployment gas revert, the 33 prior historical transactions, and diagnostic probe records) are preserved intact. Public site: `https://glieser2.github.io/research-receipt/`.

| Environment | Verification Scope | Current Status |
| --- | --- | --- |
| Local Demo Mode | UI workflow, deterministic fictional Northstar fixture, and revision history | Works without a wallet; does not claim model or committee consensus |
| Studio-dev (`61997`) | Real GenVM / model execution, protocol state, and readback in official hosted devnet | Deployed; negative cases, revisions, digest mismatches, permission/replay rejections, and browser E2E passed |
| Public Bradbury Phase 2 (`4221`) | Persistent public testnet transactions, L2 block evidence, and contract state | `v6-wallet-4` (contract `0x10d41bf2e9b54440ced622171ceff191754bcf73`) passed all `51 / 51` cases (`FINALIZED + accepted`); 33 historical transactions and `v6-wallet-2` / `v6-wallet-3` failure archives retained |

## Key Capabilities

- **Verifiable Research Orders**: Lock target chain, protocol, reference cut-off date, designated author address, and 1–6 trusted `raw.githubusercontent.com/<owner>/<repo>/` prefixes.
- **Four Locked Acceptance Pillars**: Admin & Upgrade Permissions, Withdrawal Constraints, Audit Coverage, and Evidence Boundaries & Limitations.
- **Two-Stage Snapshot & Evaluation (`verify_evidence` -> `evaluate`)**: Leaders and validators first fetch commit-pinned sources (`https://raw.githubusercontent.com/<owner>/<repo>/<40-hex-commit>/<path>`, `<= 16,384` bytes each, up to 3 sources) and lock an immutable SHA-256 evidence snapshot; `evaluate` then verifies claims strictly against the locked snapshot with zero external HTTP calls during evaluation.
- **Typed Claim Modes (`research-receipt/6`)**: Separates `factual_assertion`, `unknown_disclosure` (scoped across all committed sources using locked buyer field catalog questions), and `boundary_disclosure`.
- **Bilingual Workbench (`EN / ZH`)**: Defaults to pure English (`en`) and supports instant switching to Simplified Chinese (`zh`).

## Public Testnet Deployment (`v6-wallet-4`)

| Field | Verified Public Testnet Value (`v6-wallet-4`) |
| --- | --- |
| Chain ID / Genesis | `4221` / `0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4` |
| Contract Address | `0x10d41bf2e9b54440ced622171ceff191754bcf73` |
| Deployment Protocol Tx ID | `0x1a7dd2f1a54e56108c4d0170a213ffd495184bb6c7d0a37bfb68409d976ecbb5` |
| EVM Envelope Tx Hash | `0xa84743e494bbe47affbc8d739fd15860ee605a8e05a46016b07d118865c1328a` |
| Deployment Block / Hash | `242922` / `0x93d677dda7547aad822376850b469d37426084a4ab0f8f961d951da506a7f4e8` |
| Deployed Source (`compact_v3`) SHA-256 | `5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf` (36,128 bytes) |
| Canonical Source (`v6_r2_candidate`) SHA-256 | `ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f` (50,227 bytes) |
| Business Suite Outcome | `51 / 51` passed (including Cases `#1..#13` hard gate, Case `#47` `evaluateOptionalOmitted`, and Cases `#48..#51` six-criterion flow) |

## Historical Testnet Lineage & Preserved Evidence

- **Studio-dev (`61997`) vs. Public Testnet (`4221`)**: Studio-dev is a hosted development simulator where saved transaction records have `null` `blockHash` and `blockNumber`; its `FINALIZED` status is not treated as public L2 block inclusion evidence.
- **Session Interruption & Historical Signers**: Two earlier in-memory ephemeral signing sessions became unavailable on 2026-11-06 (`Asia/Shanghai`). Historical address `0x29EB14D10ec2E406E5d1419ED08D803b8B18aB70` retains ~1.995675 testnet GEN (`nonce = 33`), and `0x7036138ada2052af0b07dae5a4d450effd9a40e3` has zero balance; neither key was persisted and neither should be funded ([v6-session-interruption.json](docs/evidence/v6-session-interruption.json)). Subsequent `v6-wallet-4` validation was executed by user-controlled testnet wallet `0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd`.
- **v5 & Diagnostic Probes**: The 10 executed `v5` operations and committee disagreement on the positive evaluation are retained in [bradbury-v5-attempt.json](docs/evidence/bradbury-v5-attempt.json). Subsequent unsigned diagnostic probes (`typed`, `structured`, and `sufficiency`) are preserved in [typed-probe-simulations.json](docs/evidence/typed-probe-simulations.json), [structured-probe-simulations.json](docs/evidence/structured-probe-simulations.json), and [sufficiency-probe-simulations.json](docs/evidence/sufficiency-probe-simulations.json).
- **v6 Lineage (`v6-wallet-2` -> `v6-wallet-3` -> `v6-wallet-4`)**:
  - `contracts/research_receipt_v6_candidate.py` (`9cff3a90…1b4a19`) and `compact` (`e053f1b4…7e1fcb`, 43,437 bytes) reverted on L2 in `v6-wallet-2` due to a `15,000,000` gas limit (envelope `0xfa51562ff02e0e19346723c3ba2687654b2c4682d86d28104851c62b7db6ba23`, [v6-wallet-2-deployment-revert.json](docs/evidence/v6-wallet-2-deployment-revert.json)).
  - Byte-reduced `compact_v2` (`2af33b26…1e42e2`, 35,916 bytes) in `v6-wallet-3` (contract `0xc7d9a5e9fa776f76b1348c7009ea23de6d873885`) passed Cases `#1..#46` (`FINALIZED + accepted`), then halted at Case `#47` `evaluateOptionalOmitted` (protocol tx `0x39b4178dff177c52a319270efafe9618d944606421c30210e53a38c0d52b80a9`) due to a transient validator sub-VM exception (`MAJORITY_DISAGREE`), preserved in [bradbury-v6-wallet-3-attempt.json](docs/evidence/bradbury-v6-wallet-3-attempt.json).
  - Sub-VM exception-hardened canonical source `contracts/research_receipt_v6_r2_candidate.py` (`ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f`, 50,227 bytes) and AST/constant/runner-verified deployment artifact `contracts/research_receipt_v6_compact_v3.py` (`5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf`, 36,128 bytes) deployed at `0x10d41bf2e9b54440ced622171ceff191754bcf73` under [v6-wallet-4-validation-plan.json](docs/evidence/v6-wallet-4-validation-plan.json) and passed all `51 / 51` cases ([bradbury-v6-wallet-4-e2e.json](docs/evidence/bradbury-v6-wallet-4-e2e.json)). Transport observations across both official RPC endpoints are recorded in [v6-transport-observations.json](docs/evidence/v6-transport-observations.json), and staged review notes are in [v6-staged-review.md](docs/v6-staged-review.md).

## Verification & Scope Boundaries

- Evaluates only locked criteria and their bound statements against committed snapshot sources; does not verify every sentence of an arbitrary report, and does not constitute a smart-contract security audit, mainnet deployment verification, yield forecast, or investment advice.
- Consensus evaluations use public testnet models and may still make errors; independent re-evaluation is not a proof of external ground truth.
- Python unit tests use explicit GenVM interface stubs; TypeScript transaction tests mock the SDK transport. They do not replace live runtime, wallet, public chain, or security audits.
- See [Contract Interface](docs/contract.md), [Security Policy](SECURITY.md), [Validation Record](docs/validation.md), and [Contribution Draft](docs/contribution-draft.md).

## Development & Verification

Requires Node 22+, pnpm 11, and Python 3.13 (for GenVM stub unit tests).

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
python -m unittest discover -s tests/python -v
pnpm build
```

Latest local verification suite: **134 Vitest tests**, **92 Node tests**, **350 Python stub unit tests**, and production Vite build passing.
