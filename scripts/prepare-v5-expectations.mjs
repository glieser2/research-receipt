import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const old=JSON.parse(await readFile('artifacts/bradbury/e2e-expectations-v4.json','utf8'));
const proof=JSON.parse(await readFile('docs/evidence/bradbury-v5-deployment-independent.json','utf8'));
const planFile='docs/evidence/v5-validation-plan.json',planBytes=await readFile(planFile),plan=JSON.parse(planBytes);
if(!proof.fullyVerified||proof.readback?.value!==0||proof.sourceVerification?.sourceSha256!==plan.sourceCommitment.sha256||sha(await readFile(plan.sourceCommitment.file))!==plan.sourceCommitment.sha256||sha(await readFile(plan.fixtureFile))!==plan.fixtureSha256)throw new Error('Need verified v5 identity and immutable zero baseline.');
const auxiliaryDeployments=[];
for(const entry of [{kind:'source-only-probe',sourceFile:'contracts/research_receipt_source_probe.py',proofFile:'docs/evidence/source-only-probe-independent.json'},{kind:'inline-source-probe',sourceFile:'contracts/research_receipt_inline_probe.py',proofFile:'docs/evidence/inline-source-probe-independent.json'}]){
 const bytes=await readFile(entry.proofFile),p=JSON.parse(bytes);if(!p.fullyVerified)throw new Error('Auxiliary proof incomplete');
 const sourceSha256=sha(await readFile(entry.sourceFile));if(p.sourceVerification?.sourceSha256!==sourceSha256)throw new Error('Auxiliary source mismatch');
 auxiliaryDeployments.push({...entry,contractAddress:p.contractAddress,deploymentHash:p.protocolTxId,sourceSha256,proofSha256:sha(bytes)});
}
const v4Cases=[...new Set([...old.mainRelease.priorSuiteHashes,...Object.values(old.caseHashes).filter(h=>h!==old.mainRelease.deploymentHash)])];
const config={format:'research-receipt/bradbury-expectations/1',policyVersion:'research-receipt/5',suiteComplete:false,mainRelease:{contractAddress:proof.contractAddress,sourceSha256:plan.sourceCommitment.sha256,deploymentHash:proof.protocolTxId,sourceFile:plan.sourceCommitment.file,priorSuiteHashes:[]},historicalReleases:[...old.historicalReleases,{contractAddress:old.mainRelease.contractAddress,sourceSha256:old.mainRelease.sourceSha256,deploymentHash:old.mainRelease.deploymentHash,sourceFile:'contracts/archive/research_receipt_v4_f5a656.py',caseHashes:v4Cases}],auxiliaryDeployments,diagnosticAttempts:[...old.diagnosticAttempts,{case:'v4-evaluateContradicted',caseType:'evaluateContradicted',attempt:1,hash:old.caseHashes.evaluateContradicted,observedOutcome:'MAJORITY_DISAGREE',retryPolicy:'Stopped. Public leader matched oracle; private-validator causes unknown. Separate source-only and inline diagnostics are not business success or retries.'}],caseHashes:{deployment:proof.protocolTxId},orderIds:{correction:1,hashMismatch:2,unauthorized:3,strictUnknown:4},expectedOrderCount:4,fixtureFile:plan.fixtureFile,fixtureSha256:plan.fixtureSha256,validationPlanFile:planFile,validationPlanSha256:sha(planBytes)};
await writeFile('artifacts/bradbury/e2e-expectations-v5.json',JSON.stringify(config,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({prepared:true,requiredCases:24,historicalTransactions:config.historicalReleases.reduce((n,r)=>n+r.caseHashes.length+1,0),auxiliaryTransactions:auxiliaryDeployments.length,address:proof.contractAddress}));
