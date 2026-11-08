import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  CASES, RETAINED_RELEASES, AUXILIARY_RELEASES, validateExpectations, requiredCaseChecks,
  releaseAssignments, attemptAccounting, validateAuxiliaryProof, auxiliaryFreshMatches,
  validateCollectedSnapshot, evidenceStageChecks, snapshotPlanMatches, canonical, v3AssessmentPolicyValid,
} from '../../scripts/collect-bradbury-evidence.mjs';
import { hashEvidenceJson, evidenceContentFingerprint } from '../../src/lib/evidence-snapshot.mjs';

// All protocol rows below are explicit offline doubles. No RPC, signing or collect.
const hash = n => '0x'+n.toString(16).padStart(64,'0');
const address = n => '0x'+n.toString(16).padStart(40,'0');
const sha = value => createHash('sha256').update(value).digest('hex');
async function base() {
  const auxiliaryDeployments=await Promise.all(AUXILIARY_RELEASES.map(async row=>({...row,proofSha256:sha(await readFile(new URL('../../'+row.proofFile,import.meta.url)))})));
  return {format:'research-receipt/bradbury-expectations/1',policyVersion:'research-receipt/5',suiteComplete:true,
    mainRelease:{contractAddress:address(9),sourceSha256:'c'.repeat(64),deploymentHash:hash(1000),sourceFile:'contracts/research_receipt.py'},
    historicalReleases:RETAINED_RELEASES.map((row,index)=>({contractAddress:row.contractAddress,sourceSha256:row.sourceSha256,deploymentHash:row.deploymentHash,sourceFile:index===2?'contracts/archive/research_receipt_v4_f5a656.py':`contracts/archive/research_receipt_v${index+1}.py`,caseHashes:[...row.hashes]})),
    auxiliaryDeployments,caseHashes:Object.fromEntries(Object.keys(CASES).map((key,index)=>[key,key==='deployment'?hash(1000):hash(1001+index)])),
    fixtureFile:'tests/fixtures/bradbury-inline-probe-input.json',fixtureSha256:'a'.repeat(64),validationPlanFile:'docs/evidence/v5-validation-plan.json',validationPlanSha256:'b'.repeat(64),
    orderIds:{correction:1,hashMismatch:2,unauthorized:3,strictUnknown:4},expectedOrderCount:4};
}

test('V5 locks exactly 24 business cases and retains 23 older transactions in separate profiles',async()=>{
  const config=validateExpectations(await base());
  assert.equal(Object.keys(requiredCaseChecks(config,[])).length,24);
  assert.equal(Object.values(requiredCaseChecks(config,[])).some(Boolean),false);
  const profiles=releaseAssignments(config);
  assert.equal([...profiles.values()].filter(row=>row.kind==='historical').length,21);
  assert.equal([...profiles.values()].filter(row=>row.kind==='auxiliary').length,2);
  assert.equal([...profiles.values()].filter(row=>row.kind==='main').length,24);
  for(const auxiliary of config.auxiliaryDeployments)assert.equal(profiles.get(auxiliary.deploymentHash).kind,'auxiliary');
});

test('V5 refuses omitted old failures, mutable V4 source paths and missing auxiliary identity',async()=>{
  const value=await base();
  let changed=structuredClone(value);changed.historicalReleases[0].caseHashes.pop();
  assert.throws(()=>validateExpectations(changed),/21 historical/);
  changed=structuredClone(value);changed.historicalReleases[2].sourceFile='contracts/research_receipt.py';
  assert.throws(()=>validateExpectations(changed),/frozen source archive/);
  changed=structuredClone(value);changed.auxiliaryDeployments.pop();
  assert.throws(()=>validateExpectations(changed),/both auxiliary/);
  changed=structuredClone(value);changed.auxiliaryDeployments[0].sourceSha256='0'.repeat(64);
  assert.throws(()=>validateExpectations(changed),/auxiliary deployment identity/);
  changed=structuredClone(value);changed.validationPlanSha256=undefined;
  assert.throws(()=>validateExpectations(changed),/frozen/);
});

test('auxiliary deployments cannot satisfy business cases or be reassigned to another release',async()=>{
  const value=await base();
  value.caseHashes.evaluateContradicted=value.auxiliaryDeployments[0].deploymentHash;
  assert.throws(()=>validateExpectations(value),/multiple release profiles/);
  const old=await base();old.policyVersion='research-receipt/4';
  assert.throws(()=>validateExpectations(old),/V5 policy/);
});

test('historical undetermined attempts remain visible while all 24 required-case rows may pass',async()=>{
  const value=await base();
  const failed=value.historicalReleases[0].caseHashes[2];
  value.diagnosticAttempts=[{case:'v1-evaluateContradicted',caseType:'evaluateContradicted',attempt:1,hash:failed,observedOutcome:'NO_MAJORITY',retryPolicy:'Preserve failed history; no implicit cross-release retry.'}];
  const config=validateExpectations(value), assignments=releaseAssignments(config), transactions=[];
  for(const [id,protocolTxId] of Object.entries(config.caseHashes))transactions.push({protocolTxId,caseId:id,operation:CASES[id][0],releaseKind:'main',verified:true,consensusAccepted:true,identityAndInclusionVerified:true,execution:CASES[id][1]?'FINISHED_WITH_ERROR':'FINISHED_WITH_RETURN'});
  for(const [protocolTxId,profile] of assignments)if(profile.kind!=='main')transactions.push({protocolTxId,operation:protocolTxId===profile.deploymentHash?'deploy':'evaluate',releaseKind:profile.kind,verified:protocolTxId!==failed,consensusAccepted:protocolTxId!==failed,identityAndInclusionVerified:true,execution:'FINISHED_WITH_RETURN',finalized:true,consensusOutcome:protocolTxId===failed?'undetermined':'accepted',consensusResult:protocolTxId===failed?'NO_MAJORITY':'MAJORITY_AGREE'});
  const raw=new Map([[failed,{statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:{outcome:'undetermined'},resultName:'NO_MAJORITY',result:5,txDataDecoded:{type:'call',callData:new Map([['','evaluate'],['args',[1n,1n]]])}}]]);
  const tracked=transactions.map(row=>({hash:row.protocolTxId}));
  const accounting=attemptAccounting(config,transactions,tracked,raw);
  assert.equal(Object.values(requiredCaseChecks(config,transactions)).every(Boolean),true);
  assert.equal(accounting.allAttemptsConsensusAccepted,false);
  assert.equal(accounting.everyTrackedAttemptFinalAndIncluded,true);
  assert.equal(accounting.attemptStatistics.trackedTotal,47);
  assert.equal(accounting.attemptStatistics.finalizedUndeterminedAttempts,1);
  assert.equal(accounting.allAuxiliaryRecordsVerified,true);
  const missing=attemptAccounting(config,transactions,tracked.filter(row=>row.hash!==config.auxiliaryDeployments[0].deploymentHash),raw);
  assert.equal(missing.allAuxiliaryRecordsVerified,false);
  assert.deepEqual(missing.missingDeclaredAuxiliaryTransactions,[config.auxiliaryDeployments[0].deploymentHash]);
});

test('existing auxiliary independent proofs are identity-bound and fresh inclusion/readback must match',async()=>{
  for(const profile of AUXILIARY_RELEASES) {
    const proof=JSON.parse(await readFile(new URL('../../'+profile.proofFile,import.meta.url),'utf8'));
    assert.equal(validateAuxiliaryProof(profile,proof),true);
    const fresh={identityAndInclusionVerified:true,consensusAccepted:true,execution:'FINISHED_WITH_RETURN',sender:proof.actorAddress,recipient:profile.contractAddress,sourceSha256:profile.sourceSha256,inclusion:proof.blockEvidence};
    assert.equal(auxiliaryFreshMatches(profile,proof,fresh,proof.readback.value),true);
    assert.equal(auxiliaryFreshMatches(profile,proof,{...fresh,inclusion:{...fresh.inclusion,blockHash:hash(222)}},proof.readback.value),false);
    assert.equal(auxiliaryFreshMatches(profile,proof,{...fresh,sender:address(22)},proof.readback.value),false);
    assert.equal(auxiliaryFreshMatches(profile,proof,fresh,'{}'),false);
    const wrong=structuredClone(proof);wrong.sourceVerification.sourceSha256='0'.repeat(64);
    assert.equal(validateAuxiliaryProof(profile,wrong),false);
    const error=structuredClone(proof);error.execution='FINISHED_WITH_ERROR';
    assert.equal(validateAuxiliaryProof(profile,error),false);
    const unproven=structuredClone(proof);unproven.inputVerification.leaderOnly=true;
    assert.equal(validateAuxiliaryProof(profile,unproven),false);
  }
});

async function snapshotExample() {
  const material='public source\n', source={url:'https://raw.githubusercontent.com/a/b/'+ 'a'.repeat(40)+'/x',sha256:sha(material),byte_length:Buffer.byteLength(material)};
  const spec={criteria:[{id:'permissions',text:'State a source fact.',required:true,evidence_requirement:'fact_required'}]};
  const submission={report_title:'Test',report_version:'v1',report_body:'Bound statement.',sources:[source],claims:[{criterion_id:'permissions',statement:'Bound statement.',evidence_indices:[0]}]};
  const order={id:1,owner:address(1),policy_version:'research-receipt/5',spec,spec_hash:await hashEvidenceJson(spec)};
  const revision={order_id:1,revision:1,submission,submission_hash:await hashEvidenceJson(submission),content_hash:await evidenceContentFingerprint(submission)};
  const checks=[{index:0,status:'VERIFIED',sha256:source.sha256}];
  const snapshot={snapshot_version:'research-receipt/evidence-snapshot/1',binding:{policy_version:order.policy_version,order_id:1,revision:1,spec_hash:order.spec_hash,submission_hash:revision.submission_hash,content_hash:revision.content_hash,sources:[source]},source_checks:checks,materials:[material]};
  snapshot.snapshot_hash=await hashEvidenceJson(snapshot);
  const assessment={policy_version:order.policy_version,order_id:1,revision:1,spec_hash:order.spec_hash,submission_hash:revision.submission_hash,content_hash:revision.content_hash,snapshot_hash:snapshot.snapshot_hash,source_checks:checks,verdict:'ACCEPTED',findings:[{criterion_id:'permissions',status:'SUPPORTED',delivery_status:'FULFILLED',evidence_indices:[0],reason:'Offline scripted finding.'}]};
  return {snapshot,order,revision,expectedRevision:1,assessment};
}

test('collector reuses shared strict snapshot binding, byte and assessment-source validation',async()=>{
  const valid=await snapshotExample();
  assert.equal((await validateCollectedSnapshot(valid)).allVerified,true);
  assert.equal(v3AssessmentPolicyValid(valid.order,valid.revision,valid.assessment),true);
  let changed=structuredClone(valid);changed.snapshot.binding.revision=2;
  await assert.rejects(validateCollectedSnapshot(changed),/RR_SNAPSHOT_BINDING/);
  changed=structuredClone(valid);changed.snapshot.materials[0]+='changed';
  await assert.rejects(validateCollectedSnapshot(changed),/MATERIAL_COMMITMENT/);
  changed=structuredClone(valid);changed.snapshot.materials.push('unused hidden bytes');
  await assert.rejects(validateCollectedSnapshot(changed),/SOURCE_COUNT/);
  changed=structuredClone(valid);changed.assessment.snapshot_hash='0'.repeat(64);
  await assert.rejects(validateCollectedSnapshot(changed),/ASSESSMENT_BINDING/);
  changed=structuredClone(valid);changed.assessment.source_checks=[{index:0,status:'UNAVAILABLE',sha256:''}];
  await assert.rejects(validateCollectedSnapshot(changed),/ASSESSMENT_BINDING/);
});

test('failed snapshot sources must be null and cannot be converted to supported model findings',async()=>{
  const value=await snapshotExample();
  value.snapshot.source_checks[0]={index:0,status:'HASH_MISMATCH',sha256:'b'.repeat(64)};
  value.assessment.source_checks=structuredClone(value.snapshot.source_checks);
  await assert.rejects(validateCollectedSnapshot(value),/FAILED_MATERIAL/);
  value.snapshot.materials[0]=null;
  delete value.snapshot.snapshot_hash;value.snapshot.snapshot_hash=await hashEvidenceJson(value.snapshot);
  value.assessment.snapshot_hash=value.snapshot.snapshot_hash;
  assert.equal((await validateCollectedSnapshot(value)).allVerified,false);
  assert.equal(v3AssessmentPolicyValid(value.order,value.revision,value.assessment),false);
  value.assessment.verdict='INSUFFICIENT_EVIDENCE';
  value.assessment.findings[0]={criterion_id:'permissions',status:'SOURCE_UNAVAILABLE',delivery_status:'INSUFFICIENT',evidence_indices:[],reason:'Source failed verification.'};
  assert.equal(v3AssessmentPolicyValid(value.order,value.revision,value.assessment),true);
});

async function stagedExample() {
  const config=validateExpectations(await base());
  const sequence=['deployment','createCorrectionOrder','submitContradicted','evaluateBeforeEvidence','verifyContradictedEvidence','duplicateEvidenceSnapshot','evaluateContradicted','submitCorrected','verifyCorrectedEvidence','evaluateCorrected','createHashMismatchOrder','submitHashMismatch','verifyHashMismatchEvidence','evaluateHashMismatch','createStrictUnknownOrder','submitStrictUnknown','verifyStrictUnknownEvidence','evaluateStrictUnknown'];
  const transactions=sequence.map((caseId,index)=>({protocolTxId:config.caseHashes[caseId],caseId,sender:address(1),verified:true,execution:CASES[caseId][1]?'FINISHED_WITH_ERROR':'FINISHED_WITH_RETURN',inclusion:{verified:true,blockNumber:String(index+1),logIndex:0}}));
  const coordinates={submitContradicted:[1],evaluateBeforeEvidence:[1,1],verifyContradictedEvidence:[1,1],duplicateEvidenceSnapshot:[1,1],evaluateContradicted:[1,1],submitCorrected:[1],verifyCorrectedEvidence:[1,2],evaluateCorrected:[1,2],submitHashMismatch:[2],verifyHashMismatchEvidence:[2,1],evaluateHashMismatch:[2,1],submitStrictUnknown:[4],verifyStrictUnknownEvidence:[4,1],evaluateStrictUnknown:[4,1]};
  const raw=new Map(Object.entries(coordinates).map(([caseId,args])=>[config.caseHashes[caseId].toLowerCase(),{txDataDecoded:{type:'call',callData:new Map([['',CASES[caseId][0]],['args',args.map(BigInt)]])}}]));
  const baseSnapshot=await snapshotExample(), rev={snapshot:baseSnapshot.snapshot,snapshotValidation:await validateCollectedSnapshot(baseSnapshot),assessment:baseSnapshot.assessment};
  const orders=[{order:{id:1,owner:address(1),spec:{author:address(2)}},revisions:[rev,structuredClone(rev)]},{order:{id:2,owner:address(1),spec:{author:address(2)}},revisions:[structuredClone(rev)]},{order:{id:3,owner:address(1),spec:{author:address(2)}},revisions:[]},{order:{id:4,owner:address(1),spec:{author:address(2)}},revisions:[structuredClone(rev)]}];
  return {config,orders,transactions,raw};
}
test('all four verify calls and two new guards require exact IDs, authorized actors and causal order',async()=>{
  const valid=await stagedExample();
  assert.equal(Object.values(evidenceStageChecks(valid.config,valid.orders,valid.transactions,valid.raw)).every(Boolean),true);
  let changed=structuredClone(valid);changed.transactions.find(row=>row.caseId==='duplicateEvidenceSnapshot').inclusion.blockNumber='100';
  assert.equal(evidenceStageChecks(changed.config,changed.orders,changed.transactions,changed.raw).duplicateEvidenceSnapshotRejectedWithoutStateChange,false);
  changed=structuredClone(valid);changed.transactions.find(row=>row.caseId==='evaluateBeforeEvidence').sender=address(99);
  assert.equal(evidenceStageChecks(changed.config,changed.orders,changed.transactions,changed.raw).evaluateBeforeEvidenceRejectedWithoutStateChange,false);
  changed=structuredClone(valid);changed.transactions.find(row=>row.caseId==='verifyCorrectedEvidence').execution='FINISHED_WITH_ERROR';
  assert.equal(evidenceStageChecks(changed.config,changed.orders,changed.transactions,changed.raw).evidenceVerificationPrecedesEveryAssessment,false);
  changed=structuredClone(valid);changed.orders[0].revisions[0].assessment.source_checks=[];
  assert.equal(evidenceStageChecks(changed.config,changed.orders,changed.transactions,changed.raw).allRevisionSnapshotsAndAssessmentsBound,false);
});

test('four snapshot hashes, all source outcomes and material lengths match the separately prelocked v5 plan',async()=>{
  const plan=JSON.parse(await readFile(new URL('../../docs/evidence/v5-validation-plan.json',import.meta.url),'utf8'));
  const inline=JSON.parse(await readFile(new URL('../fixtures/bradbury-inline-probe-input.json',import.meta.url),'utf8'));
  const config=validateExpectations(await base());
  const orders=[1,2,3,4].map(id=>({order:{id},revisions:[]}));
  for(const row of plan.expectedSnapshots) {
    const snapshot={snapshot_version:'research-receipt/evidence-snapshot/1',binding:row.binding,source_checks:row.sourceChecks,materials:row.sourceChecks.map((check,index)=>check.status==='VERIFIED'?inline.negative.materials[index]:null)};
    snapshot.snapshot_hash=await hashEvidenceJson(snapshot);
    assert.equal(snapshot.snapshot_hash,row.snapshotHash);
    orders.find(item=>item.order.id===row.orderId).revisions[row.revision-1]={snapshot};
  }
  assert.equal(snapshotPlanMatches(config,orders,plan),true);
  const changed=structuredClone(orders);changed[0].revisions[0].snapshot.source_checks[1].status='UNAVAILABLE';
  assert.equal(snapshotPlanMatches(config,changed,plan),false);
  const wrongHash=structuredClone(orders);wrongHash[1].revisions[0].snapshot.snapshot_hash='0'.repeat(64);
  assert.equal(snapshotPlanMatches(config,wrongHash,plan),false);
  const duplicate=structuredClone(plan);duplicate.expectedSnapshots[1]=duplicate.expectedSnapshots[0];
  assert.equal(snapshotPlanMatches(config,orders,duplicate),false);
});
