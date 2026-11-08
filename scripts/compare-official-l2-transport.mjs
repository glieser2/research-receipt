// One read-only comparison against the L2 URL published by GenLayer. Never signs.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,http,parseAbi} from 'viem';
import {BRADBURY,REQUIRED_NAMES,publicJson} from './bradbury-client.mjs';
assert.ok(process.argv.includes('--run'));
const endpoint='https://rpc.testnet-chain.genlayer.com';
const pre=JSON.parse(await readFile('artifacts/bradbury/v6/deployment-preflight-v2.json'));
assert.equal(pre.estimateCallsStarted,1);assert.equal(pre.signatures,0);assert.equal(pre.chainTransactionsSent,0);
const path='artifacts/bradbury/v6/official-l2-comparison.json';
const report={format:'research-receipt/official-l2-transport-comparison/1',startedAt:new Date().toISOString(),endpoint,source:'https://docs.genlayer.com/developers/networks',chainTransactionsSent:0,signatures:0,modelCalls:0,estimateCallsStarted:0};
await writeFile(path,publicJson(report)+'\n',{flag:'wx'});
const rpc=async(method,params)=>{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(25000)});return {httpStatus:response.status,body:await response.json()};};
try{
 const reader=createPublicClient({transport:http(endpoint,{retryCount:0,timeout:25000})});
 const primary=createPublicClient({transport:http(BRADBURY.rpcUrl,{retryCount:0,timeout:25000})});
 const blockNumber=BigInt(pre.network.snapshotBlock);
 const [chainId,genesis,block,originalBlock]=await Promise.all([reader.getChainId(),reader.getBlock({blockNumber:0n}),reader.getBlock({blockNumber}),primary.getBlock({blockNumber})]);
 report.identity={chainId,genesisHash:genesis.hash,blockNumber:String(blockNumber),blockHash:block.hash,primaryBlockHash:originalBlock.hash};
 assert.equal(chainId,BRADBURY.chainId);assert.equal(genesis.hash,BRADBURY.genesisHash);assert.equal(block.hash,originalBlock.hash);
 report.registry=[];
 for(const name of REQUIRED_NAMES){
  const address=await reader.readContract({address:BRADBURY.addressManager,abi:parseAbi(['function getAddress(string) view returns (address)']),functionName:'getAddress',args:[name],blockNumber});
  assert.equal(address.toLowerCase(),pre.network.addresses[name].toLowerCase());
  const [code,originalCode]=await Promise.all([reader.getCode({address,blockNumber}),primary.getCode({address,blockNumber})]);
  assert.ok(code&&code!=='0x');assert.equal(code,originalCode);report.registry.push({name,address,codeMatches:true});
 }
 const registry=await reader.readContract({address:pre.network.addresses.ConsensusData,abi:parseAbi(['function addressManager() view returns (address)']),functionName:'addressManager',blockNumber});
 assert.equal(registry.toLowerCase(),BRADBURY.addressManager.toLowerCase());report.networkIdentityVerified=true;
 report.exactRequest=pre.unsignedRequest.request;report.fixedBlock='0x'+blockNumber.toString(16);
 report.estimateCallsStarted=1;await writeFile(path,publicJson(report)+'\n');
 report.estimateResponse=await rpc('eth_estimateGas',[report.exactRequest,report.fixedBlock]);
 report.estimateSucceeded=typeof report.estimateResponse.body.result==='string'&&/^0x[0-9a-f]+$/i.test(report.estimateResponse.body.result)&&BigInt(report.estimateResponse.body.result)>0n;
}catch(error){report.error={name:error.name,category:error instanceof assert.AssertionError?'NETWORK_IDENTITY_MISMATCH':'READ_ONLY_COMPARISON_ABORTED'};}
report.completedAt=new Date().toISOString();await writeFile(path,publicJson(report)+'\n');
console.log(publicJson({record:path,networkIdentityVerified:report.networkIdentityVerified||false,identity:report.identity,estimateCallsStarted:report.estimateCallsStarted,estimateSucceeded:report.estimateSucceeded||false,error:report.error||null,chainTransactionsSent:0}));
