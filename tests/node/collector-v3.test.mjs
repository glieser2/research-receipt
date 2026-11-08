import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateExpectations, requiredCaseChecks, normalizeSpec, normalizeBoundSubmission, v3AssessmentPolicyValid, expectedAssessmentMatches } from '../../scripts/collect-bradbury-evidence.mjs';
const hash = n => '0x'+n.toString(16).padStart(64,'0');
const base = { format:'research-receipt/bradbury-expectations/1',policyVersion:'research-receipt/3',caseHashes:{},fixtureFile:'tests/fixtures/bradbury-v3-input.json',fixtureSha256:'a'.repeat(64),validationPlanFile:'docs/evidence/v3-validation-plan.json',validationPlanSha256:'b'.repeat(64),orderIds:{correction:1,hashMismatch:2,unauthorized:3,strictUnknown:4},expectedOrderCount:4 };
test('V3 requires explicit policy, four orders, locked fixture and plan; exactly 17 mandatory cases',()=>{
  const config=validateExpectations(base);
  assert.equal(Object.keys(requiredCaseChecks(config,[])).length,17);
  assert.equal(Object.keys(requiredCaseChecks(validateExpectations({format:base.format,caseHashes:{}}),[])).length,14);
  assert.throws(()=>validateExpectations({...base,validationPlanSha256:undefined}),/frozen/);
  assert.throws(()=>validateExpectations({...base,orderIds:{correction:1,hashMismatch:2,unauthorized:3}}),/Distinct/);
  assert.throws(()=>validateExpectations({format:base.format,caseHashes:{evaluateStrictUnknown:hash(1)}}),/V3 policy/);
});
test('V3 spec hashing keeps mandatory evidence policy while legacy remains byte-compatible',async()=>{
  const fixture=JSON.parse(await readFile(new URL('../fixtures/bradbury-v3-input.json',import.meta.url),'utf8'));
  const spec=normalizeSpec(fixture.spec), strict=normalizeSpec(fixture.specStrict);
  assert.ok(spec.criteria.every(row=>row.evidence_requirement));
  assert.notDeepEqual(spec.criteria,strict.criteria);
  const legacy=structuredClone(fixture.spec); legacy.criteria.forEach(row=>delete row.evidence_requirement);
  assert.ok(normalizeSpec(legacy).criteria.every(row=>!Object.hasOwn(row,'evidence_requirement')));
});
function sample(policy='scoped_unknown_allowed') {
  const criterion={id:'audit',required:true,evidence_requirement:policy};
  const source={sha256:'a'.repeat(64)};
  return {order:{policy_version:'research-receipt/3',spec:{criteria:[criterion]}},revision:{submission:{sources:[source],claims:[{criterion_id:'audit',evidence_indices:[0]}]}},assessment:{policy_version:'research-receipt/3',verdict:policy==='fact_required'?'INSUFFICIENT_EVIDENCE':'ACCEPTED',findings:[{criterion_id:'audit',status:'SCOPED_UNKNOWN',delivery_status:policy==='fact_required'?'INSUFFICIENT':'FULFILLED',evidence_indices:[0],reason:'Evidence boundary is explicitly disclosed.'}],source_checks:[{index:0,status:'VERIFIED',sha256:source.sha256}]}};
}
test('SCOPED_UNKNOWN evidence survives buyer-policy change but delivery is deterministically mapped',()=>{
  for(const policy of ['fact_required','scoped_unknown_allowed']) {
    const s=sample(policy); assert.equal(v3AssessmentPolicyValid(s.order,s.revision,s.assessment),true);
    s.assessment.findings[0].delivery_status=policy==='fact_required'?'FULFILLED':'INSUFFICIENT';
    assert.equal(v3AssessmentPolicyValid(s.order,s.revision,s.assessment),false);
  }
  const s=sample();delete s.order.spec.criteria[0].evidence_requirement;
  assert.equal(v3AssessmentPolicyValid(s.order,s.revision,s.assessment),false);
});
test('forged source proofs, model source-unavailable, missing/duplicate findings cannot pass collector',()=>{
  const valid=s=>v3AssessmentPolicyValid(s.order,s.revision,s.assessment);
  let s=sample();s.assessment.source_checks[0].sha256='b'.repeat(64);assert.equal(valid(s),false);
  s=sample();s.assessment.findings[0].status='SOURCE_UNAVAILABLE';assert.equal(valid(s),false);
  s=sample();s.assessment.findings.push({...s.assessment.findings[0]});assert.equal(valid(s),false);
  s=sample();s.assessment.findings[0].evidence_indices=[0,0];assert.equal(valid(s),false);
  s=sample();s.assessment.policy_version='research-receipt/2';assert.equal(valid(s),false);
});
test('prelocked semantic vectors require every status and delivery, not merely aggregate verdict',()=>{
  const s=sample();const expected={verdict:'ACCEPTED',statuses:['SCOPED_UNKNOWN'],delivery:['FULFILLED']};
  assert.equal(expectedAssessmentMatches(s.assessment,expected),true);
  s.assessment.findings[0].status='SUPPORTED';assert.equal(expectedAssessmentMatches(s.assessment,expected),false);
});
test('V4 requires 18 business cases and cannot silently use a V3 required-case profile',()=>{
  const config=validateExpectations({...base,policyVersion:'research-receipt/4'});
  assert.equal(Object.keys(requiredCaseChecks(config,[])).length,18);
  assert.equal(requiredCaseChecks(config,[]).unboundReportBody,false);
  assert.throws(()=>validateExpectations({...base,caseHashes:{unboundReportBody:hash(1)}}),/V4 policy/);
});
test('V4 normalizes claim order before commitment and rejects every unbound body byte',()=>{
  const spec={criteria:[{id:'first'},{id:'second'}]};
  const value={report_title:'Title',report_version:'v1',report_body:'First.\nSecond.',sources:[],claims:[{criterion_id:'second',statement:'Second.',evidence_indices:[]},{criterion_id:'first',statement:'First.',evidence_indices:[]}]};
  const normalized=normalizeBoundSubmission(value,spec);
  assert.deepEqual(normalized.claims.map(item=>item.criterion_id),['first','second']);
  assert.throws(()=>normalizeBoundSubmission({...value,report_body:value.report_body+'\nUnbound assertion.'},spec),/Unbound/);
  assert.throws(()=>normalizeBoundSubmission({...value,report_body:' '+value.report_body},spec),/Unbound/);
  assert.throws(()=>normalizeBoundSubmission({...value,claims:[...value.claims,value.claims[0]]},spec),/duplicate/);
});
test('V4 assessment proof rejects detached report prose even when status and delivery are valid',()=>{
  const s=sample();s.order.policy_version=s.assessment.policy_version='research-receipt/4';
  s.revision.submission={report_title:'Audit boundary',report_version:'v1',report_body:'Scope unknown.',sources:[{url:'https://example.invalid/source',sha256:'a'.repeat(64),byte_length:1}],claims:[{criterion_id:'audit',statement:'Scope unknown.',evidence_indices:[0]}]};
  assert.equal(v3AssessmentPolicyValid(s.order,s.revision,s.assessment),true);
  s.revision.submission.report_body+=' Safety guaranteed.';
  assert.equal(v3AssessmentPolicyValid(s.order,s.revision,s.assessment),false);
});
