import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { encodeEventTopics } from 'viem';
import { abi } from 'genlayer-js';
import {
  loadV6Inputs,expectedCaseArgs,validateV6Ledger,validateCaseReadbacks,assessmentProjection,
  transactionOutcome,verifyTransactionIdentity,verifyHistoryAccounting,verifyV6Inclusion,
  validateTransportAddendum,validateManualTransportProof,runtimeTransactionDatetime,expectedGuardMessage,validateExpectedGuardError,notCollectedEvidence,HISTORICAL_TRANSACTIONS,HISTORICAL_UNDETERMINED,
  PLAN_SHA256,DEPLOYMENT_SOURCE_SHA256,COLLECT_ACK,collectV6Evidence,
} from '../../scripts/collect-v6-evidence.mjs';
import { canonicalEvidenceJson } from '../../src/lib/evidence-snapshot.mjs';
import { BRADBURY } from '../../scripts/bradbury-client.mjs';

// Every transaction, receipt and read in this file is an offline double.
// Frozen fixture outputs are collector acceptance oracles, never live successes.
const hash=n=>'0x'+n.toString(16).padStart(64,'0');
const address=n=>'0x'+n.toString(16).padStart(40,'0');
const sha=value=>createHash('sha256').update(value).digest('hex');
const owner='0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70';
const root=new URL('../../',import.meta.url);
const inputPromise=loadV6Inputs();
const iso=ms=>new Date(Date.UTC(2026,10,5,15,0,0)+ms).toISOString();
const runtimeIso=ms=>iso(ms).replace('.000Z','Z');
const release={contractAddress:address(99),deploymentHash:hash(1001),sourceSha256:DEPLOYMENT_SOURCE_SHA256};
const read=(method,args,value,observedAt)=>({method,args,variant:'latest-final',value:structuredClone(value),observedAt});

function normalizedSubmission(value,spec) {
  const claimMap=new Map(value.claims.map(claim=>[claim.criterion_id,claim]));
  return {...structuredClone(value),claims:spec.criteria.filter(row=>claimMap.has(row.id)).map(row=>{
    const claim=structuredClone(claimMap.get(row.id));
    if(claim.claim_type!=='unknown_disclosure'){claim.statement=claim.statement.trim();claim.evidence_indices.sort((a,b)=>a-b);}
    return claim;
  })};
}

async function offlineLedger(inputs,count=51) {
  const ledger={format:'research-receipt/v6-execution-ledger/1',planSha256:PLAN_SHA256,fixtureSha256:inputs.plan.fixtureSha256,release:structuredClone(release),attempts:[],transportFailures:[]};
  const orders=new Map(),revisions=new Map(),snapshots=new Map(),assessments=new Map();let orderCount=0;
  function stateReads(planned,at) {
    const result=[read('get_order_count',[],orderCount,at)];
    if(planned.op==='deploy')return [...result,read('get_policy_version',[],'research-receipt/6',at),read('get_field_catalog',[],JSON.stringify(inputs.catalog),at)];
    const id=planned.readbackOracle.orderId,order=orders.get(id);
    result.push(read('get_order',[id],JSON.stringify(order),at));
    if(order) {
      result.push(read('get_order_id',[order.spec.client_ref],id,at));
      for(let number=1;number<=Math.max(1,order.revision_count);number++) {
        const key=`${id}:${number}`;
        if(revisions.has(key))result.push(read('get_revision',[id,number],JSON.stringify(revisions.get(key)),at));
        result.push(read('get_evidence_snapshot',[id,number],snapshots.has(key)?JSON.stringify(snapshots.get(key)):'',at));
        result.push(read('get_assessment',[id,number],assessments.has(key)?JSON.stringify(assessments.get(key)):'',at));
      }
    }
    if(planned.readbackOracle.absentRevision)result.push({method:'get_revision',args:[id,1],variant:'latest-final',error:{message:'Revision not found'},observedAt:at});
    return result;
  }
  for(const planned of inputs.plan.cases.slice(0,count)) {
    const time=planned.sequence*1000,oracle=planned.readbackOracle;
    const beforeReads=planned.op==='deploy'?[]:stateReads(planned,iso(time-100));
    if(!oracle.rollback && planned.method==='create_order') {
      const spec={...structuredClone(inputs.fixture[planned.inputCase]),author:inputs.fixture[planned.inputCase].author.toLowerCase()};
      orders.set(oracle.orderId,{id:oracle.orderId,owner,spec,policy_version:'research-receipt/6',spec_hash:oracle.specHash,revision_count:0,status:'OPEN',created_at:iso(time)});orderCount++;
    } else if(!oracle.rollback && planned.method==='submit_revision') {
      const order=orders.get(oracle.orderId),number=oracle.revision,key=`${order.id}:${number}`;
      const submission=normalizedSubmission(inputs.fixture[planned.inputCase],order.spec);
      revisions.set(key,{order_id:order.id,revision:number,submission,submission_hash:oracle.submissionHash,content_hash:oracle.contentHash,previous_submission_hash:oracle.previousSubmissionHash,submitted_by:owner,submitted_at:iso(time)});
      order.revision_count=number;order.status='SUBMITTED';
    } else if(!oracle.rollback && planned.method==='verify_evidence') {
      const expected=inputs.plan.expected.find(row=>row.id===oracle.expectedContext);
      const {materialCommitments,...snapshot}=structuredClone(expected.snapshot);
      snapshots.set(`${expected.orderId}:${expected.revision}`,{...snapshot,materials:materialCommitments.map((row,index)=>row.stored_material===null?null:inputs.materials[index])});
    } else if(!oracle.rollback && planned.method==='evaluate') {
      const expected=inputs.plan.expected.find(row=>row.id===oracle.expectedContext);
      assessments.set(`${expected.orderId}:${expected.revision}`,{...structuredClone(expected.assessment.deterministicMetadata),...structuredClone(expected.assessment.projection),findings:structuredClone(expected.assessment.rawFindings),assessed_at:runtimeIso(time)});
      orders.get(expected.orderId).status=oracle.status;
    }
    const afterReads=stateReads(planned,iso(time+400));
    ledger.attempts.push({sequence:planned.sequence,name:planned.name,intentId:`offline-case-${planned.sequence}`,state:'confirmed',hash:hash(1000+planned.sequence),submittedAfterBlock:String(1000+planned.sequence*3-1),submittedAt:iso(time),finalizedAt:iso(time+200),beforeReads,afterReads});
  }
  if(count>13)ledger.firstGate={throughSequence:13,passed:true,caseHashes:ledger.attempts.slice(0,13).map(row=>row.hash),verifiedAt:iso(13500)};
  return ledger;
}

function rawTransaction(inputs,planned,attempt) {
  return {txId:attempt.hash,sender:owner,recipient:release.contractAddress,statusName:'FINALIZED',lifecycle:{outcome:'accepted'},resultName:'MAJORITY_AGREE',result:1,createdTimestamp:String(Date.parse(iso(planned.sequence*1000))/1000),currentTimestamp:String(Date.parse(iso(planned.sequence*1000+2000))/1000),lastRound:{round:'0'},txExecutionHash:hash(8000+planned.sequence),txCalldata:'0x010203',txExecutionResultName:`FINISHED_WITH_${planned.expectedTransaction.executionResult}`,txDataDecoded:planned.op==='deploy'?{type:'deploy',contractAddress:release.contractAddress,code:inputs.source,constructorArgs:{},leaderOnly:false}:{type:'call',callData:new Map([['',planned.method],['args',expectedCaseArgs(inputs.plan,inputs.fixture,planned).map(value=>typeof value==='number'?BigInt(value):value)]]),leaderOnly:false}};
}

function storedGuardDouble(inputs,planned,tx,message=expectedGuardMessage(inputs,planned)) {
  return {id:tx.txId,sender:tx.sender,recipient:tx.recipient,round:0,txExecutionHash:tx.txExecutionHash,txCallData:tx.txCalldata,statusName:'Finalized',result:1,txExecutionResult:2,txExecutionResultName:'FinishedWithError',timestamps:{Created:Number(tx.createdTimestamp)},returnData:'0x'+Buffer.from(abi.calldata.encode(new Map([['kind','UserError'],['data',message],['backtrace',[]]]))).toString('hex')};
}

test('default collector and frozen commitments remain offline and NOT_COLLECTED',async()=>{
  const inputs=await inputPromise;
  assert.equal(inputs.plan.cases.length,51);assert.equal(inputs.plan.expected.length,10);
  assert.equal(inputs.commitments.find(row=>row.file===inputs.plan.fixtureFile).sha256,inputs.plan.fixtureSha256);
  assert.equal(HISTORICAL_TRANSACTIONS.length,33);
  assert.equal(notCollectedEvidence().ready,false);assert.equal(notCollectedEvidence().networkRequests,0);
  await assert.rejects(()=>collectV6Evidence({},{}),/ACK/);
});

test('source package uses only exact ENOENT fallbacks and declares missing ignored history bytes without proving them',async()=>{
  const inputs=await inputPromise,temp=await mkdtemp(resolve(tmpdir(),'rr-v6-source-package-'));
  assert.ok(temp.startsWith(resolve(tmpdir(),'rr-v6-source-package-')));
  try {
    for(const row of inputs.commitments) {
      if(row.file.startsWith('artifacts/'))continue;
      const target=resolve(temp,row.file.replaceAll('\\','/'));await mkdir(dirname(target),{recursive:true});await writeFile(target,await readFile(new URL(row.file.replaceAll('\\','/'),root)));
    }
    const buildFile=resolve(temp,'tests/fixtures/v6-compact-build.json');await mkdir(dirname(buildFile),{recursive:true});await writeFile(buildFile,await readFile(new URL('tests/fixtures/v6-compact-build.json',root)));
    const packaged=await loadV6Inputs({root:temp});
    assert.equal(packaged.dependenciesComplete,false);assert.equal(packaged.missingArchivedEvidence.length,3);
    assert.equal(packaged.commitments.find(row=>row.file===inputs.plan.fixtureFile).resolvedFile,inputs.plan.publicFixtureFile);
    assert.equal(packaged.commitments.find(row=>row.file===inputs.plan.buildCommitment.file).resolvedFile,'tests/fixtures/v6-compact-build.json');
    assert.equal(packaged.commitments.filter(row=>row.commitmentOnly).every(row=>row.bytesVerified===false),true);
    await assert.rejects(()=>loadV6Inputs({root:temp,requireArchivedEvidence:true}),/ENOENT/);
    for(const path of [inputs.plan.buildCommitment.file,inputs.plan.fixtureFile]) {
      const target=resolve(temp,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,'{"changed":true}');
      await assert.rejects(()=>loadV6Inputs({root:temp}),/Changed frozen commitment/);await rm(target);
    }
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('all 51 prelocked case readbacks replay locally, including 11 full raw rollback proofs',async()=>{
  const inputs=await inputPromise,ledger=await offlineLedger(inputs);
  validateV6Ledger(ledger,inputs);let rollbackCount=0;
  for(const attempt of ledger.attempts) {
    const planned=inputs.plan.cases[attempt.sequence-1];
    const proof=await validateCaseReadbacks(inputs,planned,attempt,{transactionDatetime:runtimeIso(planned.sequence*1000)});
    assert.equal(proof.verified,true);rollbackCount+=Number(proof.rollbackVerified);
  }
  assert.equal(rollbackCount,11);
});

test('complete collector accepts only all 51 verified doubles plus 33 separately retained historical records',async()=>{
  const inputs={...(await inputPromise),dependenciesComplete:true},ledger=await offlineLedger(inputs),core=address(50),raws=new Map(),envelopes=new Map(),receipts=new Map(),inclusions=new Map();
  const eventAbi=[{type:'event',name:'NewTransaction',inputs:[{name:'txId',type:'bytes32',indexed:true},{name:'recipient',type:'address',indexed:true},{name:'activator',type:'address',indexed:true}]}];
  const track=[];
  async function add(attempt,raw,index,blockNumber) {
    const envelopeHash=hash(10000+index),blockHash=hash(20000+index);
    raws.set(attempt.hash,raw);
    inclusions.set(attempt.hash,{verified:true,protocolTxId:attempt.hash,envelopeHash,blockHash,blockNumber:String(blockNumber),event:'NewTransaction',logIndex:0});
    envelopes.set(envelopeHash,{hash:envelopeHash,to:core,from:owner});
    receipts.set(envelopeHash,{status:'success',transactionHash:envelopeHash,blockHash,blockNumber:BigInt(blockNumber),to:core,logs:[{logIndex:0,address:core,topics:encodeEventTopics({abi:eventAbi,eventName:'NewTransaction',args:{txId:attempt.hash,recipient:raw.recipient,activator:owner}}),data:'0x'}]});
  }
  let index=0;
  for(const row of HISTORICAL_TRANSACTIONS) {
    const code=row.operation==='deploy'?await readFile(new URL(row.sourceFile,root),'utf8'):null;
    const result=HISTORICAL_UNDETERMINED[row.hash];
    const raw={txId:row.hash,sender:owner,recipient:row.contractAddress,statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:{outcome:result?'undetermined':'accepted'},resultName:result||'MAJORITY_AGREE',result:result?2:1,txDataDecoded:row.operation==='deploy'?{type:'deploy',contractAddress:row.contractAddress,code,constructorArgs:{},leaderOnly:false}:{type:'call',leaderOnly:false,callData:new Map([['',row.operation],['args',[]]])}};
    await add(row,raw,index++,Number(row.submittedAfterBlock)+1);
    track.push({hash:row.hash,operation:row.operation,role:row.role,submittedAfterBlock:row.submittedAfterBlock,...(row.operation==='deploy'?{sourceSha256:row.sourceSha256,...(row.initialReadback?{readback:row.initialReadback}:{})}:{address:row.contractAddress})});
  }
  const latest=new Map();
  for(const attempt of ledger.attempts) {
    const planned=inputs.plan.cases[attempt.sequence-1];
    await add(attempt,rawTransaction(inputs,planned,attempt),index++,300000+attempt.sequence*3);
    track.push({hash:attempt.hash,operation:planned.op==='deploy'?'deploy':planned.method,role:'owner',...(planned.op==='deploy'?{sourceSha256:DEPLOYMENT_SOURCE_SHA256}:{address:release.contractAddress})});
    for(const read of attempt.afterReads)if(Object.hasOwn(read,'value'))latest.set(canonicalEvidenceJson([read.method,read.args]),read.value);
  }
  const connection={metadata:{chainId:4221,genesisHash:BRADBURY.genesisHash,addresses:{ConsensusMain:core}},client:{getTransaction:async({hash})=>raws.get(hash),readContract:async({functionName,args,transactionHashVariant})=>{assert.equal(transactionHashVariant,'latest-final');return latest.get(canonicalEvidenceJson([functionName,args]));}},publicClient:{getTransactionReceipt:async({hash})=>receipts.get(hash),getTransaction:async({hash})=>envelopes.get(hash),getBlock:async({blockNumber})=>({hash:[...inclusions.values()].find(row=>row.blockNumber===String(blockNumber)).blockHash})}};
  const deps={inputs,connection,session:{chainId:4221,genesisHash:BRADBURY.genesisHash,actors:{owner},transactions:track},inclusion:async(_connection,hash)=>inclusions.get(hash),storedData:async tx=>storedGuardDouble(inputs,inputs.plan.cases.find(row=>ledger.attempts[row.sequence-1]?.hash===tx.txId),tx)};
  const report=await collectV6Evidence(ledger,{ack:COLLECT_ACK},deps);
  assert.equal(report.allRequiredCasesPassed,true,JSON.stringify(report.failures));
  assert.equal(report.cases.filter(row=>row.passed).length,51);assert.equal(report.historicalTransactions.length,33);
  assert.equal(report.historicalTransactions.filter(row=>row.consensusOutcome==='undetermined').length,6);
  assert.equal(report.historicalTransactions.some(row=>row.passedBusinessCase),false);
  raws.get(ledger.attempts[5].hash).lifecycle={outcome:'undetermined'};
  raws.get(ledger.attempts[5].hash).resultName='MAJORITY_DISAGREE';
  const failed=await collectV6Evidence(ledger,{ack:COLLECT_ACK},deps);
  assert.equal(failed.allRequiredCasesPassed,false);assert.equal(failed.firstGatePassed,false);
  assert.equal(failed.cases.filter(row=>row.sequence>13).some(row=>row.passed),false);
});

test('ledger rejects extra or duplicate resampling, missing first gate and post-uncertain continuation',async()=>{
  const inputs=await inputPromise,base=await offlineLedger(inputs);
  let ledger=structuredClone(base);ledger.attempts[1].hash=ledger.attempts[0].hash;assert.throws(()=>validateV6Ledger(ledger,inputs),/Duplicate/);
  ledger=structuredClone(base);ledger.attempts.push(structuredClone(base.attempts[5]));assert.throws(()=>validateV6Ledger(ledger,inputs),/Malformed/);
  ledger=structuredClone(base);ledger.attempts[6].state='submission-uncertain';assert.throws(()=>validateV6Ledger(ledger,inputs),/post-failure/);
  ledger=structuredClone(base);delete ledger.firstGate;assert.throws(()=>validateV6Ledger(ledger,inputs),/first-13/);
  ledger=structuredClone(base);ledger.attempts[1].name='fresh-resampled-call';assert.throws(()=>validateV6Ledger(ledger,inputs),/extra/);
});

test('FINALIZED VM return with undetermined consensus never passes a required case',()=>{
  const tx={statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:{outcome:'undetermined'},resultName:'NO_MAJORITY',result:5};
  assert.equal(transactionOutcome(tx,'RETURN').passed,false);
  assert.equal(transactionOutcome({...tx,lifecycle:{outcome:'accepted'},resultName:'MAJORITY_AGREE',result:1},'RETURN').passed,true);
  assert.equal(transactionOutcome({...tx,lifecycle:{outcome:'accepted'},resultName:'MAJORITY_AGREE',result:1},'ERROR').passed,false);
});

test('real rc.2 creation-time shape binds assessed_at and never substitutes current time or invented datetime',async()=>{
  // Exact public timestamp fields from retained accepted v5 evaluation 70e2502b,
  // and exact assessed_at from readbacks/v5-assessment-1-1.json. No trace replay.
  const actual={createdTimestamp:'1793873526',currentTimestamp:'1793873653'};
  assert.equal(runtimeTransactionDatetime(actual),'2026-11-05T10:12:06Z');
  assert.notEqual(runtimeTransactionDatetime(actual),'2026-11-05T10:14:13Z');
  assert.throws(()=>runtimeTransactionDatetime({currentTimestamp:actual.currentTimestamp}),/creation timestamp/);
  assert.throws(()=>runtimeTransactionDatetime({...actual,datetime:'2026-11-05T10:14:13Z'}),/disagrees/);
  const inputs=await inputPromise,ledger=await offlineLedger(inputs,11),planned=inputs.plan.cases[10],attempt=ledger.attempts[10];
  await assert.rejects(()=>validateCaseReadbacks(inputs,planned,attempt,{transactionDatetime:runtimeIso(12000)}),/transaction datetime/);
});

test('guard output requires bound stored bytes for the unique source error and rejects missing, wrong guard or runtime objects',async()=>{
  const inputs=await inputPromise,ledger=await offlineLedger(inputs,4),planned=inputs.plan.cases[3],tx=rawTransaction(inputs,planned,ledger.attempts[3]);
  const stored=storedGuardDouble(inputs,planned,tx);
  assert.equal(validateExpectedGuardError(inputs,planned,tx,stored).ownUserError,'Verify evidence before assessment');
  for(const errorMap of [new Map([['kind','VMError'],['data',expectedGuardMessage(inputs,planned)]]),new Map([['kind','UserError'],['data','wrong guard'],['backtrace',[expectedGuardMessage(inputs,planned)]]])]) {
    const changed=structuredClone(stored);changed.returnData='0x'+Buffer.from(abi.calldata.encode(errorMap)).toString('hex');
    assert.throws(()=>validateExpectedGuardError(inputs,planned,tx,changed));
  }
  for(const mutate of [value=>value.returnData=null,value=>value.returnData='0x',value=>value.returnData='0x'+Buffer.from(abi.calldata.encode('Accepted orders are closed')).toString('hex'),value=>value.returnData='0x'+Buffer.from(abi.calldata.encode({VMError:'OutOfResource'})).toString('hex'),value=>value.id=hash(9000),value=>value.txExecutionHash=hash(9001),value=>value.round=1]) {
    const changed=structuredClone(stored);mutate(changed);assert.throws(()=>validateExpectedGuardError(inputs,planned,tx,changed));
  }
});

test('actual identity is exact over protocol hash, actor, target, source, method and ABI-typed input bytes',async()=>{
  const inputs=await inputPromise,ledger=await offlineLedger(inputs,3);
  const planned=inputs.plan.cases[2],attempt=ledger.attempts[2],tx=rawTransaction(inputs,planned,attempt);
  assert.equal(verifyTransactionIdentity(inputs,planned,attempt,tx,release).operation,'submit_revision');
  for(const mutate of [value=>value.txId=hash(9000),value=>value.sender=address(77),value=>value.recipient=address(78),value=>value.txDataDecoded.callData.set('','evaluate'),value=>value.txDataDecoded.callData.get('args')[0]='1',value=>value.txDataDecoded.callData.get('args')[1]+=' ',value=>value.txDataDecoded.leaderOnly=true]) {
    const changed=structuredClone(tx);mutate(changed);assert.throws(()=>verifyTransactionIdentity(inputs,planned,attempt,changed,release));
  }
  const deploy=rawTransaction(inputs,inputs.plan.cases[0],ledger.attempts[0]);
  verifyTransactionIdentity(inputs,inputs.plan.cases[0],ledger.attempts[0],deploy,release);
  deploy.txDataDecoded.code+='\n';assert.throws(()=>verifyTransactionIdentity(inputs,inputs.plan.cases[0],ledger.attempts[0],deploy,release),/source/);
});

test('same verdict with altered claim type, basis, null, field state, source scope or snapshot hash fails full projection',async()=>{
  const inputs=await inputPromise,ledger=await offlineLedger(inputs,11),planned=inputs.plan.cases[10],attempt=ledger.attempts[10];
  for(const mutate of [assessment=>assessment.findings[0].claim_type='boundary_disclosure',assessment=>assessment.findings[0].basis_scope_source_indices=[0],assessment=>assessment.findings[1].validity=null,assessment=>assessment.findings[1].scope_source_indices=[0],assessment=>assessment.findings[1].field_checks[0].state='FOUND',assessment=>assessment.snapshot_hash='0'.repeat(64)]) {
    const changed=structuredClone(attempt),row=changed.afterReads.find(row=>row.method==='get_assessment'&&row.args[1]===2),assessment=JSON.parse(row.value);mutate(assessment);row.value=JSON.stringify(assessment);
    await assert.rejects(()=>validateCaseReadbacks(inputs,planned,changed,{transactionDatetime:runtimeIso(11000)}));
  }
  const raw=inputs.plan.expected.find(row=>row.id==='positive').assessment.rawFindings;
  const altered=structuredClone(raw);altered[0].extra='not silently dropped';
  assert.throws(()=>assessmentProjection({findings:altered}),/Unsupported/);
});

test('expected execution ERROR requires actual before/after raw records, not a matching UserError message',async()=>{
  const inputs=await inputPromise,ledger=await offlineLedger(inputs,4),planned=inputs.plan.cases[3],attempt=ledger.attempts[3];
  let changed=structuredClone(attempt);changed.beforeReads=[];
  await assert.rejects(()=>validateCaseReadbacks(inputs,planned,changed),/before and after/);
  changed=structuredClone(attempt);const order=changed.afterReads.find(row=>row.method==='get_order');order.value=JSON.stringify({...JSON.parse(order.value),revision_count:2});
  await assert.rejects(()=>validateCaseReadbacks(inputs,planned,changed),/unchanged raw/);
  for(const both of [false,true]) {
    changed=structuredClone(attempt);
    for(const reads of [changed.beforeReads,...(both?[changed.afterReads]:[])]) {
      const row=reads.find(row=>row.method==='get_revision');delete row.value;row.error={message:'offline'};
    }
    await assert.rejects(()=>validateCaseReadbacks(inputs,planned,changed),/successful raw value/);
  }
});

test('history accounts for all 33 original transactions and never lets auxiliary/old hashes satisfy V6',async()=>{
  const inputs=await inputPromise,ledger=await offlineLedger(inputs,0);
  const transactions=HISTORICAL_TRANSACTIONS.map(row=>({hash:row.hash,operation:row.operation,role:row.role,submittedAfterBlock:row.submittedAfterBlock,...(row.operation==='deploy'?{sourceSha256:row.sourceSha256,...(row.initialReadback?{readback:{...row.initialReadback}}:{})}:{address:row.contractAddress})}));
  const session={chainId:4221,genesisHash:BRADBURY.genesisHash,actors:{owner},transactions};
  assert.equal(verifyHistoryAccounting(session,ledger).historicalCount,33);
  assert.equal(Object.keys(HISTORICAL_UNDETERMINED).length,6);
  assert.throws(()=>verifyHistoryAccounting({...session,transactions:transactions.slice(1)},ledger),/historical/);
  const altered=structuredClone(session);altered.transactions.find(row=>row.readback).readback.expected=2;assert.throws(()=>verifyHistoryAccounting(altered,ledger),/zero deployment/);
  assert.throws(()=>verifyHistoryAccounting({...session,transactions:[...transactions,{hash:hash(9999),operation:'evaluate',role:'owner'}]},ledger),/Extra tracked/);
  const same=await offlineLedger(inputs,1);same.attempts[0].hash=HISTORICAL_TRANSACTIONS[21].hash;same.release.deploymentHash=same.attempts[0].hash;
  assert.throws(()=>verifyHistoryAccounting(session,same),/cannot satisfy/);
});

test('inclusion must bind actual sealed core, successful envelope receipt and canonical block hash',async()=>{
  const core=address(50),actor=owner,attempt={hash:hash(70),submittedAfterBlock:'90'},target={contractAddress:address(99)};
  const topics=encodeEventTopics({abi:[{type:'event',name:'NewTransaction',inputs:[{name:'txId',type:'bytes32',indexed:true},{name:'recipient',type:'address',indexed:true},{name:'activator',type:'address',indexed:true}]}],eventName:'NewTransaction',args:{txId:attempt.hash,recipient:target.contractAddress,activator:actor}});
  const proof={verified:true,protocolTxId:attempt.hash,envelopeHash:hash(71),blockHash:hash(72),blockNumber:'100',event:'NewTransaction',logIndex:0};
  const receipt={status:'success',transactionHash:proof.envelopeHash,blockHash:proof.blockHash,blockNumber:100n,to:core,logs:[{logIndex:0,address:core,topics,data:'0x'}]};
  const envelope={hash:proof.envelopeHash,to:core,from:actor};
  const connection={metadata:{addresses:{ConsensusMain:core}},publicClient:{getTransactionReceipt:async()=>receipt,getTransaction:async()=>envelope,getBlock:async()=>({hash:proof.blockHash})}};
  assert.equal((await verifyV6Inclusion(connection,attempt,target,actor,{inclusion:async()=>proof})).verified,true);
  envelope.to=address(51);await assert.rejects(()=>verifyV6Inclusion(connection,attempt,target,actor,{inclusion:async()=>proof}),/actual sealed core/);envelope.to=core;
  receipt.status='reverted';await assert.rejects(()=>verifyV6Inclusion(connection,attempt,target,actor,{inclusion:async()=>proof}),/receipt\/block/);
});

function addendumFixture() {
  return {format:'research-receipt/v6-deployment-transport-addendum/1',planSha256:PLAN_SHA256,sequence:1,caseName:'deployment',originalOwner:owner,deploymentSender:address(10),contractAddress:null,chainId:4221,genesisHash:BRADBURY.genesisHash,sourceSha256:DEPLOYMENT_SOURCE_SHA256,constructorArgs:[],leaderOnly:false,remainingCasesActor:owner,reasonCode:'DEFAULT_ESTIMATE_REVERT_TRANSPORT',reviewedAt:iso(0),deploymentRequestHash:'a'.repeat(64),gasLimit:'100000000',gasPriceWei:'1',maxTotalCostWei:'100000001',validUntil:String(Date.parse(iso(3600000))/1000),registryAddresses:{ConsensusMain:address(50),TransactionManager:address(51)},addressManager:BRADBURY.addressManager,l2Endpoint:BRADBURY.rpcUrl,manualProofFile:'artifacts/bradbury/v6/offline-proof.json',manualProofSha256:'b'.repeat(64)};
}
test('deployment actor exception requires reviewed exact hash and cannot mutate other actors, source, chain, args or predicted address',()=>{
  const original=addendumFixture(),digest=value=>sha(canonicalEvidenceJson(value));
  assert.throws(()=>validateTransportAddendum(original,undefined),/reviewed hash/);
  assert.equal(validateTransportAddendum(original,digest(original)).deploymentSender,address(10));
  for(const mutate of [value=>value.remainingCasesActor=address(10),value=>value.chainId=1,value=>value.sourceSha256='f'.repeat(64),value=>value.constructorArgs=['changed'],value=>value.sequence=2,value=>value.leaderOnly=true]) {
    const changed=structuredClone(original);mutate(changed);assert.throws(()=>validateTransportAddendum(changed,digest(changed)));
  }
  const predicted={...original,contractAddress:address(99)};
  assert.throws(()=>validateTransportAddendum(predicted,digest(predicted),{contractAddress:address(98)}),/contract address/);
  assert.throws(()=>validateTransportAddendum({...original,sourceSha256:'f'.repeat(64)},digest(original)),/hash mismatch/);
});

test('manual transport proof requires verified success without any error field and an exact JSON-RPC response identity',()=>{
  const addendum=addendumFixture();
  const request={chainId:'4221',from:addendum.deploymentSender,to:addendum.registryAddresses.ConsensusMain,data:'0x01',value:'1',nonce:'0',gas:addendum.gasLimit,gasPrice:addendum.gasPriceWei,type:'legacy'};
  addendum.deploymentRequestHash=sha(canonicalEvidenceJson(request));
  const proof={format:'research-receipt/v6-manual-gas-exact-call-proof/1',verified:true,simulationOnly:true,consensusProven:false,signatures:0,chainTransactionsSent:0,modelCalls:0,ethCallRequestsStarted:1,deploymentRequest:request,verifiedAt:iso(1),...Object.fromEntries(['planSha256','sourceSha256','chainId','genesisHash','addressManager','registryAddresses','l2Endpoint','gasLimit','gasPriceWei','maxTotalCostWei','validUntil'].map(key=>[key,addendum[key]])),nonceEvidence:{latest:'0',pending:'0',blockNumber:'100'},networkEvidence:{blockHash:hash(20),registryCodeMatches:true,l2ChainId:4221,l2GenesisHash:BRADBURY.genesisHash},ethCall:{success:true,blockNumber:'100',blockHash:hash(20),result:hash(21),request:{from:request.from,to:request.to,data:request.data,value:'0x1',gas:'0x5f5e100',gasPrice:'0x1'},response:{httpStatus:200,body:{jsonrpc:'2.0',id:1,result:hash(21)}}}};
  assert.equal(validateManualTransportProof(addendum,proof).from,addendum.deploymentSender);
  for(const mutate of [value=>value.verified=false,value=>value.error=null,value=>value.ethCall.response.body.error=null,value=>value.ethCall.response.body.id=2,value=>value.ethCall.response.body.jsonrpc='1.0']) {
    const changed=structuredClone(proof);mutate(changed);assert.throws(()=>validateManualTransportProof(addendum,changed));
  }
});
