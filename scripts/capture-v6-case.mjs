// Explicit, read-only case observations. No signing, writes to chain, polling,
// ledger editing, gate decisions or case-pass claims.
import assert from 'node:assert/strict';
import { readFile,realpath,stat,mkdir,open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve,relative,isAbsolute,dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abi,decodeInputData } from 'genlayer-js';
import { encodeEventTopics } from 'viem';
import { BRADBURY,PROJECT_ROOT,connectBradbury,safeError } from './bradbury-client.mjs';
import { loadV6Inputs,PLAN_SHA256,DEPLOYMENT_SOURCE_SHA256,verifyV6Inclusion,transactionOutcome } from './collect-v6-evidence.mjs';
import { canonicalEvidenceJson } from '../src/lib/evidence-snapshot.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const hash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value);
const address=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/i.test(value);
const same=(left,right)=>address(left)&&address(right)&&left.toLowerCase()===right.toLowerCase();
const requireValue=(condition,message)=>{if(!condition)throw new Error(message);};
const parseObject=value=>typeof value==='string'?JSON.parse(value):value;
const now=()=>new Date().toISOString();
const decoded=tx=>tx.txDataDecoded||(typeof tx.tx_data==='string'?decodeInputData(tx.tx_data.startsWith('0x')?tx.tx_data:'0x'+tx.tx_data,tx.recipient):null);
const empty=value=>value instanceof Map?value.size===0:value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===0;
const field=(value,key)=>value instanceof Map?value.get(key):value?.[key];

// 从 Bradbury gen_call 返回的 Go VMResult ReturnData 字节数组中精确解码 GenVM UserError。
export function extractGenCallUserError(error) {
  let cur=error;
  for(let depth=0;cur&&depth<8;depth++,cur=cur.cause) {
    for(const text of [cur.details,cur.message,cur.shortMessage]) {
      if(typeof text!=='string')continue;
      const match=text.match(/ReturnData:\[\]uint8\{([^}]+)\}/);
      if(!match)continue;
      const tokens=match[1].split(',').map(s=>s.trim()).filter(Boolean);
      if(!tokens.length||tokens.length>8192)continue;
      const nums=tokens.map(t=>(/^0x[0-9a-fA-F]{1,2}$/.test(t)?parseInt(t,16):/^\d{1,3}$/.test(t)?Number(t):NaN));
      if(nums.some(n=>!Number.isInteger(n)||n<0||n>255))continue;
      const bytes=Uint8Array.from(nums);
      try {
        const decodedMap=abi.calldata.decode(bytes);
        if(decodedMap instanceof Map&&decodedMap.get('kind')==='UserError'&&typeof decodedMap.get('data')==='string'&&Buffer.from(abi.calldata.encode(decodedMap)).equals(Buffer.from(bytes)))return decodedMap.get('data');
      } catch {
        // 非标准 GenVM calldata 映射时回退至安全错误摘要
      }
    }
  }
  return null;
}

export function caseCaptureManifest(inputs,{caseName,stage}={}) {
  return {format:'research-receipt/v6-case-capture-manifest/1',networkRequests:0,capturePerformed:false,cases:inputs.plan.cases.filter(row=>row.sequence>=2&&(!caseName||row.name===caseName)).map(row=>({sequence:row.sequence,name:row.name,method:row.method,stage:stage||null}))};
}

export function validateCaptureOptions(inputs,options) {
  const planned=inputs.plan.cases.find(row=>row.name===options.caseName);
  requireValue(planned&&planned.sequence>=2,'Capture supports only frozen cases 2..51; deployment baseline is recorded by its independent verifier.');
  requireValue(['before','after'].includes(options.stage)&&address(options.address),'Exact stage and deployed contract address are required.');
  requireValue(options.stage==='after'?hash(options.hash):options.hash===undefined,'After requires an actual protocol ID; before must not bind a future hash.');
  requireValue(typeof options.deploymentProofFile==='string'&&options.deploymentProofFile,'A real independent deployment proof file is required.');
  return planned;
}

export async function validateCaptureDeploymentProof(inputs,proof,connection,{address:target}={}) {
  const expectedPlanSha=inputs?.planSha256||PLAN_SHA256;
  const expectedSourceSha=inputs?.deploymentSourceSha256||DEPLOYMENT_SOURCE_SHA256;
  requireValue(proof?.format==='research-receipt/v6-capture-deployment-proof/1'&&proof.planSha256===expectedPlanSha&&proof.sourceSha256===expectedSourceSha,'Deployment proof is not bound to the frozen V6 source/plan.');
  requireValue(same(proof.contractAddress,target)&&address(proof.actorAddress)&&hash(proof.protocolTxId)&&proof.deploymentSourceVerified===true&&proof.finalized===true&&proof.consensusAccepted===true&&proof.execution==='FINISHED_WITH_RETURN','Invalid independent deployment identity or outcome.');
  if(inputs?.plan?.executionAuthority==='user-controlled-wallet')requireValue(same(proof.actorAddress,inputs.plan.actorCommitment.actors.owner),'Deployment proof actor does not match locked wallet owner.');
  requireValue(Array.isArray(proof.constructorArgs)&&proof.constructorArgs.length===0&&proof.leaderOnly===false,'Deployment proof must commit empty constructor arguments and non-leader-only execution.');
  requireValue(proof.network?.chainId===BRADBURY.chainId&&proof.network.genesisHash===BRADBURY.genesisHash&&same(proof.network.addressManager,BRADBURY.addressManager),'Independent deployment proof network mismatch.');
  requireValue(connection.metadata?.chainId===BRADBURY.chainId&&connection.metadata.genesisHash===BRADBURY.genesisHash&&same(connection.metadata.addressManager,BRADBURY.addressManager),'Fresh collector connection network mismatch.');
  const tx=await connection.client.getTransaction({hash:proof.protocolTxId});
  const actualHash=tx.txId||tx.hash||tx.tx_id;
  requireValue(actualHash?.toLowerCase()===proof.protocolTxId.toLowerCase()&&same(tx.sender,proof.actorAddress)&&same(tx.recipient,target)&&transactionOutcome(tx,'RETURN').passed,'Fresh deployment transaction identity/outcome mismatch.');
  const input=decoded(tx);
  requireValue(input?.type==='deploy'&&same(input.contractAddress,target)&&input.leaderOnly===false&&empty(input.constructorArgs)&&typeof input.code==='string'&&sha(Buffer.from(input.code,'utf8'))===expectedSourceSha,'Fresh actual deployed bytes, constructor or leader flag mismatch.');
  requireValue(proof.inclusion?.verified===true&&proof.inclusion.protocolTxId?.toLowerCase()===proof.protocolTxId.toLowerCase()&&/^\d+$/.test(String(proof.inclusion.blockNumber)),'Missing independent deployment inclusion.');
  const inclusion=await verifyV6Inclusion(connection,{hash:proof.protocolTxId,envelopeHash:proof.inclusion.envelopeHash,submittedAfterBlock:String(proof.inclusion.blockNumber)},proof,proof.actorAddress,{inclusion:async()=>proof.inclusion});
  return {protocolTxId:proof.protocolTxId,contractAddress:target,actorAddress:proof.actorAddress,sourceSha256:expectedSourceSha,inclusion,freshActualSourceVerified:true};
}

function publicTransactionMetadata(tx) {
  const input=decoded(tx),call=input?.type==='call'?input.callData:null;
  const scalar=value=>['string','number','boolean'].includes(typeof value)?value:typeof value==='bigint'?String(value):null;
  const args=field(call,'args');
  const normalizedArgs=Array.isArray(args)?args.map(value=>typeof value==='bigint'?{abiInteger:String(value)}:typeof value==='number'?{abiInteger:String(value)}:typeof value==='string'?{abiString:value}:null):null;
  return {protocolTxId:scalar(tx.txId||tx.hash||tx.tx_id),sender:scalar(tx.sender),recipient:scalar(tx.recipient),status:scalar(tx.statusName),execution:scalar(tx.txExecutionResultName),consensusOutcome:scalar(tx.lifecycle?.outcome),consensusResult:scalar(tx.resultName),consensusResultCode:scalar(tx.result),createdTimestamp:scalar(tx.createdTimestamp),currentTimestamp:scalar(tx.currentTimestamp),round:scalar(tx.lastRound?.round),txExecutionHash:scalar(tx.txExecutionHash),...(Object.hasOwn(tx,'datetime')?{datetime:scalar(tx.datetime)}:{}),inputType:scalar(input?.type),leaderOnly:scalar(input?.leaderOnly),method:scalar(field(call,'')),argumentCommitment:normalizedArgs?sha(canonicalEvidenceJson(normalizedArgs)):null};
}

// Collect raw latest-final values into an in-memory object; callers must opt in
// explicitly even when providing an offline fake connection.
export async function captureV6Case(options,dependencies={}) {
  requireValue(options?.capture===true,'Explicit capture option required; default mode performs zero RPC.');
  const inputs=dependencies.inputs||await loadV6Inputs(),planned=validateCaptureOptions(inputs,options);
  const clock=dependencies.now||now;
  const connection=dependencies.connection||await connectBradbury();
  const proof=dependencies.deploymentProof;
  requireValue(proof,'Independent deployment proof must be supplied by the file wrapper.');
  const deploymentVerification=await validateCaptureDeploymentProof(inputs,proof,connection,{address:options.address});
  const result={format:'research-receipt/v6-case-capture/1',planSha256:inputs.planSha256||PLAN_SHA256,sequence:planned.sequence,name:planned.name,stage:options.stage,address:options.address,protocolTxId:options.hash||null,startedAt:clock(),captureComplete:true,capturePerformed:true,sourceDeployment:deploymentVerification,network:{chainId:connection.metadata.chainId,genesisHash:connection.metadata.genesisHash,addressManager:connection.metadata.addressManager},rawReads:[],errors:[]};
  if(options.stage==='after') {
    const tx=await connection.client.getTransaction({hash:options.hash});
    const actualHash=tx.txId||tx.hash||tx.tx_id;
    requireValue(actualHash?.toLowerCase()===options.hash.toLowerCase()&&tx.statusName==='FINALIZED','Actual after transaction is not FINALIZED; capture never polls.');
    if(inputs.plan.executionAuthority==='user-controlled-wallet')requireValue(same(tx.sender,inputs.plan.actorCommitment.actors.owner)&&same(tx.recipient,options.address),'After transaction sender or recipient does not match locked wallet/contract.');
    result.finalizedAt=clock();result.transaction=publicTransactionMetadata(tx);
  }
  const keys=new Set();
  const read=async(method,args=[],expectedError)=>{
    const key=canonicalEvidenceJson([method,args]);if(keys.has(key))return result.rawReads.find(row=>canonicalEvidenceJson([row.method,row.args])===key);keys.add(key);
    const row={method,args,variant:'latest-final'};
    try {row.value=await connection.client.readContract({address:options.address,functionName:method,args,transactionHashVariant:'latest-final'});}
    catch(error) {const userError=extractGenCallUserError(error);row.error={message:userError||safeError(error)};if(expectedError&&row.error.message.includes(expectedError))row.expectedErrorObserved=true;else {result.captureComplete=false;result.errors.push({method,args,error:row.error.message});}}
    row.observedAt=clock();result.rawReads.push(row);return row;
  };
  const countRead=await read('get_order_count');await read('get_policy_version');await read('get_field_catalog');
  const id=planned.readbackOracle.orderId;
  const pendingCreate=options.stage==='before'&&planned.method==='create_order'&&!planned.readbackOracle.rollback&&Object.hasOwn(countRead,'value')&&Number.isSafeInteger(countRead.value)&&id>countRead.value;
  if(pendingCreate)await read('get_order_id',[inputs.fixture[planned.inputCase].client_ref]);
  const orderRead=pendingCreate?{}:await read('get_order',[id]);let order;
  if(Object.hasOwn(orderRead,'value')) {
    try {order=parseObject(orderRead.value);requireValue(order?.id===id&&Number.isSafeInteger(order.revision_count)&&order.revision_count>=0&&order.revision_count<=5&&typeof order.spec?.client_ref==='string','Malformed current order readback.');}
    catch(error) {order=undefined;result.captureComplete=false;result.errors.push({method:'get_order',args:[id],error:safeError(error)});}
  }
  if(order&&typeof order.spec?.client_ref==='string') {
    await read('get_order_id',[order.spec.client_ref]);
    for(let revision=1;revision<=order.revision_count;revision++) {
      await read('get_revision',[id,revision]);await read('get_evidence_snapshot',[id,revision]);await read('get_assessment',[id,revision]);
    }
    if(order.revision_count===0) {await read('get_evidence_snapshot',[id,1]);await read('get_assessment',[id,1]);}
  }
  for(const required of planned.readbackOracle.beforeAfterEqualReads||[])await read(required.method,required.args);
  const absent=planned.readbackOracle.absentRevision;if(absent)await read(absent.method,absent.args,absent.expectedError);
  result.captureCompletedAt=clock();
  return result;
}

async function proofFile(name) {
  requireValue(typeof name==='string'&&!isAbsolute(name),'Deployment proof must be a project-relative file.');
  const base=await realpath(PROJECT_ROOT),path=await realpath(resolve(base,name));
  const rel=relative(base,path);requireValue(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'Deployment proof escapes project.');
  const details=await stat(path);requireValue(details.isFile()&&details.size<=1024*1024,'Deployment proof must be a public JSON file under 1MiB.');
  const bytes=await readFile(path);return {proof:JSON.parse(bytes),sha256:sha(bytes)};
}

export async function saveV6Capture(options,dependencies={}) {
  requireValue(options?.capture===true,'Explicit capture required.');
  const inputs=dependencies.inputs||await loadV6Inputs({planFile:options.planFile,planSha256:options.planSha256,deploymentSourceSha256:options.deploymentSourceSha256}),planned=validateCaptureOptions(inputs,options);
  const imported=await proofFile(options.deploymentProofFile);
  const base=`${String(planned.sequence).padStart(2,'0')}-${planned.name}`;
  const defaultCaptureDir=inputs.plan.executionRun==='v6-wallet-4'?'artifacts/bradbury/v6-wallet-4/cases':inputs.plan.executionRun==='v6-wallet-3'?'artifacts/bradbury/v6-wallet-3/cases':inputs.plan.executionRun==='v6-wallet-2'?'artifacts/bradbury/v6-wallet-2/cases':'artifacts/bradbury/v6/cases';
  const file=resolve(PROJECT_ROOT,`${options.captureDir||defaultCaptureDir}/${base}-${options.stage}.json`);
  for(const stage of ['before','after']) {
    try {
      const prior=JSON.parse(await readFile(resolve(dirname(file),`${base}-${stage}.json`),'utf8'));
      requireValue(prior.address?.toLowerCase()===options.address.toLowerCase(),'Existing case capture belongs to another contract.');
      requireValue(!prior.protocolTxId||!options.hash||prior.protocolTxId.toLowerCase()===options.hash.toLowerCase(),'Another actual protocol hash is already bound to this case.');
    } catch(error) {if(error.code!=='ENOENT')throw error;}
  }
  await mkdir(dirname(file),{recursive:true});
  const handle=await open(file,'wx'); // Durable claim prevents replacement/resampling.
  let result={format:'research-receipt/v6-case-capture/1',sequence:planned.sequence,name:planned.name,stage:options.stage,address:options.address,protocolTxId:options.hash||null,captureComplete:false,capturePerformed:false,state:'CAPTURE_RESERVED',rawReads:[],errors:[]};
  try {
    await handle.writeFile(JSON.stringify(result)+'\n');await handle.sync();
    try {result=await captureV6Case(options,{...dependencies,inputs,deploymentProof:imported.proof});}
    catch(error) {result.errors.push({stage:'capture-precondition-or-rpc',error:safeError(error)});result.captureCompletedAt=now();}
    result.deploymentProofFile=options.deploymentProofFile;result.deploymentProofSha256=imported.sha256;
    const bytes=Buffer.from(JSON.stringify(result,(_,value)=>typeof value==='bigint'?String(value):value,null,2)+'\n');
    await handle.write(bytes,0,bytes.length,0);await handle.truncate(bytes.length);await handle.sync();
  } finally {await handle.close();}
  return {file:relative(PROJECT_ROOT,file).replaceAll('\\','/'),protocolTxId:result.protocolTxId,captureComplete:result.captureComplete,readCount:result.rawReads.length,errors:result.errors};
}

export async function selfTest() {
  const inputs=await loadV6Inputs();let calls=0;
  await assert.rejects(()=>captureV6Case({capture:false},{connection:{client:{getTransaction:async()=>{calls++;}}}}),/Explicit/);
  assert.equal(calls,0);assert.equal(caseCaptureManifest(inputs).cases.length,50);
  assert.throws(()=>validateCaptureOptions(inputs,{caseName:'deployment',stage:'before',address:'0x'+'1'.repeat(40),deploymentProofFile:'test.json'}),/2..51/);
  assert.throws(()=>validateCaptureOptions(inputs,{caseName:'createCorrection',stage:'after',address:'0x'+'1'.repeat(40),deploymentProofFile:'test.json'}),/actual protocol ID/);
  // Fake-RPC checks only: actual source/receipt binding, after-read ordering,
  // unmodified raw values, ordinary failures and the sole expected absence.
  const hex=(length,n)=>'0x'+n.toString(16).padStart(length,'0'),target=hex(40,1),actor=hex(40,2),core=hex(40,3),deploymentHash=hex(64,4),afterHash=hex(64,5),envelopeHash=hex(64,6),blockHash=hex(64,7);
  const inclusion={verified:true,protocolTxId:deploymentHash,envelopeHash,blockHash,blockNumber:'100',logIndex:0,event:'NewTransaction'};
  const network={chainId:4221,genesisHash:BRADBURY.genesisHash,addressManager:BRADBURY.addressManager};
  const proof={format:'research-receipt/v6-capture-deployment-proof/1',planSha256:PLAN_SHA256,contractAddress:target,sourceSha256:DEPLOYMENT_SOURCE_SHA256,protocolTxId:deploymentHash,actorAddress:actor,deploymentSourceVerified:true,finalized:true,consensusAccepted:true,execution:'FINISHED_WITH_RETURN',constructorArgs:[],leaderOnly:false,inclusion,network};
  const topics=encodeEventTopics({abi:[{type:'event',name:'NewTransaction',inputs:[{name:'txId',type:'bytes32',indexed:true},{name:'recipient',type:'address',indexed:true},{name:'activator',type:'address',indexed:true}]}],eventName:'NewTransaction',args:{txId:deploymentHash,recipient:target,activator:actor}});
  let ticks=0,ordinaryFailure=false,absent=false;const fakeReads=[];
  const clock=()=>new Date(Date.UTC(2026,10,5,16,0,0)+ticks++).toISOString();
  const connection={metadata:{...network,addresses:{ConsensusMain:core}},client:{getTransaction:async({hash})=>hash===deploymentHash?{txId:deploymentHash,sender:actor,recipient:target,statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:{outcome:'accepted'},result:1,txDataDecoded:{type:'deploy',contractAddress:target,code:inputs.source,constructorArgs:{},leaderOnly:false}}:{txId:afterHash,sender:actor,recipient:target,statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_ERROR',lifecycle:{outcome:'accepted'},result:1,txDataDecoded:{type:'call',callData:new Map([['','evaluate'],['args',[1n,1n]]]),leaderOnly:false}},readContract:async request=>{
    fakeReads.push(request);assert.equal(request.transactionHashVariant,'latest-final');
    if(request.functionName==='get_order_count')return absent?3:1;
    if(request.functionName==='get_policy_version')return 'research-receipt/6';
    if(request.functionName==='get_field_catalog')return JSON.stringify(inputs.catalog);
    if(request.functionName==='get_order')return JSON.stringify({id:request.args[0],revision_count:absent?0:1,spec:{client_ref:'fake-raw-ref'}});
    if(request.functionName==='get_order_id')return absent?3:1;
    if(request.functionName==='get_revision'){if(absent)throw new Error('Revision not found');return ' {"raw":true} ';}
    if(request.functionName==='get_assessment'&&ordinaryFailure)throw new Error('offline actual');
    return '';
  }},publicClient:{getTransactionReceipt:async()=>({status:'success',transactionHash:envelopeHash,blockHash,blockNumber:100n,to:core,logs:[{address:core,logIndex:0,topics,data:'0x'}]}),getTransaction:async()=>({hash:envelopeHash,from:actor,to:core}),getBlock:async()=>({hash:blockHash})}};
  const options={capture:true,caseName:'evaluateBeforeEvidence',stage:'after',address:target,hash:afterHash,deploymentProofFile:'offline-double.json'};
  const success=await captureV6Case(options,{inputs,connection,deploymentProof:proof,now:clock});
  assert.equal(success.captureComplete,true);assert.ok(success.rawReads.every(row=>row.observedAt>=success.finalizedAt));assert.equal(success.rawReads.find(row=>row.method==='get_revision').value,' {"raw":true} ');
  ordinaryFailure=true;const failed=await captureV6Case(options,{inputs,connection,deploymentProof:proof,now:clock});assert.equal(failed.captureComplete,false);assert.equal(failed.rawReads.find(row=>row.method==='get_assessment').error.message,'offline actual');
  ordinaryFailure=false;absent=true;const missing=await captureV6Case({...options,caseName:'ownerSubmitWrongAuthor',stage:'before',hash:undefined},{inputs,connection,deploymentProof:proof,now:clock});assert.equal(missing.captureComplete,true);assert.equal(missing.rawReads.find(row=>row.method==='get_revision').expectedErrorObserved,true);
  // 验证真实 Bradbury gen_call InvalidParamsRpcError 中 Go []uint8{0x...} ReturnData 的精确 UserError 解码。
  const encodedErr=Buffer.from(abi.calldata.encode(new Map([['kind','UserError'],['data','Revision not found']])));
  const goBytes=[...encodedErr].map(b=>'0x'+b.toString(16)).join(', ');
  const rpcErr=Object.assign(new Error('Missing or invalid parameters.'),{name:'InvalidParamsRpcError',shortMessage:'Missing or invalid parameters.',details:`GenLayer RPC error (gen_call): execution failed: &genvm.VMResult{Kind:0x1, ReturnData:[]uint8{${goBytes}}}: genvm execution error`});
  assert.equal(extractGenCallUserError(rpcErr),'Revision not found');
  return {selfTest:'passed',fakeRpcReadChecks:fakeReads.length,networkRequests:0,signatures:0,chainWrites:0};
}

async function main() {
  const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
  if(args.includes('--self-test')){console.log(JSON.stringify(await selfTest()));return;}
  const planArgs={planFile:option('--plan-file'),planSha256:option('--plan-sha'),deploymentSourceSha256:option('--deployment-source-sha')};
  if(!args.includes('--capture')) {console.log(JSON.stringify(caseCaptureManifest(await loadV6Inputs(planArgs),{caseName:option('--case'),stage:option('--stage')}),null,2));return;}
  const result=await saveV6Capture({capture:true,caseName:option('--case'),stage:option('--stage'),address:option('--address'),hash:option('--hash'),deploymentProofFile:option('--deployment-proof'),captureDir:option('--capture-dir'),...planArgs});
  console.log(JSON.stringify(result));if(!result.captureComplete)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
