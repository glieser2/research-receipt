// Exactly one documented, unsigned public receipt read. No model, trace, or write.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PROJECT_ROOT, publicJson } from './bradbury-client.mjs';
const hash=process.argv[2];
if(!/^0x[0-9a-fA-F]{64}$/.test(hash||''))throw new Error('Provide one protocol transaction ID.');
const file=resolve(PROJECT_ROOT,`artifacts/bradbury/public-receipt-${hash}.json`);
const sha=value=>createHash('sha256').update(value).digest('hex');
const request={jsonrpc:'2.0',id:1,method:'gen_getTransactionReceipt',params:[{txId:hash}]};
const evidence={format:'research-receipt/public-receipt-read/1',readOnly:true,modelCalls:0,chainTransactionsSent:0,request,requestStartedAt:new Date().toISOString()};
await writeFile(file,`${publicJson(evidence)}\n`,{flag:'wx'});
const allowed=new Set(['id','txId','sender','recipient','activator','status','statusName','result','resultName','lifecycle','txExecutionResult','txExecutionResultName','txExecutionHash','numOfRounds','lastRound','rounds','timestamps','fees','feeValue','fee','distribution','consumed','executionConsumed','allocations','allocationPolicy','consumedValidatorsCount','consumedValidators','currentTimestamp','txSlot']);
try {
  const response=await fetch('https://rpc-bradbury.genlayer.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(60000)});
  const text=await response.text();
  evidence.httpStatus=response.status;evidence.responseSha256=sha(text);evidence.responseBytes=Buffer.byteLength(text);
  let json;try{json=JSON.parse(text);}catch{throw new Error('NON_JSON_PUBLIC_RESPONSE');}
  evidence.responseKeys=Object.keys(json.result||{});
  evidence.result=json.result&&typeof json.result==='object'?Object.fromEntries(Object.entries(json.result).filter(([key])=>allowed.has(key))):null;
  evidence.error=json.error?{code:json.error.code,messageSha256:sha(String(json.error.message||'')),messageBytes:Buffer.byteLength(String(json.error.message||''))}:null;
}catch(error){evidence.transportError={name:error.name,code:typeof error.cause?.code==='string'?error.cause.code:null};}
evidence.completedAt=new Date().toISOString();
await writeFile(file,`${publicJson(evidence)}\n`);
console.log(publicJson({evidenceFile:`artifacts/bradbury/public-receipt-${hash}.json`,httpStatus:evidence.httpStatus,responseKeys:evidence.responseKeys,result:evidence.result,error:evidence.error,transportError:evidence.transportError}));
