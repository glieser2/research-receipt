import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
const input = JSON.parse(await readFile('artifacts/bradbury/v3-e2e-input.json', 'utf8'));
const prior = JSON.parse(await readFile('docs/evidence/v3-validation-plan.json', 'utf8'));
for (const key of ['spec', 'specStrict', 'specMissing', 'permissionSpec']) input[key].client_ref = randomUUID();
const canonicalBody = submission => input.spec.criteria.flatMap(c => submission.claims.filter(row => row.criterion_id === c.id).map(row => row.statement.trim())).join('\n');
for (const submission of Object.values(input)) if (Array.isArray(submission.claims)) submission.report_body = canonicalBody(submission);
input.unboundBody = structuredClone(input.missing);
input.unboundBody.report_version = 'v2';
input.unboundBody.report_body += '\n此段未绑定任何交付条目，却声称所有部署都安全。';
input.reorderedClaims = structuredClone(input.positive);
input.reorderedClaims.claims.reverse();
const serialized = JSON.stringify(input, null, 2) + '\n';
const plan = {
  format: 'research-receipt/v4-prelocked-plan/1', preparedAt: new Date().toISOString(), policyVersion: 'research-receipt/4',
  fixtureFile: 'artifacts/bradbury/v4-e2e-input.json', fixtureSha256: createHash('sha256').update(serialized).digest('hex'),
  sourceCommitment: 'Pending independent review and exact-source freeze; no model calls authorized yet.',
  expected: [...prior.expected, { id: 'unboundBody', spec: 'spec', submission: 'unboundBody', normalizationReject: true, modelCalls: 0 }, { id: 'reorderedClaims', spec: 'spec', submission: 'reorderedClaims', statuses: prior.expected.find(c => c.id === 'positive').statuses, delivery: Array(4).fill('FULFILLED'), verdict: 'ACCEPTED', normalizationMatches: 'positive', initialValidation: 'local normalization only' }],
  guardExpectations: [...prior.guardExpectations, 'Report body must exactly equal normalized statements in locked-criterion order; unbound content rejected', 'Every per-criterion prompt excludes all other statements and full report body'],
  migration: 'New structured-report schema. All report bodies are regenerated from statements in locked-criterion order. Only the missingClaim control changes report content: its old unclaimed permissions paragraph is intentionally removed, while its missing-claim insufficiency oracle is retained. All old v3 source, fixture, plan and failure evidence remain unchanged.',
  initialPublicSimulationLimit: { cases: ['negative', 'positive', 'strictUnknown'], maximumLeaderValidatorPairs: 3, automaticRetries: 0, stopOnFirstFailure: true, safetyStop: 'If both independent paths still mark the clearly false permissions claim SUPPORTED, do not claim automatic semantic acceptance is usable or search prompts until a lucky pass.' },
};
await writeFile(plan.fixtureFile, serialized, { flag: 'wx' });
await writeFile('docs/evidence/v4-validation-plan.json', JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ prepared: true, fixtureSha256: plan.fixtureSha256, cases: plan.expected.length }));
