// One new diagnostic point justified by recorded 27M/29M successful deployments.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {connectBradbury} from './bradbury-client.mjs';
import {sha256} from './probe-public-codec.mjs';
assert.ok(process.argv.includes('--run'));
const input=JSON.parse(await readFile('artifacts/bradbury/sufficiency-probe/positive-gas-diagnostic-request.json'));
const historyBytes=await readFile('artifacts/bradbury/sufficiency-probe/gas-historical-success.json'),history=JSON.parse(historyBytes);
assert.equal(input.sourceSha256,'b931e3b582ad96e934a985ca1d21a955ce3e2ea910eae2e3918e2c7896f290de');
assert.equal(sha256(await readFile('contracts/research_receipt_sufficiency_probe.py')),input.sourceSha256);
assert.equal(sha256(input.request.data),input.requestDataSha256);
assert.ok(history.results.every(r=>r.status==='0x1'&&BigInt(r.gasUsed)>10000000n));
const c=await connectBradbury(),block=await c.publicClient.getBlock({blockNumber:218030n});
assert.equal(block.hash,'0x58e6d71bb03abd4632f20e0997bcd3d8c5465dca44be8e35adea3afc3e74f17d');
const request={...input.request,gas:'0x5f5e100'},params=[request,'0x353ae'];
const report={format:'research-receipt/measured-bound-evm-diagnostic/1',startedAt:new Date().toISOString(),sourceSha256:input.sourceSha256,requestDataSha256:input.requestDataSha256,blockHash:block.hash,historyEvidenceSha256:sha256(historyBytes),upperGas:'100000000',purpose:'One read-only diagnostic bound, not a sending gas recommendation or calibrated maximum',maximumCalls:2,signatures:0,chainTransactionsSent:0,modelCalls:0,observations:[]};
const file='artifacts/bradbury/sufficiency-probe/gas-100m-matrix.json';
await writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
for(const method of ['eth_call','eth_estimateGas']){
 const response=await fetch('https://rpc-bradbury.genlayer.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
 const raw={method,params,observedAt:new Date().toISOString(),httpStatus:response.status,response:await response.json()};
 const rawFile=`artifacts/bradbury/sufficiency-probe/gas-100m-${method}.json`;
 await writeFile(rawFile,JSON.stringify(raw,null,2)+'\n',{flag:'wx'});
 const result=raw.response.result;
 const summary={method,rawFile,rpcCode:raw.response.error?.code??null,result:method==='eth_estimateGas'&&typeof result==='string'&&/^0x[0-9a-f]+$/i.test(result)?String(BigInt(result)):null,resultDataSha256:typeof result==='string'?sha256(result):null,errorMessageSha256:raw.response.error?sha256(String(raw.response.error.message||'')):null};
 report.observations.push(summary);await writeFile(file,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary));
}
report.completedAt=new Date().toISOString();await writeFile(file,JSON.stringify(report,null,2)+'\n');
