// Prepare once, before model or chain execution; never overwrite a tested oracle.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
const old = JSON.parse(await readFile('artifacts/bradbury/scoped-e2e-input.json', 'utf8'));
const original = 'Context的默认_msgSender()返回msg.sender。本结论不适用于未知的继承重写、代理、升级或实际部署。';
const covered = 'Context的默认_msgSender()返回msg.sender。这两份文件本身均未定义代码升级入口或升级管理员机制；本项只核查这些源文件中的默认权限检查与升级入口，不覆盖任意派生重写、代理或实际部署的权限。';
for (const key of ['positive', 'missing', 'replay']) {
  old[key].claims[0].statement = old[key].claims[0].statement.replace(original, covered);
  old[key].report_body = old[key].claims.map(c => c.statement).join('\n');
}
const spec = { ...old.spec, client_ref: randomUUID(), criteria: old.spec.criteria.map(c => ({ ...c, evidence_requirement: ['withdrawals', 'audit'].includes(c.id) ? 'scoped_unknown_allowed' : 'fact_required' })) };
const specStrict = structuredClone(spec);
specStrict.client_ref = randomUUID(); specStrict.title += ' · 审计事实必须有据';
specStrict.criteria.find(c => c.id === 'audit').evidence_requirement = 'fact_required';
const specMissing = { ...spec, client_ref: randomUUID(), title: '证据完整性负例 · Ownable摘要不匹配' };
const permissionSpec = { ...spec, client_ref: randomUUID(), title: '权限负例 · 锁定其他作者', author: old.permissionSpec.author };
const input = { spec, specStrict, specMissing, permissionSpec, negative: old.negative, positive: old.positive, missing: old.missing, replay: old.replay };
const serialized = JSON.stringify(input, null, 2) + '\n';
const expected = [
  { id: 'positive', spec: 'spec', submission: 'positive', statuses: ['SUPPORTED', 'SCOPED_UNKNOWN', 'SCOPED_UNKNOWN', 'SUPPORTED'], delivery: ['FULFILLED', 'FULFILLED', 'FULFILLED', 'FULFILLED'], verdict: 'ACCEPTED' },
  { id: 'negative', spec: 'spec', submission: 'negative', statuses: ['CONTRADICTED', 'SCOPED_UNKNOWN', 'SCOPED_UNKNOWN', 'SUPPORTED'], delivery: ['CONTRADICTED', 'FULFILLED', 'FULFILLED', 'FULFILLED'], verdict: 'NOT_ACCEPTED' },
  { id: 'strictUnknown', spec: 'specStrict', submission: 'positive', statuses: ['SUPPORTED', 'SCOPED_UNKNOWN', 'SCOPED_UNKNOWN', 'SUPPORTED'], delivery: ['FULFILLED', 'FULFILLED', 'INSUFFICIENT', 'FULFILLED'], verdict: 'INSUFFICIENT_EVIDENCE' },
  { id: 'hashMismatch', spec: 'specMissing', submission: 'missing', statuses: Array(4).fill('SOURCE_UNAVAILABLE'), delivery: Array(4).fill('INSUFFICIENT'), verdict: 'INSUFFICIENT_EVIDENCE', modelCalls: 0 },
];
await writeFile('artifacts/bradbury/v3-e2e-input.json', serialized, { flag: 'wx' });
await writeFile('docs/evidence/v3-validation-plan.json', JSON.stringify({ format: 'research-receipt/v3-prelocked-plan/1', preparedAt: new Date().toISOString(), policyVersion: 'research-receipt/3', fixtureFile: 'artifacts/bradbury/v3-e2e-input.json', fixtureSha256: createHash('sha256').update(serialized).digest('hex'), expected, sourceCommitment: 'Set exact frozen source hash before any model or deployment call.', rule: 'Do not alter expected labels after seeing model results. Preserve failures. Evidence classification must not depend on buyer unknown policy; only deterministic delivery mapping changes.' }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ prepared: true, fixtureSha256: createHash('sha256').update(serialized).digest('hex'), expectedCases: expected.length }));
