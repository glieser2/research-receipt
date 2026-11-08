// Exactly four EVM read simulations, one fixed block, no signer or gas sending.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {connectBradbury} from './bradbury-client.mjs';
import {sha256,hexBytes} from './probe-public-codec.mjs';
assert.ok(process.argv.includes('--run'),'Explicit --run is required');
const input=JSON.parse(await readFile('artifacts/bradbury/sufficiency-probe/positive-gas-diagnostic-request.json'));
assert.equal(input.sourceSha256,'b931e3b582ad96e934a985ca1d21a955ce3e2ea910eae2e3918e2c7896f290de');
assert.equal(sha256(await readFile('contracts/research_receipt_sufficiency_probe.py')),input.sourceSha256);
assert.equal(sha256(await readFile('src/fee-profile.json')),input.feeProfileSha256);
assert.equal(sha256(input.request.data),input.requestDataSha256);
assert.deepEqual(Object.keys(input.request).sort(),['data','from','to','value']);
const connection=await connectBradbury();
const block=await connection.publicClient.getBlock({blockNumber:218030n});
assert.equal(block.hash,'0x58e6d71bb03abd4632f20e0997bcd3d8c5465dca44be8e35adea3afc3e74f17d');
const blockTag='0x353ae',file='artifacts/bradbury/sufficiency-probe/gas-fixed-block-matrix.json';
const report={format:'research-receipt/fixed-block-evm-diagnostic/1',startedAt:new Date().toISOString(),requestDataSha256:input.requestDataSha256,sourceSha256:input.sourceSha256,blockNumber:'218030',blockHash:block.hash,maximumRpcSimulations:4,explicitGasIsDiagnosticOnly:'10000000',signatures:0,chainTransactionsSent:0,genCallRequests:0,observations:[]};
await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
for(const [label,method,request]of [['default-call','eth_call',input.request],['default-estimate','eth_estimateGas',input.request],['bounded-call','eth_call',{...input.request,gas:'0x989680'}],['bounded-estimate','eth_estimateGas',{...input.request,gas:'0x989680'}]]){
 const params=[request,blockTag];
 const raw={label,method,params,startedAt:new Date().toISOString()};
 try{
  const response=await fetch('https://rpc-bradbury.genlayer.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
  raw.httpStatus=response.status;raw.response=await response.json();
 }catch(error){raw.transportError={name:error.name};}
 raw.completedAt=new Date().toISOString();
 const rawFile=`artifacts/bradbury/sufficiency-probe/gas-fixed-block-${label}.json`;
 await writeFile(rawFile,JSON.stringify(raw,null,2)+'\n',{flag:'wx'});
 const resultBytes=hexBytes(raw.response?.result),revertBytes=hexBytes(raw.response?.error?.data);
 const summary={label,method,rawFile,httpStatus:raw.httpStatus||null,rpcCode:raw.response?.error?.code??null,result:method==='eth_estimateGas'&&typeof raw.response?.result==='string'?raw.response.result:null,resultBytes:resultBytes?.length??null,resultSha256:resultBytes?sha256(resultBytes):null,revertSelector:revertBytes&&revertBytes.length>=4?'0x'+revertBytes.subarray(0,4).toString('hex'):null,errorMessageSha256:raw.response?.error?sha256(String(raw.response.error.message||'')):null,transportError:raw.transportError||null};
 report.observations.push(summary);await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary));
}
report.completedAt=new Date().toISOString();await writeFile(file,JSON.stringify(report,null,2)+'\n');
