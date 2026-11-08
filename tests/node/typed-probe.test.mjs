import test from 'node:test';
import assert from 'node:assert/strict';
import {typedMarkers,compareTypedResponse} from '../../scripts/probe-typed-assessment.mjs';
const version='typed-test/1';
const assessment={verdict:'ACCEPTED',findings:['permissions','withdrawals','audit','limitations'].map(criterion_id=>({criterion_id,claim_type:'boundary_disclosure',validity:'VALID',status:'BOUNDARY_DISCLOSED',delivery_status:'FULFILLED',evidence_indices:[0,1]})),source_checks:[0,1].map(index=>({index,status:'VERIFIED',sha256:'a'.repeat(64)}))};
const marker={probe_version:version,phase:'independent',stage:'complete',projection:assessment,model_calls:4,format_repairs:0};
const comparison={probe_version:version,phase:'validator',stage:'comparison',equal:true};
const view=()=>({status:{code:0},nondetDisagreementCallNo:null,markers:[structuredClone(marker),structuredClone(comparison)]});
const item={expectedReceipt:{assessment}};
test('typed diagnostic accepts exact complete projection and validator comparison',()=>assert.equal(compareTypedResponse(view(),item,{validator:true}),true));
test('typed diagnostic rejects each altered consensus-bearing field',()=>{
 for(const [path,value]of [['claim_type','factual_assertion'],['validity','CONTRADICTED'],['status','SUPPORTED'],['delivery_status','INSUFFICIENT'],['evidence_indices',[0]]]){
  const v=view();v.markers[0].projection.findings[0][path]=value;assert.equal(compareTypedResponse(v,item,{validator:true}),false,path);
 }
 const v=view();v.markers[0].projection.source_checks[0].sha256='b';assert.equal(compareTypedResponse(v,item),false);
});
test('typed diagnostic rejects missing, duplicate and inconsistent markers and budgets',()=>{
 for(const mutate of [v=>v.markers.shift(),v=>v.markers.push(structuredClone(marker)),v=>v.markers[1].equal=false,v=>v.markers[0].model_calls=6,v=>v.markers[0].format_repairs=1,v=>v.status.code=1,v=>v.nondetDisagreementCallNo=0]){
  const v=view();mutate(v);assert.equal(compareTypedResponse(v,item,{validator:true}),false);
 }
});
test('typed marker parser excludes arbitrary stdout and extra fields',()=>{
 const stdout=['secret arbitrary stdout','RR_TYPED_PROBE_JSON '+JSON.stringify({...marker,secret:'do-not-retain'}),'RR_TYPED_PROBE_JSON '+JSON.stringify({...marker,probe_version:'wrong'}),'RR_TYPED_PROBE_JSON '+JSON.stringify(comparison)].join('\n');
 const markers=typedMarkers(stdout,version);assert.equal(markers.length,2);assert.equal('secret'in markers[0],false);assert.deepEqual(markers[0],marker);
});
test('typed marker parser rejects nested extra fields instead of erasing them',()=>{
 for(const mutate of [m=>m.projection.secret='x',m=>m.projection.findings[0].reason='secret',m=>m.projection.source_checks[0].token='x',m=>m.model_calls={secret:'x'},m=>m.format_repairs={secret:'x'},m=>m.projection.source_checks[0].sha256=['a'.repeat(64)]]){
  const m=structuredClone(marker);mutate(m);assert.deepEqual(typedMarkers('RR_TYPED_PROBE_JSON '+JSON.stringify(m),version),[]);
 }
});
