// Offline fake providers/signers only. No key creation, real signing, RPC or send.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {abi,decodeInputData} from 'genlayer-js';
import {decodeFunctionData,keccak256,parseAbiItem,encodeEventTopics} from 'viem';
import {BRADBURY,REQUIRED_NAMES,PROJECT_ROOT,overrideChain,developmentDistribution,publicJson} from '../../scripts/bradbury-client.mjs';
import {ACK,SOURCE_FILE,SOURCE_SHA,PLAN_SHA,MANUAL_GAS,MAX_TOTAL_COST,canonical,sha256,deploymentRequestHash,callProjection,validateEndpoint,validateRequest,buildDeploymentRequest,validateManualProof,validateAddendum,validateSignedEnvelope,createGasAwareSession,readReviewedPublicFile,recoverEnvelope,safeFailure} from '../../scripts/bradbury-gas-aware-session.mjs';

const source=await readFile(resolve(PROJECT_ROOT,SOURCE_FILE),'utf8');
const address='0x'+'e'.repeat(40),owner='0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70';
const H='0x'+'a'.repeat(64),OTHER='0x'+'b'.repeat(64),RAW='0x1234abcd';
const NOW=Date.parse('2026-11-05T18:00:00Z');
const plain=value=>JSON.parse(publicJson(value));
const registry=Object.fromEntries(REQUIRED_NAMES.map((name,index)=>[name,'0x'+String(index+100).padStart(40,'0')]));
const chain=overrideChain(registry);
const distribution=developmentDistribution({leaderTimeunitsAllocation:600n,validatorTimeunitsAllocation:600n,executionBudgetPerRound:10000000000000000n,appealRounds:0n},{genPerTimeUnit:1n,storageUnitPrice:1n,receiptGasPrice:10000000n},chain);

function harness({writeCapability=false}={}){
 const env={clock:NOW,records:[],documents:new Map(),freshCalls:0,estimates:0,signStubCalls:0,sendStubCalls:0,verifySignedStubCalls:0,failPersist:null,failBroadcast:false,failEstimate:false,recovered:0,
  context:{metadata:{chainId:4221,genesisHash:BRADBURY.genesisHash,addressManager:BRADBURY.addressManager,addresses:structuredClone(registry)},chain,l2Endpoint:BRADBURY.rpcUrl,address,headNumber:218300n,headHash:H,headTimestamp:BigInt(NOW/1000),registryCodeMatches:true,latestNonce:0,pendingNonce:0,balance:100000000000000000n,gasPrice:10000000n,quote:{distribution:structuredClone(distribution),feeValue:40000000000000000n},feeScope:'Offline development quote',feeProfileSha256:'c'.repeat(64)}};
 env.persist=async(stage,value)=>{
  if(env.failPersist===stage)throw new Error('Simulated fsync failure');
  const parsed=plain(value),path='artifacts/bradbury/gas-aware/test/'+String(env.records.length+1).padStart(3,'0')+'-'+stage+'.json';
  const record={stage,value:parsed,path,sha256:sha256(publicJson(value)+'\n')};env.records.push(record);return {path,sha256:record.sha256};
 };
 env.document=(path,value)=>{const bytes=publicJson(value)+'\n',hash=sha256(bytes);env.documents.set(path,{hash,value:plain(value)});return {path,hash};};
 env.machine=createGasAwareSession({address,source,originalOwner:owner,writeCapability,deps:{
  now:()=>env.clock,persist:env.persist,
  fresh:async()=>{env.freshCalls++;return {...structuredClone({...env.context,chain:undefined}),chain:env.context.chain};},
  estimate:async request=>{env.estimates++;assert.equal(request.gas,undefined);if(env.failEstimate)throw new Error('empty revert with 0x'+'f'.repeat(64));return 35000000n;},
  readReviewed:async(path,hash)=>{const item=env.documents.get(path);assert.ok(item,'Expected reviewed public document');assert.equal(item.hash,hash);return structuredClone(item.value);},
  blockHash:async()=>env.proofBlockHash??H,
  sign:async()=>{env.signStubCalls++;return RAW;},
  verifySigned:async(raw,request)=>{env.verifySignedStubCalls++;assert.equal(raw,RAW);validateRequest(request);return env.signedVerification!==false;},
  broadcast:async raw=>{env.sendStubCalls++;assert.equal(raw,RAW);assert.ok(env.records.some(x=>x.stage==='signed-envelope-hash'),'Expected public hash persistence before fake broadcast');if(env.failBroadcast)throw new Error('raw='+raw+' private=0x'+'f'.repeat(64));return keccak256(raw);},
  recover:async hash=>{env.recovered++;assert.equal(hash,keccak256(RAW));return {receiptObserved:true,protocolTxId:OTHER,protocolConsensusVerified:false};},
 }});
 env.inspect=async(mode='manual')=>{
  const result=await env.machine.inspect({gasMode:mode,maxGasPriceWei:'10000000',totalCostCapWei:MAX_TOTAL_COST.toString()});
  env.inspection=env.records.find(x=>x.stage==='inspection').value;env.inspectionRecord=result;return result;
 };
 env.approvals=()=>{
  const i=env.inspection,r=i.deploymentRequest;
  const proof={format:'research-receipt/v6-manual-gas-exact-call-proof/1',verified:true,planSha256:PLAN_SHA,sourceSha256:SOURCE_SHA,chainId:4221,genesisHash:BRADBURY.genesisHash,addressManager:BRADBURY.addressManager,registryAddresses:registry,l2Endpoint:i.l2Endpoint,deploymentRequest:r,deploymentRequestHash:i.deploymentRequestHash,gasLimit:r.gas,gasPriceWei:r.gasPrice,maxTotalCostWei:i.maxTotalCostWei,validUntil:i.validUntil,verifiedAt:new Date(env.clock).toISOString(),simulationOnly:true,consensusProven:false,signatures:0,chainTransactionsSent:0,modelCalls:0,ethCallRequestsStarted:1,nonceEvidence:{latest:r.nonce,pending:r.nonce,blockNumber:'218300'},balanceWei:String(env.context.balance),networkEvidence:{...env.context.metadata,l2ChainId:4221,l2GenesisHash:BRADBURY.genesisHash,blockNumber:'218300',blockHash:H,registryCodeMatches:true},ethCall:{request:callProjection(r),blockNumber:'218300',blockHash:H,success:true,result:OTHER,response:{httpStatus:200,body:{jsonrpc:'2.0',id:1,result:OTHER}}}};
  const proofFile=i.gasMode==='manual'?'artifacts/bradbury/v6/manual-gas-proof-test.json':null;
  const proofDoc=proofFile?env.document(proofFile,proof):null;
  const addendum={format:'research-receipt/v6-deployment-transport-addendum/1',planSha256:PLAN_SHA,sequence:1,caseName:'deployment',originalOwner:owner,deploymentSender:address,contractAddress:null,chainId:4221,genesisHash:BRADBURY.genesisHash,sourceSha256:SOURCE_SHA,constructorArgs:[],leaderOnly:false,remainingCasesActor:owner,reasonCode:'DEFAULT_ESTIMATE_REVERT_TRANSPORT',reviewedAt:new Date(env.clock).toISOString(),deploymentRequestHash:i.deploymentRequestHash,gasLimit:i.gasLimit,gasPriceWei:i.gasPriceWei,maxTotalCostWei:i.maxTotalCostWei,validUntil:i.validUntil,registryAddresses:registry,addressManager:BRADBURY.addressManager,l2Endpoint:i.l2Endpoint,manualProofFile:proofFile,manualProofSha256:proofDoc?.hash??null};
  const addendumDoc=env.document('docs/evidence/v6-transport-test.json',addendum);
  const request={inspectionSha256:env.inspectionRecord.inspectionSha256,manualProofFile:proofFile,manualProofSha256:proofDoc?.hash??null,addendumFile:addendumDoc.path,addendumSha256:addendumDoc.hash};
  return {proof,addendum,request};
 };
 env.prepare=async()=>{env.approved=env.approvals();env.prepared=await env.machine.prepare(env.approved.request);return env.prepared;};
 return env;
}

test('default CLI remains offline, creates no account and does not start a signer even with ACK env',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['scripts/bradbury-gas-aware-session.mjs'],{cwd:PROJECT_ROOT,env:{...process.env,RR_GAS_AWARE_DEPLOY_ACK:'1'},encoding:'utf8'}));
 assert.deepEqual([result.started,result.networkRequests,result.signatures,result.accountCreated],[false,0,0,false]);
});

test('official L2 allowlist rejects arbitrary URLs, credentials, ports or API routes',()=>{
 assert.equal(validateEndpoint(BRADBURY.rpcUrl),BRADBURY.rpcUrl);
 assert.equal(validateEndpoint('https://rpc.testnet-chain.genlayer.com'),'https://rpc.testnet-chain.genlayer.com');
 for(const endpoint of ['https://evil.example','http://rpc-bradbury.genlayer.com','https://x@rpc-bradbury.genlayer.com','https://rpc-bradbury.genlayer.com:443','https://rpc-bradbury.genlayer.com/gen_call'])assert.throws(()=>validateEndpoint(endpoint),/UNREVIEWED/);
});

test('manual inspection uses pinned actual source, SDK decoded empty ctor, fixed fees and exact hash without estimate/sign',async()=>{
 const e=harness();await e.inspect();const i=e.inspection,r=i.deploymentRequest;
 assert.equal(e.estimates,0);assert.equal(e.signStubCalls,0);assert.equal(e.sendStubCalls,0);
 assert.equal(r.gas,'100000000');assert.equal(i.maxTotalCostWei,'41000000000000000');assert.equal(deploymentRequestHash(r),i.deploymentRequestHash);
 const decoded=decodeFunctionData({abi:chain.consensusMainContract.abi,data:r.data}),p=decoded.args[0],app=decodeInputData(p.txCalldata,'0x'+'0'.repeat(40));
 assert.equal(p.sender.toLowerCase(),address);assert.equal(p.recipient,'0x'+'0'.repeat(40));assert.equal(p.userValue,0n);assert.equal(p.maxRotations,3n);assert.equal(p.numOfInitialValidators,5n);assert.deepEqual(p.messageAllocations,[]);
 assert.equal(sha256(Buffer.from(app.code,'utf8')),SOURCE_SHA);assert.deepEqual(app.constructorArgs instanceof Map?Object.fromEntries(app.constructorArgs):app.constructorArgs,{});assert.equal(app.leaderOnly,false);
 const again=await e.machine.inspect({gasMode:'default'});assert.equal(again.cached,true);assert.equal(e.estimates,0);assert.equal(e.freshCalls,1);
});

test('default successful estimate is used exactly and rejected estimation never falls back or repeats',async()=>{
 const good=harness();await good.inspect('default');assert.equal(good.inspection.gasLimit,'35000000');assert.equal(good.estimates,1);
 const bad=harness();bad.failEstimate=true;await assert.rejects(()=>bad.inspect('default'));assert.equal(bad.machine.state().phase,'INSPECTION_BLOCKED');
 await assert.rejects(()=>bad.inspect('manual'),/INSPECTION_ALREADY_CONSUMED/);assert.equal(bad.estimates,1);assert.equal(bad.signStubCalls,0);assert.equal(bad.sendStubCalls,0);
});

test('source identity, fresh account and 0.05GEN/operator limits cannot be widened',async()=>{
 assert.throws(()=>createGasAwareSession({address,source:source+' ',originalOwner:owner,deps:{}}),/SOURCE_COMMITMENT/);
 assert.throws(()=>createGasAwareSession({address:owner,source,originalOwner:owner,deps:{}}),/FRESH_ACCOUNT/);
 const e=harness();await assert.rejects(()=>e.machine.inspect({gasMode:'manual',maxGasPriceWei:'10000000',totalCostCapWei:'50000000000000001'}),/OPERATOR_CAP/);
 const f=harness();f.context.gasPrice=10000001n;await assert.rejects(()=>f.inspect(),/GAS_PRICE_ABOVE/);
});

test('manual proof consumption rejects partial, failed, stale or mismatched calls and witness fields',async()=>{
 const e=harness();await e.inspect();const {proof}=e.approvals();
 assert.ok(validateManualProof(proof,e.inspection,e.clock));
 for(const mutate of [p=>p.verified=false,p=>p.error=null,p=>delete p.verifiedAt,p=>p.verifiedAt=new Date(NOW-600001).toISOString(),p=>p.ethCallRequestsStarted=2,p=>p.ethCall.response.body.id=2,p=>p.ethCall.response.body.error=null,p=>p.ethCall.success=false,p=>p.ethCall.request.gas='0x1',p=>p.deploymentRequest.nonce='1',p=>p.nonceEvidence.pending='1',p=>p.networkEvidence.blockHash=OTHER,p=>p.balanceWei='1',p=>p.sourceSha256='0'.repeat(64),p=>p.registryAddresses.ConsensusMain=owner,p=>p.validUntil='1',p=>p.gasLimit='100000001',p=>p.l2Endpoint='https://evil.example']){
  const bad=structuredClone(proof);mutate(bad);assert.throws(()=>validateManualProof(bad,e.inspection,e.clock));
 }
 assert.equal(e.signStubCalls,0);
});

test('transport addendum authorizes only deployment sender exception, never changed business owner or request',async()=>{
 const e=harness();await e.inspect();const a=e.approvals();
 const options={originalOwner:owner,proofFile:a.request.manualProofFile,proofSha256:a.request.manualProofSha256};
 assert.equal(validateAddendum(a.addendum,e.inspection,options),true);
 for(const mutate of [x=>x.remainingCasesActor=address,x=>x.sequence=2,x=>x.deploymentSender=owner,x=>x.constructorArgs=['bad'],x=>x.leaderOnly=true,x=>x.contractAddress=undefined,x=>x.planSha256='0'.repeat(64),x=>x.maxTotalCostWei='50000000000000001',x=>x.manualProofSha256='0'.repeat(64)]){const bad=structuredClone(a.addendum);mutate(bad);assert.throws(()=>validateAddendum(bad,e.inspection,options));}
});

test('prepare persists one immutable intent, requires proof hash and fresh funding but never signs',async()=>{
 const e=harness();await e.inspect();await e.prepare();assert.equal(e.machine.state().phase,'PREPARED');
 assert.equal(e.records.filter(x=>x.stage==='intent').length,1);assert.equal(e.signStubCalls,0);assert.equal(e.sendStubCalls,0);
 await assert.rejects(()=>e.machine.prepare(e.approved.request),/NO_REUSABLE/);
 const bad=harness();await bad.inspect();const approval=bad.approvals();bad.context.balance=0n;await assert.rejects(()=>bad.machine.prepare(approval.request),/FUNDING/);assert.equal(bad.machine.state().phase,'PREPARE_BLOCKED');assert.equal(bad.records.filter(x=>x.stage==='intent').length,1);
});

test('no signing without startup capability, explicit token and exact immutable intent hash',async()=>{
 const e=harness();await e.inspect();await e.prepare();await assert.rejects(()=>e.machine.submit({ack:ACK,intentSha256:e.prepared.intentSha256}),/ACK/);assert.equal(e.signStubCalls,0);
 const f=harness({writeCapability:true});await f.inspect();await f.prepare();await assert.rejects(()=>f.machine.submit({ack:'yes',intentSha256:f.prepared.intentSha256}),/ACK/);await assert.rejects(()=>f.machine.submit({ack:ACK,intentSha256:'0'.repeat(64)}),/INTENT_NOT/);assert.equal(f.signStubCalls,0);
});

test('fresh nonce, pending nonce, price, fee, registry, expiry, blockhash or funding drift blocks pre-sign',async()=>{
 for(const mutate of [e=>e.context.latestNonce=1,e=>e.context.pendingNonce=1,e=>e.context.gasPrice++,e=>e.context.quote.feeValue++,e=>e.context.metadata.addresses.ConsensusMain=owner,e=>e.clock+=600001,e=>e.proofBlockHash=OTHER,e=>e.context.balance=0n,e=>e.context.headTimestamp+=3600n]){
  const e=harness({writeCapability:true});await e.inspect();await e.prepare();mutate(e);await assert.rejects(()=>e.machine.submit({ack:ACK,intentSha256:e.prepared.intentSha256}));assert.equal(e.signStubCalls,0);assert.equal(e.sendStubCalls,0);
 }
});

test('fake signer route fsyncs public EVM hash before fake broadcast and never stores raw',async()=>{
 const e=harness({writeCapability:true});await e.inspect();await e.prepare();const result=await e.machine.submit({ack:ACK,intentSha256:e.prepared.intentSha256});
 assert.equal(result.expectedEvmHash,keccak256(RAW));assert.equal(result.protocolConsensusVerified,false);assert.equal(e.signStubCalls,1);assert.equal(e.verifySignedStubCalls,1);assert.equal(e.sendStubCalls,1);
 assert.ok(e.records.findIndex(x=>x.stage==='signed-envelope-hash')<e.records.findIndex(x=>x.stage==='broadcast-observed'));
 assert.equal(JSON.stringify(e.records).includes(RAW),false);await assert.rejects(()=>e.machine.submit({ack:ACK,intentSha256:e.prepared.intentSha256}),/CONSUMED/);assert.equal(e.sendStubCalls,1);
});

test('lost send response permanently blocks rebroadcast and recovery tolerates consumed/pending nonce or changed price',async()=>{
 const e=harness({writeCapability:true});await e.inspect();await e.prepare();e.failBroadcast=true;
 await assert.rejects(()=>e.machine.submit({ack:ACK,intentSha256:e.prepared.intentSha256}));assert.equal(e.machine.state().phase,'SEND_UNKNOWN');assert.equal(e.machine.state().expectedEvmHash,keccak256(RAW));
 assert.equal(JSON.stringify(e.records).includes(RAW),false);assert.equal(JSON.stringify(e.records).includes('f'.repeat(64)),false);
 e.context.pendingNonce=1;e.context.gasPrice=20000000n;const recovery=await e.machine.recover();assert.equal(recovery.observation.protocolTxId,OTHER);assert.equal(recovery.resubmissionAllowed,false);
 await assert.rejects(()=>e.machine.submit({ack:ACK,intentSha256:e.prepared.intentSha256}));assert.equal(e.signStubCalls,1);assert.equal(e.sendStubCalls,1);
});

test('failed signed-envelope verification or durable public-hash write prevents broadcasting',async()=>{
 for(const fail of ['verify','persist']){
  const e=harness({writeCapability:true});await e.inspect();await e.prepare();if(fail==='verify')e.signedVerification=false;else e.failPersist='signed-envelope-hash';
  await assert.rejects(()=>e.machine.submit({ack:ACK,intentSha256:e.prepared.intentSha256}));assert.equal(e.sendStubCalls,0);await assert.rejects(()=>e.machine.submit({ack:ACK,intentSha256:e.prepared.intentSha256}));assert.equal(e.signStubCalls,1);
 }
 await assert.rejects(()=>validateSignedEnvelope(RAW,{chainId:'4221'}));
});

test('default-estimate prepare has no false manual simulation claim',async()=>{
 const e=harness({writeCapability:true});await e.inspect('default');await e.prepare();assert.equal(e.approved.request.manualProofFile,null);assert.equal(e.approved.request.manualProofSha256,null);assert.equal(e.signStubCalls,0);
});

test('public reviewed documents accept full duplicate request data over128KiB, reject escape and >1MiB',async()=>{
 const artifacts=resolve(PROJECT_ROOT,'artifacts'),dir=resolve(artifacts,'gas-aware-offline-'+randomUUID());await mkdir(resolve(dir,'artifacts/bradbury'),{recursive:true});
 try{
  const value={deploymentRequest:{data:'0x'+'ab'.repeat(45000)},ethCall:{request:{data:'0x'+'ab'.repeat(45000)}}},raw=Buffer.from(JSON.stringify(value));assert.ok(raw.length>131072);
  await writeFile(resolve(dir,'artifacts/bradbury/proof.json'),raw);assert.deepEqual(await readReviewedPublicFile('artifacts/bradbury/proof.json',sha256(raw),{root:dir}),value);
  for(const path of ['../proof.json','artifacts/../proof.json','C:/private.json','artifacts\\bradbury\\proof.json','artifacts/bradbury/session-old.json'])await assert.rejects(()=>readReviewedPublicFile(path,sha256(raw),{root:dir}));
  await writeFile(resolve(dir,'artifacts/bradbury/large.json'),'x'.repeat(1048577));await assert.rejects(()=>readReviewedPublicFile('artifacts/bradbury/large.json','0'.repeat(64),{root:dir}),/SIZE/);
 }finally{const absolute=await realpath(dir),safe=await realpath(artifacts);assert.ok(absolute.startsWith(safe+sep));await rm(absolute,{recursive:true,force:true});}
});

test('recovery derives actual ID only from successful NewTransaction event, independent of simulated call result',async()=>{
 const e=harness();await e.inspect();const r=e.inspection.deploymentRequest,evmHash=keccak256(RAW),protocol='0x'+'c'.repeat(64),recipient='0x'+'d'.repeat(40);
 const event=parseAbiItem('event NewTransaction(bytes32 indexed txId,address indexed recipient,address indexed activator)');
 const log={address:registry.ConsensusMain,topics:encodeEventTopics({abi:[event],eventName:'NewTransaction',args:{txId:protocol,recipient,activator:address}}),data:'0x',removed:false};
 const receipt={transactionHash:evmHash,blockNumber:218300n,blockHash:H,status:'success',logs:[log]};
 const tx={hash:evmHash,from:address,to:r.to,nonce:0,input:r.data,value:BigInt(r.value),gas:BigInt(r.gas),gasPrice:BigInt(r.gasPrice)};
 const ctx={metadata:e.context.metadata,reader:{getTransactionReceipt:async()=>receipt,getTransaction:async()=>tx,getBlock:async()=>({hash:H})}};
 const proof=await recoverEnvelope(evmHash,r,ctx);assert.equal(proof.protocolTxId,protocol);assert.notEqual(proof.protocolTxId,OTHER);assert.equal(proof.newTransactionEventVerified,true);assert.equal(proof.protocolConsensusVerified,false);
 receipt.logs=[];assert.equal((await recoverEnvelope(evmHash,r,ctx)).protocolTxId,null);receipt.logs=[log];receipt.status='reverted';assert.equal((await recoverEnvelope(evmHash,r,ctx)).protocolTxId,null);
});

test('opaque errors never expose RPC/signer messages, raw envelopes or credential-shaped hex',()=>{
 const secret='0x'+'f'.repeat(64),value=safeFailure(new Error('private='+secret+' raw='+RAW));assert.equal(JSON.stringify(value).includes(secret),false);assert.equal(JSON.stringify(value).includes(RAW),false);assert.equal(value.code,'UNTRUSTED_OPERATION_FAILED');
});
