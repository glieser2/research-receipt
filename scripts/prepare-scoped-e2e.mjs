import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
const sessionFile = process.env.RR_E2E_SESSION;
if (!/^artifacts\/bradbury\/session-[0-9a-z]+\.json$/.test(sessionFile || '')) throw new Error('Set RR_E2E_SESSION to the isolated public session metadata.');
const session = JSON.parse(await readFile(sessionFile, 'utf8'));
const baseline = JSON.parse(await readFile('artifacts/bradbury/v2-e2e-input.json', 'utf8'));
const context = { url: 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/3e6c86392c97fbc30d3d20a378a6f58beba08eba/contracts/utils/Context.sol', sha256: '9c1cc43aa4a2bde5c7dea0d4830cd42c54813ff883e55c8d8f12e6189bf7f10a', byte_length: 860 };
const response = await fetch(context.url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Pinned Context source unavailable.');
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length !== context.byte_length || createHash('sha256').update(bytes).digest('hex') !== context.sha256) throw new Error('Context bytes differ from independently reviewed evidence.');
await writeFile('artifacts/bradbury/Context.sol', bytes, { flag: 'wx' });
const spec = { ...baseline.spec, client_ref: randomUUID(), title: '默认基类源码审查 · Ownable + Context', protocol: 'OpenZeppelin Ownable + Context (pinned default implementations)', chain: 'EVM source only; excludes derived overrides, proxies and deployed instances', author: session.actors.owner };
const claims = [
  { criterion_id: 'permissions', statement: '仅讨论本次两份固定commit基类源码的默认、未重写实现：Ownable的transferOwnership与renounceOwnership声明都带onlyOwner，_checkOwner在owner()!=_msgSender()时回退；Context的默认_msgSender()返回msg.sender。本结论不适用于未知的继承重写、代理、升级或实际部署。', evidence_indices: [0, 1] },
  { criterion_id: 'withdrawals', statement: '本项只依据Ownable权限模块源码；该文件不提供具体协议的提现或赎回流程证据，因此提现等待期与能否即时退出均为未知，不作即时提现承诺。', evidence_indices: [0] },
  { criterion_id: 'audit', statement: '本项材料为Ownable源码，不是审计报告；未提交审计报告，无法核查审计覆盖范围及版本，审计状态未知，不宣称任何部署已通过安全审计。', evidence_indices: [0] },
  { criterion_id: 'limitations', statement: '本报告只核查逐项引用的固定commit源码和上述陈述，不证明任何派生重写、实际部署状态、协议整体安全或未来收益。', evidence_indices: [0] },
];
const positive = { report_title: '默认未重写基类审查 · 修订稿', report_version: 'v2', report_body: claims.map(c => c.statement).join('\n'), sources: [baseline.positive.sources[0], context], claims };
const negative = structuredClone(positive);
negative.report_title = '默认未重写基类审查 · 错误修饰符声明'; negative.report_version = 'v1';
negative.claims[0] = { criterion_id: 'permissions', statement: '仅讨论固定commit中默认、未重写的Ownable源码：transferOwnership与renounceOwnership的声明均没有onlyOwner修饰符，_checkOwner也不会比较owner()与_msgSender()。', evidence_indices: [0] };
negative.report_body = negative.claims.map(c => c.statement).join('\n');
const missing = structuredClone(positive); missing.report_version = 'v1'; missing.sources[0].sha256 = '0'.repeat(64);
const specMissing = { ...spec, client_ref: randomUUID(), title: '证据完整性负例 · Ownable摘要不匹配' };
const permissionSpec = { ...spec, client_ref: randomUUID(), title: '权限负例 · 锁定其他作者', author: session.actors.author };
const replay = structuredClone(missing); replay.report_title += ' · 仅改标题'; replay.report_version = 'v2';
const scopeRevision = { rationale: 'Pre-model human evidence review found missing Context and ambiguity about virtual overrides in the old positive report. Preserve old immutable orders; supplement evidence and explicitly restrict default, unmodified implementations. Four locked criteria and production validator remain unchanged.', sourcePolicyVersion: 'research-receipt/2', previousPositiveSubmissionHash: 'available in the original v2 chain record', expectedNegative: 'NOT_ACCEPTED, permissions CONTRADICTED', expectedPositive: 'ACCEPTED, all four findings SUPPORTED' };
await writeFile('artifacts/bradbury/scoped-e2e-input.json', JSON.stringify({ spec, specMissing, negative, positive, missing, permissionSpec, replay, scopeRevision }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ prepared: true, correctionClientRef: spec.client_ref, missingClientRef: specMissing.client_ref, permissionClientRef: permissionSpec.client_ref, contextSha256: context.sha256, productionValidatorChanged: false }));
