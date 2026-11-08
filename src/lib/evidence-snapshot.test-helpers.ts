import { hashEvidenceJson, evidenceContentFingerprint, sha256EvidenceBytes } from './evidence-snapshot.mjs';
import { CATALOG_VERSION, POLICY_V6, deriveCriterionText, renderV6ClaimStatement } from './field-catalog.mjs';
export async function snapshotCase(status = 'VERIFIED') {
  const body = 'owner only\n证据';
  const actualSha = await sha256EvidenceBytes(new TextEncoder().encode(body));
  const spec = { title:'Snapshot\n绑定',protocol:'Example',chain:'Ethereum',as_of:'2026-11-04',author:'0x'+'c'.repeat(40),client_ref:'snapshot-vector-0001',allowed_hosts:['raw.githubusercontent.com'],source_roots:['raw.githubusercontent.com/example/repo/'],criteria:[{id:'permissions',text:'Only owner.',required:true,evidence_requirement:'fact_required'}] };
  const source = {url:'https://raw.githubusercontent.com/example/repo/'+'a'.repeat(40)+'/test.txt',sha256:status==='HASH_MISMATCH'?'0'.repeat(64):actualSha,byte_length:new TextEncoder().encode(body).length};
  const submission = {report_title:'Delivery',report_version:'v1',report_body:'The source says owner only.',sources:[source],claims:[{criterion_id:'permissions',statement:'The source says owner only.',evidence_indices:[0]}]};
  const order = {id:1,owner:spec.author,policy_version:'research-receipt/5',spec,spec_hash:await hashEvidenceJson(spec),revision_count:1,status:'SUBMITTED',created_at:'2026-11-04'};
  const revision = {order_id:1,revision:1,submission,submission_hash:await hashEvidenceJson(submission),content_hash:await evidenceContentFingerprint(submission),previous_submission_hash:'',submitted_by:spec.author,submitted_at:'2026-11-04'};
  const committed={snapshot_version:'research-receipt/evidence-snapshot/1',binding:{policy_version:order.policy_version,order_id:1,revision:1,spec_hash:order.spec_hash,submission_hash:revision.submission_hash,content_hash:revision.content_hash,sources:[source]},source_checks:[{index:0,status,sha256:status==='UNAVAILABLE'?'':actualSha}],materials:[status==='VERIFIED'?body:null]};
  const snapshot={...committed,snapshot_hash:await hashEvidenceJson(committed)};
  const assessment={policy_version:order.policy_version,order_id:1,revision:1,spec_hash:order.spec_hash,submission_hash:revision.submission_hash,content_hash:revision.content_hash,snapshot_hash:snapshot.snapshot_hash,source_checks:committed.source_checks.map(check=>({...check})),findings:[],verdict:status==='VERIFIED'?'ACCEPTED':'INSUFFICIENT_EVIDENCE',assessed_at:'2026-11-04'};
  return {order,revision,snapshot,assessment};
}
export async function v6SnapshotCase(status = 'VERIFIED') {
  const legacy = await snapshotCase(status);
  const spec = { ...legacy.order.spec, catalog_version: CATALOG_VERSION, criteria: [{ id: 'custom_owner', text: 'State the owner authorization.', required: true, evidence_requirement: 'fact_required', verification_kind: 'evidence_review', allowed_claim_types: ['factual_assertion'], requested_field_ids: [] }] };
  const submission = { ...legacy.revision.submission, claims: [{ criterion_id: 'custom_owner', claim_type: 'factual_assertion', statement: legacy.revision.submission.report_body, evidence_indices: [0] }] };
  const order = { ...legacy.order, policy_version: POLICY_V6, spec, spec_hash: await hashEvidenceJson(spec) };
  const revision = { ...legacy.revision, submission, submission_hash: await hashEvidenceJson(submission), content_hash: await evidenceContentFingerprint(submission, spec) };
  const committed = { ...legacy.snapshot, binding: { ...legacy.snapshot.binding, policy_version: POLICY_V6, spec_hash: order.spec_hash, submission_hash: revision.submission_hash, content_hash: revision.content_hash } };
  const { snapshot_hash: _oldHash, ...snapshotBody } = committed;
  const snapshot = { ...snapshotBody, snapshot_hash: await hashEvidenceJson(snapshotBody) };
  const assessment = { ...legacy.assessment, policy_version: POLICY_V6, spec_hash: order.spec_hash, submission_hash: revision.submission_hash, content_hash: revision.content_hash, snapshot_hash: snapshot.snapshot_hash, findings: [{ criterion_id: 'custom_owner', claim_type: 'factual_assertion', validity: status === 'VERIFIED' ? 'ESTABLISHED' : null, status: status === 'VERIFIED' ? 'SUPPORTED' : 'SOURCE_UNAVAILABLE', delivery_status: status === 'VERIFIED' ? 'FULFILLED' : 'INSUFFICIENT', evidence_indices: [], basis_scope_source_indices: [0], scope_source_indices: [], field_checks: [], reason: 'Local test assessment.' }] };
  return { order, revision, snapshot, assessment };
}
export async function v6UnknownSnapshotCase(status = 'VERIFIED') {
  const initial = await v6SnapshotCase(status);
  const fields = ['withdrawal_waiting_period','instant_exit_conditions'];
  const spec = { ...initial.order.spec, criteria:[{id:'buyer_exit',text:deriveCriterionText(fields),required:true,evidence_requirement:'scoped_unknown_allowed',verification_kind:'evidence_review',allowed_claim_types:['unknown_disclosure','factual_assertion'],requested_field_ids:fields}] };
  const claim = {criterion_id:'buyer_exit',claim_type:'unknown_disclosure',disclosure_version:'scoped-unknown/1',scope:'all_committed_sources'};
  const submission = {...initial.revision.submission,claims:[claim],report_body:renderV6ClaimStatement(spec,claim)};
  const order = {...initial.order,spec,spec_hash:await hashEvidenceJson(spec)};
  const revision = {...initial.revision,submission,submission_hash:await hashEvidenceJson(submission),content_hash:await evidenceContentFingerprint(submission,spec)};
  const {snapshot_hash:_hash,...before}=initial.snapshot;
  const committed = {...before,binding:{...before.binding,spec_hash:order.spec_hash,submission_hash:revision.submission_hash,content_hash:revision.content_hash}};
  const snapshot = {...committed,snapshot_hash:await hashEvidenceJson(committed)};
  const assessment = {...initial.assessment,spec_hash:order.spec_hash,submission_hash:revision.submission_hash,content_hash:revision.content_hash,snapshot_hash:snapshot.snapshot_hash,verdict:status==='VERIFIED'?'ACCEPTED':'INSUFFICIENT_EVIDENCE',findings:[{criterion_id:'buyer_exit',claim_type:'unknown_disclosure' as string|null,validity:status==='VERIFIED'?'VALID':null,status:status==='VERIFIED'?'SCOPED_UNKNOWN':'SOURCE_UNAVAILABLE',delivery_status:status==='VERIFIED'?'FULFILLED':'INSUFFICIENT',evidence_indices:[] as number[],basis_scope_source_indices:[] as number[],scope_source_indices:[0],field_checks:status==='VERIFIED'?fields.map(field_id=>({field_id,state:'NOT_ESTABLISHED',evidence_indices:[] as number[]})):[],reason:'Local structured unknown test.'}]};
  return {order,revision,snapshot,assessment};
}
