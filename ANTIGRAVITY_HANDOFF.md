# ResearchReceipt Handoff & Verification Summary

Latest checkpoint: 2026-11-08 (`Asia/Shanghai`).

## Current Status Summary

- **Public Bradbury Phase 2 (`chainId = 4221`) `v6-wallet-4` Full 51-Case Business E2E Passed (`51 / 51` `FINALIZED + accepted + MAJORITY_AGREE`)**:
  - Contract Address: `0x10d41bf2e9b54440ced622171ceff191754bcf73`
  - Deployment Protocol Tx ID: `0x1a7dd2f1a54e56108c4d0170a213ffd495184bb6c7d0a37bfb68409d976ecbb5`
  - EVM Envelope Tx Hash: `0xa84743e494bbe47affbc8d739fd15860ee605a8e05a46016b07d118865c1328a` (`blockNumber = 242922`)
  - User-controlled Testnet Signer: `0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd` (`nonce = 49..99`)
- **Verified Source Commitments**:
  - Canonical Source: `contracts/research_receipt_v6_r2_candidate.py` (SHA-256 `ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f`, 50,227 bytes)
  - Deployed Compact Source: `contracts/research_receipt_v6_compact_v3.py` (SHA-256 `5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf`, 36,128 bytes)
- **Read-Only Public Evidence Bundle**:
  - `docs/evidence/bradbury-v6-wallet-4-e2e.json` (`status: "COLLECTED"`, `ready: true`, `allRequiredCasesPassed: true`, `firstGatePassed: true`, `latestFinalVerified: true`, `passed: 51`, `retainedHistory: 33`, `orders: 9`).
- **Frontend & Verification Suite**:
  - `src/deployment.json` points to the verified Bradbury Phase 2 `v6-wallet-4` contract (`0x10d41bf2e9b54440ced622171ceff191754bcf73`) while retaining the `studioDevDeployment` reference.
  - Bilingual (`EN / ZH`) UI defaults to English (`<html lang="en">`, `rr:lang:v1`) with zero Chinese characters in English mode and an instant `EN / ZH` toggle in the top bar.
  - Verification suite passing: **134 Vitest tests**, **92 Node tests**, **350 Python stub unit tests**, and production Vite build (`pnpm build`).
- **Preserved Historical Lineage**:
  - All 33 original historical transactions (`0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70`), `v6-wallet-1` plan, `v6-wallet-2` L2 deployment revert (`0xfa51562ff02e0e19346723c3ba2687654b2c4682d86d28104851c62b7db6ba23`), and `v6-wallet-3` (`46/51` cases passed before halting at Case `#47` `0x39b4178dff177c52a319270efafe9618d944606421c30210e53a38c0d52b80a9`) are retained intact in `docs/evidence/`.

## Immutable Commitments (Do Not Modify)

| Artifact | Path | SHA-256 |
| --- | --- | --- |
| Legacy `v5` Contract | `contracts/research_receipt.py` | `60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65` |
| Initial `v6` Canonical Source | `contracts/research_receipt_v6_candidate.py` | `9cff3a90a45daee031bf3fb893857bcb53cb07bc6501b86fecc955ce021b4a19` |
| Initial `v6` Compact Source | `contracts/research_receipt_v6_compact.py` | `e053f1b4250b6a0e7717722c54dfe97717a5d341b374d9404d7b5b2c057e1fcb` |
| `v6-wallet-3` Compact v2 Source | `contracts/research_receipt_v6_compact_v2.py` | `2af33b26424a8bc2399d71cdb6a2ccdbd53acb0e4fc06de1ede14bb7791e42e2` |
| `v6-wallet-4` Canonical Source | `contracts/research_receipt_v6_r2_candidate.py` | `ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f` |
| `v6-wallet-4` Deployed Compact v3 | `contracts/research_receipt_v6_compact_v3.py` | `5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf` |
| Field Catalog | `src/field-catalog.json` | `755b155c7c5d1bd0f193c96721246980393bfa86bbedb57e4017b00e3d9e30a5` |
| Fee Profile | `src/fee-profile.json` | `df9be739a22efd5460db67d6bbb688d0bec87f56f7d163582e4269960ede7415` |
| `v6-wallet-4` Frozen Plan | `docs/evidence/v6-wallet-4-validation-plan.json` | `e65905d24990f7f1bc0fd20ae8b172d57c3290f7ae531b9711077205a46839d0` |
| `v6-wallet-4` Public Fixture | `tests/fixtures/bradbury-v6-wallet-4-input.json` | `0c851377287cfe46476fdb11d2dfd9f4ca29cdf94adbc6cf41cd956582648f0e` |

## Network & Verification Commands

- **Bradbury Phase 2 Chain ID**: `4221`
- **GenLayer RPC**: `https://rpc-bradbury.genlayer.com`
- **Official L2 RPC**: `https://rpc.testnet-chain.genlayer.com`
- **Genesis Hash**: `0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4`
- **AddressManager**: `0x3F71AE080BD6270A91dBcc7960d88797828538E0`
- **Public Repository**: `https://github.com/glieser2/research-receipt`
- **Public Site (GitHub Pages)**: `https://glieser2.github.io/research-receipt/`

```sh
pnpm test
python -m unittest discover -s tests/python -p test_*.py
pnpm build
```
