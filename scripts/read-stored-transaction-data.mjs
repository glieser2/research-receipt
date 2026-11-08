// One local-trace-store public read. Official API explicitly never replays.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { publicJson } from './bradbury-client.mjs';
import { publicDataSummary } from './probe-public-codec.mjs';
const hash=process.argv[2];assert.match(hash||'',/^0x[0-9a-fA-F]{64}$/);
const tx=JSON.parse(await readFile(`artifacts/bradbury/${hash}.json`,'utf8'));
const round=Number(tx.lastRound.round);assert.ok(Number.isInteger(round)&&round>=0&&round<=255);
const file=`artifacts/bradbury/public-stored-data-${hash}-round${round}.json`;
const sha=value=>createHash('sha256').update(value).digest('hex');
const request={jsonrpc:'2.0',id:1,method:'gen_getTransactionData',params:[{txId:hash,round}]};
const evidence={format:'research-receipt/public-stored-data/1',readOnly:true,modelCalls:0,chainTransactionsSent:0,apiSemantics:'https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionData explicitly says stored outputs only, never replayed.',request,requestStartedAt:new Date().toISOString()};
await writeFile(file,`${publicJson(evidence)}\n`,{flag:'wx'});
const allowed=new Set(['id','sender','recipient','activator','status','statusName','result','resultName','txExecutionResult','txExecutionResultName','txCallData','txExecutionHash','eqBlocksOutputs','timestamps','round','returnData','leaderPublicData']);
try {
  const response=await fetch('https://rpc-bradbury.genlayer.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(60000)});
  const text=await response.text();evidence.httpStatus=response.status;evidence.responseSha256=sha(text);evidence.responseBytes=Buffer.byteLength(text);
  const json=JSON.parse(text);evidence.responseKeys=Object.keys(json.result||{});
  evidence.result=json.result&&typeof json.result==='object'?Object.fromEntries(Object.entries(json.result).filter(([key])=>allowed.has(key))):null;
  evidence.error=json.error?{code:json.error.code,messageSha256:sha(String(json.error.message||'')),messageBytes:Buffer.byteLength(String(json.error.message||''))}:null;
  if(evidence.result) {
    const value=evidence.result;
    evidence.identityVerified=value.id?.toLowerCase()===hash.toLowerCase()&&value.sender?.toLowerCase()===tx.sender.toLowerCase()&&value.recipient?.toLowerCase()===tx.recipient.toLowerCase()&&value.txExecutionHash?.toLowerCase()===tx.txExecutionHash.toLowerCase()&&value.round===round;
  }
}catch(error){evidence.transportError={name:error.name,code:typeof error.cause?.code==='string'?error.cause.code:null};}
evidence.completedAt=new Date().toISOString();await writeFile(file,`${publicJson(evidence)}\n`);
console.log(publicJson({evidenceFile:file,httpStatus:evidence.httpStatus,identityVerified:evidence.identityVerified,round,resultName:evidence.result?.resultName,execution:evidence.result?.txExecutionResultName,returnData:evidence.result?.returnData===null?null:typeof evidence.result?.returnData==='string'?{bytes:(evidence.result.returnData.replace(/^0x/,'').length/2),sha256:sha(evidence.result.returnData)}:undefined,leaderPublicData:publicDataSummary(evidence.result?.leaderPublicData),error:evidence.error,transportError:evidence.transportError}));
