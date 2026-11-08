// Publish only whitelisted unsigned simulation evidence. No network/model calls.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {sha256} from './probe-public-codec.mjs';
import {compareSufficiencyResponse} from './probe-sufficiency-assessment.mjs';
const planBytes=await readFile('docs/evidence/sufficiency-probe-plan.json'),plan=JSON.parse(planBytes),attempts=[];
assert.equal(sha256(await readFile(plan.sourceFile)),plan.sourceSha256);
assert.equal(sha256(await readFile(plan.fixtureFile)),plan.fixtureSha256);
let failure=false,gap=false;
for(const id of plan.simulationOrder){
 const file=`artifacts/bradbury/sufficiency-probe/${plan.sourceSha256}-${id}.json`;
 let bytes;try{bytes=await readFile(file);}catch(e){if(e.code==='ENOENT'){gap=true;attempts.push({case:id,executed:false});continue;}throw e;}
 const r=JSON.parse(bytes);assert.ok(r.completedAt,'Do not summarize an in-flight call');
 assert.equal(r.case,id);assert.equal(r.planSha256,sha256(planBytes));assert.equal(r.sourceSha256,plan.sourceSha256);assert.equal(r.fixtureSha256,plan.fixtureSha256);assert.ok(!failure&&!gap,'No case may execute after a failed or missing case');
 const item=plan.expected.find(x=>x.id===id),passed=!!r.leader&&!!r.validator&&compareSufficiencyResponse(r.leader,item)&&compareSufficiencyResponse(r.validator,item,{validator:true});
 assert.equal(passed,r.result?.passed===true);failure=!passed;
 const phase=v=>v?{status:v.status,nondetDisagreementCallNo:v.nondetDisagreementCallNo,syncedBlock:v.syncedBlock,markers:v.markers}:null;
 attempts.push({case:id,executed:true,startedAt:r.startedAt,completedAt:r.completedAt,genCallsStarted:r.genCallsStarted,leader:phase(r.leader),validator:phase(r.validator),matchedCompletePrelockedOracle:passed,error:r.error||null,rawArtifact:{file,sha256:sha256(bytes),published:false}});
}
const summary={format:'research-receipt/sufficiency-review-public-simulations/1',generatedAt:new Date().toISOString(),sourceFile:plan.sourceFile,sourceSha256:plan.sourceSha256,fixtureFile:'tests/fixtures/bradbury-structured-probe-input.json',fixtureSha256:plan.fixtureSha256,planFile:'sufficiency-probe-plan.json',planSha256:sha256(planBytes),chainTransactionsSent:0,allPlannedPairsPassed:attempts.length===5&&attempts.every(a=>a.executed&&a.matchedCompletePrelockedOracle),genCallsStarted:attempts.reduce((n,a)=>n+(a.genCallsStarted||0),0),attempts,limits:plan.limits};
await writeFile('docs/evidence/sufficiency-probe-simulations.json',JSON.stringify(summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({saved:'docs/evidence/sufficiency-probe-simulations.json',allPlannedPairsPassed:summary.allPlannedPairsPassed,genCallsStarted:summary.genCallsStarted,chainTransactionsSent:0}));
