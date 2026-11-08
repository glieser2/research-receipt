import test from 'node:test';
import assert from 'node:assert/strict';
import {structuredMarkers,compareStructuredResponse} from '../../scripts/probe-structured-assessment.mjs';
const version='structured-test/1';
const base=(criterion_id,claim_type,status)=>({criterion_id,claim_type,validity:'VALID',status,delivery_status:'FULFILLED',evidence_indices:[0,1],scope_source_indices:[],field_checks:[]});
const unknown=(id,fields)=>({...base(id,'unknown_disclosure','SCOPED_UNKNOWN'),evidence_indices:[],scope_source_indices:[0,1],field_checks:fields.map(field_id=>({field_id,state:'NOT_ESTABLISHED',evidence_indices:[]}))});
const assessment={verdict:'ACCEPTED',findings:[base('permissions','factual_assertion','SUPPORTED'),unknown('withdrawals',['withdrawal_waiting_period','instant_exit_conditions']),unknown('audit',['audit_coverage','audit_version']),base('limitations','boundary_disclosure','BOUNDARY_DISCLOSED')],source_checks:[0,1].map(index=>({index,status:'VERIFIED',sha256:'a'.repeat(64)}))};
const marker={probe_version:version,phase:'independent',stage:'complete',projection:assessment,model_calls:4,format_repairs:0};
const comparison={probe_version:version,phase:'validator',stage:'comparison',equal:true};
const view=()=>({status:{code:0},nondetDisagreementCallNo:null,markers:[structuredClone(marker),structuredClone(comparison)]});
const item={expectedReceipt:{assessment}};
const parse=m=>structuredMarkers('RR_STRUCTURED_PROBE_JSON '+JSON.stringify(m),version);
test('structured diagnostic accepts exact fields, scope and full projection',()=>{assert.equal(compareStructuredResponse(view(),item,{validator:true}),true);assert.deepEqual(parse(marker),[marker]);});
test('structured diagnostic compares every field result and source scope',()=>{
 for(const mutate of [v=>v.markers[0].projection.findings[1].field_checks[0].state='FOUND',v=>v.markers[0].projection.findings[1].scope_source_indices=[0],v=>v.markers[0].projection.findings[1].field_checks.reverse(),v=>v.markers[0].projection.findings[1].evidence_indices=[0]]){
  const v=view();mutate(v);assert.equal(compareStructuredResponse(v,item,{validator:true}),false);
 }
});
test('structured marker rejects invalid references, missing scope and nested extra data',()=>{
 for(const mutate of [m=>m.projection.findings[1].field_checks[0].secret='x',m=>m.projection.findings[1].field_checks[0].evidence_indices=[0],m=>m.projection.findings[1].field_checks[0].field_id='unregistered',m=>m.projection.findings[1].scope_source_indices=[0],m=>m.projection.findings[0].field_checks=[{field_id:'audit_version',state:'FOUND',evidence_indices:[0]}],m=>m.projection.findings[1].field_checks[0]={field_id:'audit_coverage',state:'FOUND',evidence_indices:[]},m=>m.model_calls={secret:'x'},m=>m.projection.source_checks[0].sha256=['a'.repeat(64)]]){
  const m=structuredClone(marker);mutate(m);assert.deepEqual(parse(m),[]);
 }
});
test('structured diagnostic rejects duplicate output markers and disagreement',()=>{
 for(const mutate of [v=>v.markers.push(structuredClone(marker)),v=>v.nondetDisagreementCallNo=0,v=>v.markers[1].equal=false,v=>v.markers[0].format_repairs=1]){
  const v=view();mutate(v);assert.equal(compareStructuredResponse(v,item,{validator:true}),false);
 }
});
