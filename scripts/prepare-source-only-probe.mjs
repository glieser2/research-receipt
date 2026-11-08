import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonical, normalizeSpec, normalizeBoundSubmission } from './collect-bradbury-evidence.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceFile = 'contracts/research_receipt_source_probe.py';
const fixtureFile = 'artifacts/bradbury/v4-e2e-input.json';
const planFile = 'docs/evidence/source-only-probe-plan.json';
const sourceSha256 = sha(await readFile(sourceFile));
const fixtureBytes = await readFile(fixtureFile);
if (sourceSha256 !== '54e47ed1ebd4c92832723e242dc86acf5d665a0b46a1b0bdc1611ca5d5b47a5d' || sha(fixtureBytes) !== 'a423530364c4c65fd5c3ef23db2e23f1cefa8a27a587f9dbe692ec0453930dfc') throw new Error('Source or prelocked inputs changed.');
const fixture = JSON.parse(fixtureBytes);
const profileBytes = await readFile('src/fee-profile.json');
const profile = JSON.parse(profileBytes);
for (const [key, value] of Object.entries({leaderTimeunitsAllocation:'600', validatorTimeunitsAllocation:'600', executionBudgetPerRound:'10000000000000000', appealRounds:'0'})) if (profile[key] !== value) throw new Error('Original development allocation changed.');
const spec = normalizeSpec(fixture.spec);
const submission = normalizeBoundSubmission(fixture.negative, spec);
const expectedReceipt = { probe_version: 'research-receipt/source-only-probe/1', spec_hash: sha(canonical(spec)), submission_hash: sha(canonical(submission)), source_checks: submission.sources.map((source, index) => ({index, status:'VERIFIED', sha256:source.sha256})), committed_sources: submission.sources };
if (process.argv.includes('--deployment-request')) {
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  if (plan.sourceSha256 !== sourceSha256 || plan.fixtureSha256 !== sha(fixtureBytes) || canonical(plan.expectedReceipt) !== canonical(expectedReceipt) || plan.feeProfileSha256 !== sha(profileBytes)) throw new Error('Frozen diagnostic plan no longer matches.');
  process.stdout.write(JSON.stringify({ op:'deploy', file:sourceFile, args:[JSON.stringify(fixture.spec),JSON.stringify(fixture.negative)], readback:{method:'get_receipt',args:[],expected:canonical(expectedReceipt)} }) + '\n');
} else {
  const plan = { format:'research-receipt/source-only-probe-plan/1', frozenBeforeExecutionAt:new Date().toISOString(), sourceFile, sourceSha256, fixtureFile, fixtureSha256:sha(fixtureBytes), businessSourceSha256:'f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61', expectedReceipt, feeProfileSha256:sha(profileBytes), budget:{leaderTimeunitsAllocation:'600',validatorTimeunitsAllocation:'600',executionBudgetPerRound:'10000000000000000',appealRounds:'0',rotations:[3],maximumInitialLeaderRounds:4}, executionLimit:{deploymentTransactions:1,automaticRetries:0,modelCalls:0,getsPerIndependentExecution:2,activeAppeals:0,topUps:0}, acceptance:'FINALIZED accepted RETURN plus independent source/sender/input/inclusion proof and exact latest-final get_receipt. Both sources must be VERIFIED; matching UNAVAILABLE is a failed experiment.', limits:'A separate committee/time and simpler path. Success or failure does not prove the cause of the old business failure. External third-party appeals can change the number of executions and effective fees; no claim of only two network calls across the whole chain.' };
  await writeFile(planFile, JSON.stringify(plan,null,2)+'\n', {flag:'wx'});
  console.log(JSON.stringify({prepared:true,sourceSha256,fixtureSha256:plan.fixtureSha256,specHash:expectedReceipt.spec_hash,submissionHash:expectedReceipt.submission_hash,planSha256:sha(await readFile(planFile))}));
}
