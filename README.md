# ResearchReceipt

**English (Default) | [简体中文](#简体中文说明)**

Verifiable crypto research commissioning and public-evidence acceptance workbench built with React + TypeScript + Vite and a GenLayer Python Intelligent Contract (`research-receipt/6`). Non-custodial; no token transfers or trading functionality.

- **Bilingual Interface (`EN / ZH`)**: English (`en`) is the default language (`<html lang="en">`, persisted in `localStorage` under `rr:lang:v1`). In English mode, **zero Chinese characters** appear anywhere in the UI, templates, error/status messages, demo data, or on-chain order displays. Users can switch between English and Simplified Chinese at any time using the topbar `EN / ZH` language toggle.
- **Public Bradbury Phase 2 (`chainId = 4221`) `v6-wallet-4` Full E2E Passed (`51 / 51` `FINALIZED + accepted + MAJORITY_AGREE`)**: The read-only public evidence bundle [bradbury-v6-wallet-4-e2e.json](docs/evidence/bradbury-v6-wallet-4-e2e.json) is verified on disk (`status: "COLLECTED"`, `ready: true`, `allRequiredCasesPassed: true`, `firstGatePassed: true`, `latestFinalVerified: true`). Historical failures (including `v6-wallet-3` halting at Case #47, `v6-wallet-2` L2 deployment gas revert, the 33 prior historical transactions, and diagnostic probe records) are preserved intact. Per user instruction, the Portal contribution form has not been filled or submitted, and creating a GitHub repository is deferred.

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

---

## 简体中文说明

加密研究委托与公开证据交付验收工作台。React + TypeScript + Vite；GenLayer Python Intelligent Contract。无托管、转账或交易功能。支持中英双语切换（默认英文 `EN`，英文模式下不出现任何中文字符，可通过顶部导航栏 `EN / ZH` 按钮随时切换为简体中文）。

**公开 Bradbury Phase 2（`chainId = 4221`）`v6-wallet-4` 51 项预锁业务 E2E 已全部通过（`51 / 51` `FINALIZED + accepted + MAJORITY_AGREE`），只读公开证据收集包 [bradbury-v6-wallet-4-e2e.json](docs/evidence/bradbury-v6-wallet-4-e2e.json) 已核验落盘（`status: "COLLECTED"`, `ready: true`, `allRequiredCasesPassed: true`, `firstGatePassed: true`, `latestFinalVerified: true`）。历史失败（含 `v6-wallet-3` 在第 47 项中止、`v6-wallet-2` 部署 gas 回滚、原 33 笔历史交易及探针记录）与原预期完整保留。按用户指令，Portal 贡献表单尚未填写或提交，GitHub 仓库暂缓创建。**

2026-11-06（Asia/Shanghai）恢复运行时，两个早期内存临时签名进程均已不可用，操作系统进程检查无匹配。旧地址 `0x29EB14D10ec2E406E5d1419ED08D803b8B18aB70` 仍有约 1.995675 测试 GEN，但未保存的密钥无法恢复，当前不能签名或转出；新地址 `0x7036138ada2052af0b07dae5a4d450effd9a40e3` 余额为 0。请勿再向这两个地址补款。见[中断与余额记录](docs/evidence/v6-session-interruption.json)。后续由用户自控测试钱包 `0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd` 按独立冻结计划完成 `v6-wallet-4` 全套 51 项链上验证。

| 环境 | 验证范围 | 当前情况 |
| --- | --- | --- |
| 本地示例演练 | 页面流程、确定性虚构案例与版本保留 | 无钱包可体验；Northstar 不标称模型共识 |
| Studio-dev，61997 | 官方托管开发模拟环境中的真实 GenVM／模型执行、协议状态与回读 | 已部署；负例、修订、摘要失败、权限／重放拒绝及浏览器完整流程通过 |
| 公开 Bradbury Phase 2，4221 | 持久公开测试链的交易、区块证据与合约状态 | `v6-wallet-4`（合约 `0x10d41bf2e9b54440ced622171ceff191754bcf73`）51/51 项业务用例全部 `FINALIZED + accepted` 通过；33 笔旧历史交易及 `v6-wallet-2`/`v6-wallet-3` 失败记录独立保留 |

Studio-dev 不是公开链；已保存的开发环境交易记录中 `blockHash`、`blockNumber` 为 `null`。其 `FINALIZED` 不能当作公开 L2 收录证明。网站已按用户授权公开，匿名 HTTP 访问返回 200；GitHub 按用户决定暂缓，先保留本地源码包。没有获批或获分记录。

v5 的十次已执行业务操作与完整公开失败结果见 [v5 尝试记录](docs/evidence/bradbury-v5-attempt.json)。后续 typed 诊断前三组公开节点配对通过，第四组“未知夹带即时退出承诺”中 validator 错判为有效，严格比较拒绝；第五组及委员会部署均停止。八次无签名模拟和完整投影见 [typed 诊断记录](docs/evidence/typed-probe-simulations.json)。结构化版本使用独立源码与预锁输入，不重解释这些失败。

结构化版本随后通过前三组配对，但第四组 leader 将无证据承诺拒绝为“矛盾”，未符合预锁的“证据未建立”分类；因此在 validator 前停止，见 [七次结构化模拟记录](docs/evidence/structured-probe-simulations.json)。它没有误放行，也不能称为双方分歧。后续独立方案把事实／边界判断限定为二元证据充分性，牺牲反证／缺证的共识细分，并将选材范围与支持引用分开。

充分性探针随后通过[全部五组公开节点配对](docs/evidence/sufficiency-probe-simulations.json)，但首笔真实部署因 SDK 估算 revert 后回退到不足的 200,000 gas，被 L2 拒绝；没有协议交易哈希，fresh nonce 未变化。

v6 将事实／边界充分性与结构化未知披露合并到真实业务路径，保留来源快照绑定和一次性锁定。
- 初版可读源码 `contracts/research_receipt_v6_candidate.py`（`9cff3a90…1b4a19`）与 `compact`（`e053f1b4…7e1fcb`，43,437 字节）在 `v6-wallet-2` 中因 `15,000,000` gas 上限在 L2 回滚（信封 `0xfa51562ff02e0e19346723c3ba2687654b2c4682d86d28104851c62b7db6ba23`，见 [`v6-wallet-2` 部署回滚记录](docs/evidence/v6-wallet-2-deployment-revert.json)）。
- 缩减字节后的 `compact_v2`（`2af33b26…1e42e2`，35,916 字节）在 `v6-wallet-3`（合约 `0xc7d9a5e9fa776f76b1348c7009ea23de6d873885`）通过前 46 项，但在第 47 项 `evaluateOptionalOmitted`（协议交易 `0x39b4178dff177c52a319270efafe9618d944606421c30210e53a38c0d52b80a9`）因验证者子 VM 瞬态异常触发 `MAJORITY_DISAGREE` 而按规则中止，完整保留于 [`v6-wallet-3` 中止归档](docs/evidence/bradbury-v6-wallet-3-attempt.json)。
- 针对子 VM 异常捕获与有界重试加固后的可读源码 `contracts/research_receipt_v6_r2_candidate.py`（`ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f`，50,227 字节）与经 AST／非文档字符串常量／runner 等价校验的部署源码 `contracts/research_receipt_v6_compact_v3.py`（`5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf`，36,128 字节）在 [`v6-wallet-4` 51 项冻结计划](docs/evidence/v6-wallet-4-validation-plan.json)下部署至 `0x10d41bf2e9b54440ced622171ceff191754bcf73`，51 项全部通过（见 [`v6-wallet-4` 公开 E2E 证据](docs/evidence/bradbury-v6-wallet-4-e2e.json)）。两条官方 RPC 的完整身份验证及默认估算拒绝见[运输层记录](docs/evidence/v6-transport-observations.json)。候选审查和恢复边界见 [v6 审查](docs/v6-staged-review.md)。

### 验收边界

只验收锁定标准及关联声明；不表示整份报告的每一句话已核实，也不构成代码安全审计、真实部署验证、收益预测或投资建议。评估结果使用公开网络模型，可能出错；独立重评不等于外部真相证明。

Python 单测使用明确的 GenVM 接口 stub；TypeScript 交易测试模拟 SDK。它们不能替代真实运行时、钱包、公开链或安全审计。

详见 [合约接口](docs/contract.md)、[安全边界](SECURITY.md)、[验证记录](docs/validation.md)、[尚未提交的贡献草稿](docs/contribution-draft.md)。
