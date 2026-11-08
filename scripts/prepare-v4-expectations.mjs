import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const old = JSON.parse(await readFile('artifacts/bradbury/e2e-expectations-scoped.json', 'utf8'));
const proof = JSON.parse(await readFile('docs/evidence/bradbury-v4-deployment-independent.json', 'utf8'));
const planFile = 'docs/evidence/v4-validation-plan.json';
const planBytes = await readFile(planFile);
const plan = JSON.parse(planBytes);
const sha = value => createHash('sha256').update(value).digest('hex');
if (!proof.fullyVerified || !proof.readback?.verified || proof.readback.value !== 0 || proof.sourceVerification?.sourceSha256 !== plan.sourceCommitment.sha256 || sha(await readFile(plan.sourceCommitment.file)) !== plan.sourceCommitment.sha256 || sha(await readFile(plan.fixtureFile)) !== plan.fixtureSha256) throw new Error('Require independently verified v4 deployment and immutable zero-order baseline, source and fixture.');
const v2Hashes = [...new Set([...old.mainRelease.priorSuiteHashes, ...Object.values(old.caseHashes).filter(hash => hash !== old.mainRelease.deploymentHash)])];
const config = {
  format: 'research-receipt/bradbury-expectations/1', policyVersion: plan.policyVersion, suiteComplete: false,
  mainRelease: { contractAddress: proof.contractAddress, sourceSha256: plan.sourceCommitment.sha256, deploymentHash: proof.protocolTxId, sourceFile: plan.sourceCommitment.file, priorSuiteHashes: [] },
  historicalReleases: [...old.historicalReleases, { contractAddress: old.mainRelease.contractAddress, sourceSha256: old.mainRelease.sourceSha256, deploymentHash: old.mainRelease.deploymentHash, sourceFile: 'contracts/archive/research_receipt_v2.py', caseHashes: v2Hashes }],
  diagnosticAttempts: [...old.diagnosticAttempts, { case: 'v2-scope-evaluateContradicted', caseType: 'evaluateContradicted', attempt: 1, hash: old.caseHashes.evaluateContradicted, observedOutcome: 'MAJORITY_DISAGREE', retryPolicy: 'Stopped; no repeated chain request. v3 simulation later exposed semantic false support and was not deployed; v4 changes structured input and per-criterion tasks under a new prelocked plan.' }],
  caseHashes: { deployment: proof.protocolTxId },
  orderIds: { correction: 1, hashMismatch: 2, unauthorized: 3, strictUnknown: 4 }, expectedOrderCount: 4,
  fixtureFile: plan.fixtureFile, fixtureSha256: plan.fixtureSha256,
  validationPlanFile: planFile, validationPlanSha256: sha(planBytes),
};
await writeFile('artifacts/bradbury/e2e-expectations-v4.json', JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ prepared: true, requiredPublicCases: 18, historicalTransactions: old.historicalReleases.reduce((n, release) => n + release.caseHashes.length + 1, 0) + v2Hashes.length + 1 }));
