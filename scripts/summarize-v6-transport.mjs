// Sanitize immutable read-only transport observations; no RPC or signature.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodeFunctionData} from 'viem';
import {decodeInputData} from 'genlayer-js';
import {overrideChain,publicJson} from './bradbury-client.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const files=['deployment-preflight.json','deployment-preflight-v2.json','official-l2-comparison.json'];
const records=await Promise.all(files.map(async name=>{const bytes=await readFile('artifacts/bradbury/v6/'+name);return{name,sha256:sha(bytes),value:JSON.parse(bytes)};}));
const [first,second,third]=records.map(x=>x.value);
assert.equal(first.estimateCallsStarted,0);assert.equal(second.estimateCallsStarted,1);assert.equal(third.estimateCallsStarted,1);
for(const r of [first,second]){assert.equal(r.schemasExactlyEqual,true);assert.equal(r.signatures,0);assert.equal(r.chainTransactionsSent,0);assert.equal(r.modelCalls,0);assert.equal(r.latestNonce,33);assert.equal(r.pendingNonce,33);}
assert.equal(second.estimateSucceeded,false);assert.equal(third.estimateSucceeded,false);assert.equal(third.networkIdentityVerified,true);
assert.deepEqual(third.exactRequest,second.unsignedRequest.request);
const decoded=decodeFunctionData({abi:overrideChain(second.network.addresses).consensusMainContract.abi,data:third.exactRequest.data});
assert.equal(decoded.functionName,'addTransaction');
const deploy=decodeInputData(decoded.args[0].txCalldata,'0x0000000000000000000000000000000000000000');
assert.equal(deploy.type,'deploy');assert.equal(deploy.leaderOnly,false);assert.deepEqual(deploy.constructorArgs instanceof Map?Object.fromEntries(deploy.constructorArgs):deploy.constructorArgs,{});
assert.equal(sha(deploy.code),second.sourceSha256);
const report={format:'research-receipt/v6-transport-observations/1',collectedAt:new Date().toISOString(),status:'DEPLOYMENT_TRANSPORT_BLOCKED',planSha256:second.planSha256,canonicalSourceSha256:second.canonicalSourceSha256,deploymentSourceSha256:second.sourceSha256,sourceBytes:second.sourceBytes,constructorArgs:[],leaderOnly:false,actor:second.actor,balanceWei:second.balanceWei,latestNonce:33,pendingNonce:33,officialSchemaRequests:4,schemasExactlyEqual:true,estimateRequests:2,signatures:0,chainTransactionsSent:0,modelCalls:0,firstAbort:{reason:'OLD_DIAGNOSTIC_HELPER_EXPECTED_ARGS_ARRAY_IN_EMPTY_CONSTRUCTOR',estimateRequests:0,emptyConstructorSdkRepresentation:{}},estimates:[{endpoint:second.network.rpcUrl,blockMode:'latest',response:second.estimateResponse},{endpoint:third.endpoint,blockMode:'fixed',blockNumber:third.identity.blockNumber,blockHash:third.identity.blockHash,response:third.estimateResponse}],alternateEndpointNetworkIdentity:{...third.identity,registry:third.registry,verified:true},unsignedRequestSha256:sha(Buffer.from(publicJson(third.exactRequest))),rawRecordCommitments:records.map(({name,sha256})=>({file:'artifacts/bradbury/v6/'+name,sha256})),e2eVerified:false,notes:['Both estimates reverted with empty error data. No cause is claimed.','The first local assertion failure preceded estimation; it is not an additional failed estimate.','A separate reviewed bounded-gas transport addendum may be prepared. These records do not authorize retry or mark deployment successful.','Historical 33 protocol transactions and prior failures remain separate and unchanged.']};
await writeFile('docs/evidence/v6-transport-observations.json',publicJson(report)+'\n',{flag:'wx'});
console.log(publicJson({status:report.status,estimateRequests:2,chainTransactionsSent:0,modelCalls:0,output:'docs/evidence/v6-transport-observations.json'}));
