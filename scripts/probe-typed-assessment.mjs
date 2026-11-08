// Bounded unsigned public-node simulations. Never signs or mutates chain state.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deploymentData} from './probe-v3-assessment.mjs';
import {sha256,publicResponse,publicError} from './probe-public-codec.mjs';
import {connectBradbury,contractSource,publicJson} from './bradbury-client.mjs';
const PLAN='docs/evidence/typed-probe-plan.json';
const ROOT='artifacts/bradbury/typed-probe';
const ACTOR='0x29EB14D10ec2E406E5d1419ED08D803b8B18aB70';
const ZERO='0x0000000000000000000000000000000000000000';
const SIMULATION_ORDER=['positive','negative','falseCautionOtherSource','unknownWithPromise','boundaryIncomplete'];
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const keys=(value,expected)=>value&&typeof value==='object'&&!Array.isArray(value)&&canonical(Object.keys(value).sort())===canonical([...expected].sort());
export function validTypedProjection(p){
 return keys(p,['verdict','findings','source_checks'])&&['ACCEPTED','NOT_ACCEPTED','INSUFFICIENT_EVIDENCE'].includes(p.verdict)&&Array.isArray(p.findings)&&p.findings.length===4&&p.findings.every(f=>
  keys(f,['criterion_id','claim_type','validity','status','delivery_status','evidence_indices'])&&typeof f.criterion_id==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(f.criterion_id)&&
  ['factual_assertion','unknown_disclosure','boundary_disclosure'].includes(f.claim_type)&&['VALID','CONTRADICTED','NOT_ESTABLISHED'].includes(f.validity)&&
  ['SUPPORTED','SCOPED_UNKNOWN','BOUNDARY_DISCLOSED','CONTRADICTED','NOT_ESTABLISHED','SOURCE_UNAVAILABLE'].includes(f.status)&&['FULFILLED','INSUFFICIENT','CONTRADICTED'].includes(f.delivery_status)&&
  Array.isArray(f.evidence_indices)&&f.evidence_indices.length<=2&&f.evidence_indices.every((n,i,a)=>Number.isInteger(n)&&n>=0&&n<2&&(i===0||a[i-1]<n)))&&
  Array.isArray(p.source_checks)&&p.source_checks.length===2&&p.source_checks.every((s,i)=>keys(s,['index','status','sha256'])&&s.index===i&&s.status==='VERIFIED'&&typeof s.sha256==='string'&&/^[a-f0-9]{64}$/.test(s.sha256));
}
export function typedMarkers(stdout,version){
 const markers=[];
 for(const line of String(stdout||'').split(/\r?\n/)){
  if(!line.startsWith('RR_TYPED_PROBE_JSON ')||line.length>16384)continue;
  try{const m=JSON.parse(line.slice('RR_TYPED_PROBE_JSON '.length));
   if(m.probe_version!==version)continue;
   if(m.phase==='independent'&&m.stage==='complete'&&validTypedProjection(m.projection)&&Number.isInteger(m.model_calls)&&m.model_calls>=4&&m.model_calls<=5&&Number.isInteger(m.format_repairs)&&m.format_repairs>=0&&m.format_repairs<=1)markers.push({probe_version:m.probe_version,phase:m.phase,stage:m.stage,projection:m.projection,model_calls:m.model_calls,format_repairs:m.format_repairs});
   else if(m.phase==='validator'&&m.stage==='comparison'&&typeof m.equal==='boolean')markers.push({probe_version:m.probe_version,phase:m.phase,stage:m.stage,equal:m.equal});
  }catch{}
 }
 return markers;
}
export function compareTypedResponse(view,item,{validator=false}={}){
 const completed=view.markers.filter(m=>m.phase==='independent'&&m.stage==='complete');
 const comparison=view.markers.filter(m=>m.phase==='validator'&&m.stage==='comparison');
 const m=completed[0];
 return view.status?.code===0&&view.nondetDisagreementCallNo==null&&completed.length===1&&
  Number.isInteger(m?.model_calls)&&m.model_calls>=4&&m.model_calls<=5&&
  Number.isInteger(m?.format_repairs)&&m.format_repairs>=0&&m.format_repairs<=1&&m.model_calls===4+m.format_repairs&&
  canonical(m.projection)===canonical(item.expectedReceipt.assessment)&&
  (!validator||(comparison.length===1&&comparison[0].equal===true));
}
async function main(){
 const planBytes=await readFile(PLAN),plan=JSON.parse(planBytes),fixtureBytes=await readFile(plan.fixtureFile),source=await contractSource(plan.sourceFile);
 assert.equal(sha256(fixtureBytes),plan.fixtureSha256);assert.equal(source.sourceSha256,plan.sourceSha256);
 assert.deepEqual(plan.simulationOrder,SIMULATION_ORDER,'Exactly the reviewed five cases in reviewed order are allowed');
 const fixture=JSON.parse(fixtureBytes),id=process.argv.find(a=>a.startsWith('--case='))?.slice(7),index=plan.simulationOrder.indexOf(id);
 assert.ok(index>=0,'A prelocked case must be explicitly selected');
 const item=plan.expected.find(x=>x.id===id);assert.ok(item);
 const data=deploymentData(source.code,[JSON.stringify(fixture[id])]);
 if(!process.argv.includes('--run')){console.log(JSON.stringify({prepared:true,id,sourceSha256:source.sourceSha256,planSha256:sha256(planBytes),dataSha256:sha256(data),networkRequests:0}));return;}
 assert.equal(process.env.RR_TYPED_PROBE_ACK,source.sourceSha256,'Root must acknowledge the frozen source');
 await mkdir(ROOT,{recursive:true});
 for(const prior of plan.simulationOrder.slice(0,index)){
  const report=JSON.parse(await readFile(resolve(ROOT,`${plan.sourceSha256}-${prior}.json`),'utf8'));
  assert.equal(report.planSha256,sha256(planBytes));assert.equal(report.result?.passed,true,'Prior case must have passed; no skip or resampling');
 }
 const output=resolve(ROOT,`${plan.sourceSha256}-${id}.json`);
 const report={format:'research-receipt/typed-simulation/1',diagnosticOnly:true,chainTransactionsSent:0,sourceSha256:source.sourceSha256,fixtureSha256:sha256(fixtureBytes),planSha256:sha256(planBytes),case:id,expected:item,startedAt:new Date().toISOString(),genCallsStarted:0,maximumGenCalls:2,captures:[]};
 await writeFile(output,publicJson(report)+'\n',{flag:'wx'});
 const save=()=>writeFile(output,publicJson(report)+'\n');
 const rpc=async request=>{
  assert.ok(report.genCallsStarted<2,'Each case allows at most one leader and one validator call');
  const mode=request.leader_public_data?'validator':'leader';report.genCallsStarted++;report.stage=mode+'-started';await save();
  const response=await fetch('https://rpc-bradbury.genlayer.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'gen_call',params:[request]}),signal:AbortSignal.timeout(240000)});
  const body=await response.text();let json;try{json=JSON.parse(body);}catch{report.captures.push({mode,httpStatus:response.status,bodySha256:sha256(body),bodyBytes:Buffer.byteLength(body),category:'NON_JSON'});await save();throw new Error('NON_JSON');}
  const view=json.result?{...publicResponse(json.result),markers:typedMarkers(json.result.stdout,plan.probeVersion)}:null;
  report.captures.push({mode,httpStatus:response.status,bodySha256:sha256(body),bodyBytes:Buffer.byteLength(body),requestDataSha256:sha256(data),result:view,error:json.error?publicError(json.error):null});await save();
  assert.ok(response.ok&&!json.error&&view,'RPC response failed');
  return {raw:json.result,view};
 };
 try{
  await connectBradbury();
  const request={type:'deploy',from:ACTOR,to:ZERO,data,status:'finalized',transaction_hash_variant:'latest-final'};
  const leader=await rpc(request);report.leader=leader.view;await save();
  assert.ok(compareTypedResponse(leader.view,item),'Leader failed full prelocked oracle; stop before validator');
  assert.ok(leader.view.publicData.decoded&&leader.view.publicData.nonemptyHex,'Leader public data unavailable');
  const validator=await rpc({...request,leader_public_data:leader.raw.leaderPublicData});report.validator=validator.view;
  report.result={passed:compareTypedResponse(validator.view,item,{validator:true})&&canonical(leader.view.markers.find(m=>m.stage==='complete')?.projection)===canonical(validator.view.markers.find(m=>m.stage==='complete')?.projection)};
 }catch(error){report.error={name:error.name,category:error instanceof assert.AssertionError?error.message:'DIAGNOSTIC_ABORTED',...(typeof error.cause?.code==='string'?{transportCode:error.cause.code}:{})};report.result={passed:false};}
 report.completedAt=new Date().toISOString();await save();
 console.log(publicJson({case:id,evidenceFile:output,genCallsStarted:report.genCallsStarted,result:report.result,error:report.error,leader:report.leader?.status,validator:report.validator?.status}));
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)await main().catch(error=>{console.error(JSON.stringify({name:error.name,message:error instanceof assert.AssertionError?error.message:'Typed preparation failed'}));process.exitCode=1;});
