// Independent, bounded, read-only EVM check. No signing, send or model calls.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createPublicClient,http,decodeFunctionData,encodeFunctionData} from 'viem';
import {abi,decodeInputData} from 'genlayer-js';
import {connectBradbury,quoteDevelopmentProfile,publicJson,BRADBURY,REQUIRED_NAMES} from './bradbury-client.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const keys=(x,want)=>assert.deepEqual(Object.keys(x).sort(),[...want].sort());
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0&&process.argv[i+1],name+' required');return process.argv[i+1];};
assert.ok(process.argv.includes('--run'),'Explicit --run required');
const file=arg('--inspection-file'),expectedHash=arg('--inspection-sha');
const bytes=await readFile(file);assert.equal(sha(bytes),expectedHash);
const inspection=JSON.parse(bytes),r=inspection.deploymentRequest;
assert.equal(inspection.format,'research-receipt/v6-gas-aware-inspection/1');assert.equal(inspection.gasMode,'manual');
const planBytes=await readFile('docs/evidence/v6-validation-plan.json'),p=JSON.parse(planBytes);
assert.equal(sha(planBytes),'c731fb736abc2bf2c70e48d5a72cd1e72195a0bc25aa50070d7a9a28564b506e');
assert.equal(inspection.planSha256,sha(planBytes));assert.equal(inspection.sourceSha256,p.deploymentSourceCommitment.sha256);
for(const commitment of [p.sourceCommitment,p.deploymentSourceCommitment,p.catalogCommitment,p.buildCommitment,p.feeProfileCommitment])assert.equal(sha(await readFile(commitment.file)),commitment.sha256);
keys(r,['chainId','from','to','data','value','nonce','gas','gasPrice','type']);
for(const k of ['chainId','value','nonce','gas','gasPrice'])assert.match(r[k],/^(0|[1-9][0-9]*)$/);
assert.equal(r.chainId,'4221');assert.equal(r.type,'legacy');assert.equal(r.gas,'100000000');assert.match(r.from,/^0x[0-9a-f]{40}$/);assert.match(r.to,/^0x[0-9a-f]{40}$/);assert.notEqual(r.from,p.actorCommitment.actors.owner.toLowerCase());
assert.equal(inspection.deploymentRequestHash,sha(canonical(r)));assert.equal(inspection.gasLimit,r.gas);assert.equal(inspection.gasPriceWei,r.gasPrice);
const cost=BigInt(r.value)+BigInt(r.gas)*BigInt(r.gasPrice);
assert.equal(String(cost),inspection.maxTotalCostWei);assert.ok(cost<=50000000000000000n,'Hard total deployment bound is 0.05 test GEN');
assert.ok(['https://rpc-bradbury.genlayer.com','https://rpc.testnet-chain.genlayer.com'].includes(inspection.l2Endpoint));
const proofFile='artifacts/bradbury/v6/manual-gas-proof-'+expectedHash+'.json';
const proof={format:'research-receipt/v6-manual-gas-exact-call-proof/1',verified:false,planSha256:sha(planBytes),sourceSha256:inspection.sourceSha256,chainId:4221,genesisHash:BRADBURY.genesisHash,addressManager:BRADBURY.addressManager,registryAddresses:inspection.registryAddresses,l2Endpoint:inspection.l2Endpoint,deploymentRequest:r,deploymentRequestHash:inspection.deploymentRequestHash,gasLimit:r.gas,gasPriceWei:r.gasPrice,maxTotalCostWei:String(cost),validUntil:inspection.validUntil,simulationOnly:true,consensusProven:false,signatures:0,chainTransactionsSent:0,modelCalls:0,inspectionFile:file,inspectionSha256:expectedHash,ethCallRequestsStarted:0};
await writeFile(proofFile,publicJson(proof)+'\n',{flag:'wx'});
try{
 const c=await connectBradbury();assert.equal(inspection.chainId,4221);assert.equal(inspection.genesisHash,BRADBURY.genesisHash);assert.equal(inspection.addressManager.toLowerCase(),BRADBURY.addressManager.toLowerCase());assert.equal(canonical(inspection.registryAddresses),canonical(c.metadata.addresses));
 assert.equal(r.to,c.metadata.addresses.ConsensusMain.toLowerCase());
 const reader=createPublicClient({transport:http(inspection.l2Endpoint,{retryCount:0,timeout:25000})});
 const [chainId,genesis,head]=await Promise.all([reader.getChainId(),reader.getBlock({blockNumber:0n}),reader.getBlock()]);
 assert.equal(chainId,4221);assert.equal(genesis.hash,BRADBURY.genesisHash);
 const primaryHead=await c.publicClient.getBlock({blockNumber:head.number});assert.equal(head.hash,primaryHead.hash);
 // Every current registry binding and code must also match the L2 endpoint.
 const registryAbi=[{type:'function',name:'getAddress',stateMutability:'view',inputs:[{type:'string'}],outputs:[{type:'address'}]}];
 for(const name of REQUIRED_NAMES){const address=await reader.readContract({address:BRADBURY.addressManager,abi:registryAbi,functionName:'getAddress',args:[name],blockNumber:head.number});assert.equal(address.toLowerCase(),c.metadata.addresses[name].toLowerCase());const [code,expectedCode]=await Promise.all([reader.getCode({address,blockNumber:head.number}),c.publicClient.getCode({address,blockNumber:head.number})]);assert.ok(code&&code!=='0x');assert.equal(code,expectedCode);}
 const dataRegistry=await reader.readContract({address:c.metadata.addresses.ConsensusData,abi:[{type:'function',name:'addressManager',stateMutability:'view',inputs:[],outputs:[{type:'address'}]}],functionName:'addressManager',blockNumber:head.number});assert.equal(dataRegistry.toLowerCase(),BRADBURY.addressManager.toLowerCase());
 const {quote}=await quoteDevelopmentProfile(c.client);assert.equal(String(quote.feeValue),r.value);
 const decoded=decodeFunctionData({abi:c.chain.consensusMainContract.abi,data:r.data});assert.equal(decoded.functionName,'addTransaction');assert.equal(encodeFunctionData({abi:c.chain.consensusMainContract.abi,functionName:'addTransaction',args:decoded.args}),r.data);
 const params=decoded.args[0];keys(params,['sender','recipient','numOfInitialValidators','maxRotations','validUntil','saltNonce','userValue','feesDistribution','txCalldata','messageAllocations']);
 assert.equal(params.sender.toLowerCase(),r.from);assert.equal(params.recipient,'0x0000000000000000000000000000000000000000');assert.equal(params.numOfInitialValidators,BigInt(c.chain.defaultNumberOfInitialValidators));assert.equal(params.maxRotations,BigInt(c.chain.defaultConsensusMaxRotations));assert.equal(String(params.validUntil),inspection.validUntil);assert.equal(params.saltNonce,0n);assert.equal(params.userValue,0n);assert.deepEqual(params.messageAllocations,[]);assert.equal(canonical(params.feesDistribution),canonical(quote.distribution));
 const code=(await readFile(p.deploymentSourceCommitment.file)).toString('utf8');const deploy=decodeInputData(params.txCalldata,'0x0000000000000000000000000000000000000000');assert.equal(deploy.type,'deploy');assert.equal(deploy.code,code);assert.equal(deploy.leaderOnly,false);assert.deepEqual(deploy.constructorArgs instanceof Map?Object.fromEntries(deploy.constructorArgs):deploy.constructorArgs,{});assert.equal(params.txCalldata,abi.transactions.serialize([code,abi.calldata.encode(abi.calldata.makeCalldataObject(undefined,[])),false]));
 const [latest,pending,balance,gasPrice]=await Promise.all([reader.getTransactionCount({address:r.from,blockNumber:head.number}),reader.getTransactionCount({address:r.from,blockTag:'pending'}),reader.getBalance({address:r.from,blockNumber:head.number}),reader.getGasPrice()]);
 assert.equal(String(latest),r.nonce);assert.equal(latest,pending);assert.equal(String(gasPrice),r.gasPrice);assert.ok(balance>=cost);assert.ok(BigInt(inspection.validUntil)>=head.timestamp+180n,'Insufficient validity window');
 proof.nonceEvidence={latest:String(latest),pending:String(pending),blockNumber:String(head.number),observedAt:new Date().toISOString()};proof.balanceWei=String(balance);proof.networkEvidence={...c.metadata,l2ChainId:chainId,l2GenesisHash:genesis.hash,blockNumber:String(head.number),blockHash:head.hash,registryCodeMatches:true};
 const quantity=x=>'0x'+BigInt(x).toString(16);const request={from:r.from,to:r.to,data:r.data,value:quantity(r.value),gas:quantity(r.gas),gasPrice:quantity(r.gasPrice)};
 proof.ethCallRequestsStarted=1;proof.ethCall={request,blockNumber:String(head.number),blockHash:head.hash,success:false};await writeFile(proofFile,publicJson(proof)+'\n');
 const response=await fetch(inspection.l2Endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[request,quantity(head.number)]}),signal:AbortSignal.timeout(30000)});const body=await response.json();proof.ethCall.response={httpStatus:response.status,body};proof.ethCall.success=response.ok&&body.jsonrpc==='2.0'&&body.id===1&&!Object.hasOwn(body,'error')&&/^0x[0-9a-fA-F]{64}$/.test(body.result||'');if(proof.ethCall.success)proof.ethCall.result=body.result;
 assert.equal(proof.ethCall.success,true,'Exact bounded eth_call failed; this transport must stop');
 assert.equal((await reader.getBlock({blockNumber:head.number})).hash,head.hash);proof.verifiedAt=new Date().toISOString();proof.samePayloadCoverage=['from','to','data','value','gas','gasPrice'];proof.notValidatedByEthCall=['nonce admission','signature','broadcast','GenLayer consensus'];proof.verified=true;
}catch(error){proof.verified=false;proof.error={name:error.name,category:error instanceof assert.AssertionError?error.message:'READ_ONLY_PROOF_ABORTED'};}
proof.completedAt=new Date().toISOString();await writeFile(proofFile,publicJson(proof)+'\n');const finalBytes=await readFile(proofFile);
console.log(publicJson({proofFile,proofSha256:sha(finalBytes),success:proof.ethCall?.success===true&&!proof.error,ethCallRequestsStarted:proof.ethCallRequestsStarted,maxTotalCostWei:proof.maxTotalCostWei,error:proof.error||null,chainTransactionsSent:0,modelCalls:0}));
