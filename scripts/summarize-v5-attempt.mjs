// Offline evidence extraction only. Does not run models, fetch sources or sign.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {consensusAccepted,executionSucceeded,executionReverted,finalizedUndetermined} from '../src/lib/protocol-outcome.mjs';
import {validateEvidenceSnapshot} from '../src/lib/evidence-snapshot.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const load=async file=>{const bytes=await readFile(file);return {file,sha256:sha(bytes),value:JSON.parse(bytes)};};
const config=await load('artifacts/bradbury/e2e-expectations-v5.json');
assert.equal(config.value.suiteComplete,false);
assert.equal(config.value.mainRelease.sourceSha256,'60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65');
const diagnostic=await load('artifacts/bradbury/consensus-diagnostic-0x016b18b61ec9f10c24299d5245c96778666b6a4e6c32a6382fb1dcc33ab41ba0.json');
const attempts=[];
for(const [name,hash]of Object.entries(config.value.caseHashes)){
 if(name==='deployment'){
  const proof=await load('docs/evidence/bradbury-v5-deployment-independent.json');
  assert.equal(proof.value.protocolTxId,hash);assert.equal(proof.value.fullyVerified,true);
  attempts.push({name,protocolTxId:hash,status:proof.value.status,result:proof.value.consensusResult,execution:proof.value.execution,consensusAccepted:true,executionSucceeded:true,deploymentProof:{file:proof.file,sha256:proof.sha256}});continue;
 }
 const {file,sha256,value:tx}=await load(`artifacts/bradbury/${hash}.json`);
 assert.equal(tx.txId.toLowerCase(),hash.toLowerCase());
 attempts.push({name,protocolTxId:hash,status:tx.statusName,result:tx.resultName,lifecycle:tx.lifecycle,execution:tx.txExecutionResultName,consensusAccepted:consensusAccepted(tx),executionSucceeded:executionSucceeded(tx),expectedRevert:['evaluateBeforeEvidence','duplicateEvidenceSnapshot'].includes(name)&&consensusAccepted(tx)&&executionReverted(tx),finalizedUndetermined:finalizedUndetermined(tx),rawArtifact:{file,sha256,published:false}});
}
assert.equal(attempts.length,10);assert.equal(attempts.at(-1).finalizedUndetermined,true);
const readbacks=[];
for(const file of ['artifacts/bradbury/readbacks/v5-snapshot-1-1.json','artifacts/bradbury/readbacks/v5-assessment-1-1.json','artifacts/bradbury/readbacks/v5-snapshot-1-2.json']){
 const capture=await load(file),r=capture.value;
 const verified=await validateEvidenceSnapshot({snapshot:r.snapshot,order:r.order,revision:r.revision,expectedRevision:r.revision.revision,assessment:r.assessment});
 readbacks.push({file,sha256:capture.sha256,observedAt:r.observedAt,variant:r.variant,orderId:r.order.id,revision:r.revision.revision,...verified,assessment:r.assessment?{snapshot_hash:r.assessment.snapshot_hash,verdict:r.assessment.verdict,findings:r.assessment.findings.map(({criterion_id,status,delivery_status,evidence_indices})=>({criterion_id,status,delivery_status,evidence_indices}))}:null});
}
const summary={format:'research-receipt/bradbury-v5-incomplete-attempt/1',generatedAt:new Date().toISOString(),policyVersion:'research-receipt/5',contractAddress:config.value.mainRelease.contractAddress,sourceSha256:config.value.mainRelease.sourceSha256,deploymentProof:'bradbury-v5-deployment-independent.json',suiteComplete:false,allRequiredCasesPassed:false,stopReason:'Corrected assessment finalized MAJORITY_DISAGREE; no subsequent business case or resampling was sent.',attempts,readbacks,publicFailure:{protocolTxId:diagnostic.value.protocolTxId,status:diagnostic.value.status,result:diagnostic.value.resultName,votes:diagnostic.value.lastRound.validatorVotesName,leaderOutputs:diagnostic.value.decodedPublicLeaderOutputs,rawArtifact:{file:diagnostic.file,sha256:diagnostic.sha256,published:false}},limits:['Negative and source-snapshot successes do not establish complete application acceptance.','Public leader explanations and stored votes do not expose private validator reasoning or identify the timeout cause.','Historical inputs and expected outcomes have not been changed to make this failure pass.','The later typed diagnostic uses a new schema and more explicit scope; it cannot retrospectively validate this release.']};
await writeFile('docs/evidence/bradbury-v5-attempt.json',JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({saved:'docs/evidence/bradbury-v5-attempt.json',attempts:attempts.length,readbacks:readbacks.length,suiteComplete:false}));
