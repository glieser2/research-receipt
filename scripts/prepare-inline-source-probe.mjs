import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonical, normalizeSpec, normalizeBoundSubmission } from './collect-bradbury-evidence.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceFile = 'contracts/research_receipt_inline_probe.py';
const fixtureFile = 'artifacts/bradbury/inline-probe-input.json';
const planFile = 'docs/evidence/inline-source-probe-plan.json';
const sourceSha256 = sha(await readFile(sourceFile));
const bytes = await readFile(fixtureFile);
if (sourceSha256 !== 'ded346ad9d6b8f454401074b95b246e25526075cc809122726165ecf8d2ad75c' || sha(bytes) !== 'c9e9884c2467106aa76449f28830f8323e831801450ee0f012bae9429606bb96') throw new Error('Frozen source or inputs changed.');
const proof = JSON.parse(await readFile('docs/evidence/source-only-probe-independent.json','utf8'));
if (!proof.fullyVerified) throw new Error('The source-only prerequisite has not passed.');
const input = JSON.parse(bytes).negative;
const spec = normalizeSpec(input.spec), submission = normalizeBoundSubmission(input.submission,spec);
for (let i=0;i<2;i++) { const material = Buffer.from(input.materials[i],'utf8'), source = submission.sources[i]; if (material.length!==source.byte_length || sha(material)!==source.sha256) throw new Error('Pinned source bytes changed.'); }
const originalPlan = JSON.parse(await readFile('docs/evidence/v4-validation-plan.json','utf8'));
const oracle = originalPlan.expected.find(row=>row.id==='negative');
const expectedReceipt = { probe_version:'research-receipt/inline-source-probe/1', spec_hash:sha(canonical(spec)), submission_hash:sha(canonical(submission)), assessment:{verdict:oracle.verdict,findings:spec.criteria.map((criterion,index)=>({criterion_id:criterion.id,status:oracle.statuses[index],delivery_status:oracle.delivery[index],evidence_indices:submission.claims.find(c=>c.criterion_id===criterion.id).evidence_indices})),source_checks:submission.sources.map((source,index)=>({index,status:'VERIFIED',sha256:source.sha256}))} };
const feeProfileSha256 = sha(await readFile('src/fee-profile.json'));
if (process.argv.includes('--deployment-request')) {
  const plan=JSON.parse(await readFile(planFile,'utf8'));
  if (plan.sourceSha256!==sourceSha256 || plan.fixtureSha256!==sha(bytes) || plan.feeProfileSha256!==feeProfileSha256 || canonical(plan.expectedReceipt)!==canonical(expectedReceipt)) throw new Error('Diagnostic plan mismatch.');
  const request={op:'deploy',file:sourceFile,inputFile:fixtureFile,case:'negative',readback:{method:'get_receipt',args:[],expected:canonical(expectedReceipt)}};
  if (Buffer.byteLength(JSON.stringify(request))>3000) throw new Error('PTY request must stay short.');
  console.log(JSON.stringify(request));
} else {
  const plan={format:'research-receipt/inline-source-probe-plan/1',frozenBeforeExecutionAt:new Date().toISOString(),sourceFile,sourceSha256,fixtureFile,fixtureSha256:sha(bytes),feeProfileSha256,businessSourceSha256:'f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61',sourcePrerequisiteProofFile:'docs/evidence/source-only-probe-independent.json',sourcePrerequisiteProofSha256:sha(await readFile('docs/evidence/source-only-probe-independent.json')),expectedReceipt,budget:{leaderTimeunitsAllocation:'600',validatorTimeunitsAllocation:'600',executionBudgetPerRound:'10000000000000000',appealRounds:'0',rotations:[3],maximumInitialLeaderRounds:4},executionLimit:{deploymentTransactions:1,automaticRetries:0,getsPerIndependentExecution:0,initialModelCallsPerIndependentExecution:4,maximumFormatRepairCallsPerIndependentExecution:1,activeAppeals:0,topUps:0},acceptance:'FINALIZED accepted RETURN, independently verified source/sender/constructor inputs/inclusion, and exact complete latest-final get_receipt equality including every status, delivery, reference and source hash. Aggregate verdict alone is insufficient.',limits:'A new committee and time, and a different execution path. Results cannot prove the old private-validator cause or production stability. Actual network/model calls across committees, rotations and outside appeals may exceed a single independent execution.'};
  await writeFile(planFile,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({prepared:true,sourceSha256,fixtureSha256:sha(bytes),planSha256:sha(await readFile(planFile)),expectedReceipt}));
}
