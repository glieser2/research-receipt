// Pre-broadcast checkpoint only. Prints a short request; never signs or sends.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {connectBradbury,contractSource,publicJson} from './bradbury-client.mjs';
import {sha256} from './probe-public-codec.mjs';
import {compareStructuredResponse} from './probe-structured-assessment.mjs';
const id=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
assert.ok(['positive','negative'].includes(id));
const planBytes=await readFile('docs/evidence/structured-probe-plan.json'),plan=JSON.parse(planBytes);
assert.deepEqual(plan.simulationOrder,['positive','negative','falseCautionOtherSource','unsupportedPromiseAsFactual','boundaryIncomplete']);
assert.deepEqual(plan.committeeOrder,['positive','negative']);
assert.equal((await contractSource(plan.sourceFile)).sourceSha256,plan.sourceSha256);
assert.equal(sha256(await readFile(plan.fixtureFile)),plan.fixtureSha256);
assert.equal(sha256(await readFile('src/fee-profile.json')),plan.feeProfileSha256);
for(const prior of plan.simulationOrder){
 const r=JSON.parse(await readFile(`artifacts/bradbury/structured-probe/${plan.sourceSha256}-${prior}.json`));
 assert.equal(r.case,prior);assert.equal(r.planSha256,sha256(planBytes));assert.equal(r.sourceSha256,plan.sourceSha256);assert.equal(r.fixtureSha256,plan.fixtureSha256);
 const expected=plan.expected.find(x=>x.id===prior);
 assert.ok(r.result?.passed===true&&r.genCallsStarted===2&&r.leader&&r.validator&&compareStructuredResponse(r.leader,expected)&&compareStructuredResponse(r.validator,expected,{validator:true}));
}
const actor='0x29EB14D10ec2E406E5d1419ED08D803b8B18aB70';
const session=JSON.parse(await readFile(`artifacts/bradbury/session-${actor.toLowerCase()}.json`));
assert.ok(Array.isArray(session.transactions),'The known signer session must retain its transaction history');
assert.equal(session.sessionAddress?.toLowerCase(),actor.toLowerCase());assert.equal(session.actors?.owner?.toLowerCase(),actor.toLowerCase());
const operations=session.transactions.filter(x=>x.operation==='deploy'&&x.sourceSha256===plan.sourceSha256);
if(id==='positive')assert.equal(operations.length,0,'A recorded deployment consumes this case; do not resubmit');
else{
 const proof=JSON.parse(await readFile('docs/evidence/structured-probe-positive-independent.json'));
 assert.equal(proof.fullyVerified,true);assert.equal(proof.case,'positive');assert.equal(proof.planSha256,sha256(planBytes));assert.equal(proof.sourceVerification?.sourceSha256,plan.sourceSha256);
 assert.equal(operations.length,1);assert.equal(operations[0].hash,proof.protocolTxId);
}
const request={op:'deploy',file:plan.sourceFile,inputFile:plan.fixtureFile,case:id};
assert.ok(Buffer.byteLength(JSON.stringify(request))<3000,'Keep PTY transport request short; full receipt is verified independently');
const connection=await connectBradbury();
const [pendingNonce,latestNonce,block,balance]=await Promise.all([connection.publicClient.getTransactionCount({address:actor,blockTag:'pending'}),connection.publicClient.getTransactionCount({address:actor,blockTag:'latest'}),connection.publicClient.getBlockNumber(),connection.client.getBalance({address:actor})]);
assert.equal(pendingNonce,latestNonce,'An existing envelope is pending; resolve it before a new deployment');
const checkpoint={format:'research-receipt/structured-deployment-intent/1',preparedAt:new Date().toISOString(),case:id,actor,sourceSha256:plan.sourceSha256,fixtureSha256:plan.fixtureSha256,planSha256:sha256(planBytes),submittedAfterBlock:block.toString(),preNonce:latestNonce,preBalanceWei:String(balance),request,automaticResubmission:false,scope:'At most one deployment for this case. On an unknown send outcome inspect this nonce and public session operations; never prepare another request.'};
const file=`artifacts/bradbury/structured-probe/${id}-deployment-intent.json`;
await writeFile(file,publicJson(checkpoint)+'\n',{flag:'wx'});
console.log(publicJson({prepared:true,checkpoint:file,submittedAfterBlock:block.toString(),preNonce:latestNonce,request}));
