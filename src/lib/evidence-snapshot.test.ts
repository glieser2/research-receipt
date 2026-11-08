import { describe,it,expect } from 'vitest';
import { canonicalEvidenceJson,hashEvidenceJson,evidenceContentFingerprint,validateEvidenceSnapshot } from './evidence-snapshot.mjs';
import { snapshotCase, v6SnapshotCase, v6UnknownSnapshotCase } from './evidence-snapshot.test-helpers';
import { V6_CRITERIA } from './domain';
import { renderV6ClaimStatement, validateV6Submission } from './field-catalog.mjs';
const validate = (sample: Awaited<ReturnType<typeof snapshotCase>>) => validateEvidenceSnapshot({...sample,expectedRevision:1});
async function resign(sample: Awaited<ReturnType<typeof snapshotCase>>) {const {snapshot_hash:_,...committed}=sample.snapshot;sample.snapshot.snapshot_hash=await hashEvidenceJson(committed);sample.assessment.snapshot_hash=sample.snapshot.snapshot_hash;}
describe('independent snapshot commitments',()=>{
  it('matches independently computed Python UTF8/sorted-key hash vectors',async()=>{
    // Generated independently with Python hashlib/json ensure_ascii=False,
    // sort_keys=True,separators=(',',':'), including Chinese text and newline.
    const sample=await snapshotCase();
    expect(sample.order.spec_hash).toBe('3aed69134860d3f5e3f301993c245dbde66731cb3cb51630ad3bdb6cb2f5f14d');
    expect(sample.revision.submission_hash).toBe('f6fb0ae8763ed0782772999cea7cb864db6725c8d0f6b1db957ecc5422640a36');
    expect(sample.revision.content_hash).toBe('f46f7d18db5eb243ebeaf775aa912e3b33a8bb38345466e22ea1839b6fa2e69e');
    expect(sample.snapshot.snapshot_hash).toBe('456f2da264c413c4023d6532c70702bafdfd244f21dbf9f43918990d577b6c89');
  });
  it('verifies actual UTF8 material against all three bindings and preserves the public bytes',async()=>{
    const sample=await snapshotCase(),before=structuredClone(sample);
    expect(await validate(sample)).toEqual({snapshotHash:sample.snapshot.snapshot_hash,sourceChecks:sample.snapshot.source_checks,allVerified:true});
    expect(sample).toEqual(before);
  });
  it.each(['HASH_MISMATCH','UNAVAILABLE','TOO_LARGE','INVALID_ENCODING'])('retains a locked %s result without pretending that author hashes were verified',async(status)=>{
    const sample=await snapshotCase(status);
    expect((await validate(sample)).allVerified).toBe(false);
    sample.snapshot.materials[0]='invented material';await resign(sample);
    await expect(validate(sample)).rejects.toThrow('RR_SNAPSHOT_FAILED_MATERIAL');
  });
  it('rejects a validly hashed snapshot assigned to another order or revision',async()=>{
    const sample=await snapshotCase();sample.snapshot.binding.order_id=2;await resign(sample);
    await expect(validate(sample)).rejects.toThrow('RR_SNAPSHOT_BINDING');
    const other=await snapshotCase();other.revision.revision=2;
    await expect(validate(other)).rejects.toThrow('RR_SNAPSHOT_RECORD_BINDING');
  });
  it('rejects forged bytes even when the outer snapshot hash has been recomputed',async()=>{
    const sample=await snapshotCase();sample.snapshot.materials[0]='different bytes';await resign(sample);
    await expect(validate(sample)).rejects.toThrow('RR_SNAPSHOT_MATERIAL_COMMITMENT');
  });
  it('rejects copied author digests without verified material and assessment hashes belonging elsewhere',async()=>{
    const sample=await snapshotCase();sample.snapshot.materials[0]=null;await resign(sample);
    await expect(validate(sample)).rejects.toThrow('RR_SNAPSHOT_VERIFIED_MATERIAL');
    const other=await snapshotCase();other.assessment.snapshot_hash='f'.repeat(64);
    await expect(validate(other)).rejects.toThrow('RR_SNAPSHOT_ASSESSMENT_BINDING');
  });
  it('rejects modified order or submission contents and malformed snapshot digests',async()=>{
    const sample=await snapshotCase();sample.order.spec.title='different order';
    await expect(validate(sample)).rejects.toThrow('RR_SNAPSHOT_RECORD_COMMITMENT');
    const other=await snapshotCase();other.snapshot.snapshot_hash='f'.repeat(64);
    await expect(validate(other)).rejects.toThrow('RR_SNAPSHOT_HASH');
  });
  it('rejects surrogate strings that Python UTF8 canonicalization cannot commit',()=>{
    expect(()=>canonicalEvidenceJson({material:'\ud800'})).toThrow('RR_SNAPSHOT_UNICODE');
  });
  it('rejects an assessment that claims different source verification under the same snapshot hash',async()=>{
    const sample=await snapshotCase();sample.assessment.source_checks[0].status='UNAVAILABLE';
    await expect(validate(sample)).rejects.toThrow('RR_SNAPSHOT_ASSESSMENT_BINDING');
  });
});
describe('V6 typed commitment and finding semantics', () => {
  it('reads normalized factual empty-reference records as unavailable while the author write validator still rejects them', async () => {
    const original = await v6SnapshotCase();
    const submission = {...original.revision.submission,claims:[{...original.revision.submission.claims[0],evidence_indices:[]}]};
    expect(()=>validateV6Submission(original.order.spec,submission)).toThrow('核查来源');
    const revision = {...original.revision,submission,submission_hash:await hashEvidenceJson(submission),content_hash:await evidenceContentFingerprint(submission,original.order.spec)};
    const {snapshot_hash:_hash,...oldCommitted}=original.snapshot;
    const committed = {...oldCommitted,binding:{...oldCommitted.binding,submission_hash:revision.submission_hash,content_hash:revision.content_hash}};
    const snapshot = {...committed,snapshot_hash:await hashEvidenceJson(committed)};
    const finding = {...original.assessment.findings[0],status:'SOURCE_UNAVAILABLE',validity:null as string|null,delivery_status:'INSUFFICIENT',basis_scope_source_indices:[]};
    const assessment = {...original.assessment,submission_hash:revision.submission_hash,content_hash:revision.content_hash,snapshot_hash:snapshot.snapshot_hash,verdict:'INSUFFICIENT_EVIDENCE',findings:[finding]};
    await expect(validateEvidenceSnapshot({order:original.order,revision,snapshot,assessment,expectedRevision:1})).resolves.toMatchObject({allVerified:true});
    finding.validity='ESTABLISHED';
    await expect(validateEvidenceSnapshot({order:original.order,revision,snapshot,assessment,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_UNAVAILABLE_FINDING');
  });
  it('validates a fully bound empty snapshot without calling it verified or treating unknown as established', async () => {
    const original = await v6UnknownSnapshotCase('UNAVAILABLE');
    const submission = {...original.revision.submission,sources:[]};
    const revision = {...original.revision,submission,submission_hash:await hashEvidenceJson(submission),content_hash:await evidenceContentFingerprint(submission,original.order.spec)};
    const committed = {
      snapshot_version:original.snapshot.snapshot_version,
      binding:{...original.snapshot.binding,sources:[],submission_hash:revision.submission_hash,content_hash:revision.content_hash},
      source_checks:[],materials:[],
    };
    const snapshot = {...committed,snapshot_hash:await hashEvidenceJson(committed)};
    const finding = {...original.assessment.findings[0],scope_source_indices:[]};
    const assessment = {...original.assessment,submission_hash:revision.submission_hash,content_hash:revision.content_hash,snapshot_hash:snapshot.snapshot_hash,source_checks:[],findings:[finding]};
    const sample = {order:original.order,revision,snapshot,assessment,expectedRevision:1};
    await expect(validateEvidenceSnapshot(sample)).resolves.toEqual({snapshotHash:snapshot.snapshot_hash,sourceChecks:[],allVerified:false});
    expect(finding).toMatchObject({claim_type:'unknown_disclosure',status:'SOURCE_UNAVAILABLE',validity:null,field_checks:[],evidence_indices:[],basis_scope_source_indices:[],scope_source_indices:[]});
    finding.validity='VALID';
    await expect(validateEvidenceSnapshot(sample)).rejects.toThrow('RR_SNAPSHOT_UNAVAILABLE_FINDING');
  });
  it('requires a complete ordered unknown field result and exposes FOUND references as contradiction', async () => {
    const sample = await v6UnknownSnapshotCase();
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).resolves.toMatchObject({allVerified:true});
    const finding = sample.assessment.findings[0];
    finding.field_checks[0].state='FOUND';
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_FIELD_CHECK');
    finding.field_checks[0].evidence_indices=[0];
    finding.status='CONTRADICTED';finding.validity='CONTRADICTED';finding.delivery_status='CONTRADICTED';finding.evidence_indices=[0];sample.assessment.verdict='NOT_ACCEPTED';
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).resolves.toMatchObject({allVerified:true});
    finding.field_checks.reverse();
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_FIELD_CHECK');
  });
  it('rejects author-selected basis for unknown and preserves null validity when the committed scope is unavailable', async () => {
    const sample = await v6UnknownSnapshotCase('UNAVAILABLE');
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).resolves.toMatchObject({allVerified:false});
    sample.assessment.findings[0].basis_scope_source_indices=[0];
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_FINDING_SCOPE');
    sample.assessment.findings[0].basis_scope_source_indices=[];
    sample.assessment.findings[0].validity='VALID';
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_UNAVAILABLE_FINDING');
  });
  it('keeps typed submission hashes distinct while rejecting label-only replay of the same visible content and scope', async () => {
    const sample = await v6SnapshotCase();
    const spec = { ...sample.order.spec, criteria:[V6_CRITERIA[1]] };
    const unknown = { criterion_id:'withdrawals',claim_type:'unknown_disclosure',disclosure_version:'scoped-unknown/1',scope:'all_committed_sources' };
    const body = renderV6ClaimStatement(spec,unknown);
    const first = {...sample.revision.submission,report_body:body,claims:[unknown]};
    const second = {...first,report_title:'new title',report_version:'v2',claims:[{criterion_id:'withdrawals',claim_type:'factual_assertion',statement:body,evidence_indices:[0]}]};
    expect(await hashEvidenceJson(first)).not.toBe(await hashEvidenceJson(second));
    expect(await evidenceContentFingerprint(first,spec)).toBe(await evidenceContentFingerprint(second,spec));
  });
  it('verifies V6 full commitments and rejects fabricated supportive references or mislabeled scope', async () => {
    const sample = await v6SnapshotCase();
    // Independently computed by Python normalize_spec/normalize_submission,
    // digest/content_fingerprint/snapshot_binding in test_contract_v6.py.
    expect(sample.order.spec_hash).toBe('98dce0846ac4d401c4fb34a86bd5ba4126b07b30c547de53eb2ad69b51b25c2d');
    expect(sample.revision.submission_hash).toBe('4a0e4adc54becb76eb7a4fcec990841217b4bcfabd2e8cf5a63a435cbfbd479a');
    expect(sample.revision.content_hash).toBe('983dc8ee020e07a5312846a0068abc3239b2b1f2913e6e8622e3a438325dc47a');
    expect(sample.snapshot.snapshot_hash).toBe('fe87ff7b1d4ece482d635bd26fc81a5824d8dfa1ac8b193a345993c510fe20d8');
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).resolves.toMatchObject({allVerified:true});
    const supportive = structuredClone(sample);
    (supportive.assessment.findings[0].evidence_indices as number[]).push(0);
    await expect(validateEvidenceSnapshot({...supportive,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_SUFFICIENCY_FINDING');
    const scope = structuredClone(sample);
    (scope.assessment.findings[0].scope_source_indices as number[]).push(0);
    await expect(validateEvidenceSnapshot({...scope,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_FINDING_SCOPE');
    sample.assessment.findings[0].validity = null;
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_SUFFICIENCY_FINDING');
  });
  it('retains actual unavailable type and authored basis without laundering unavailable sources into established facts', async () => {
    const sample = await v6SnapshotCase('HASH_MISMATCH');
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).resolves.toMatchObject({allVerified:false});
    sample.assessment.findings[0].claim_type = 'unknown_disclosure';
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_FINDING_SCOPE');
  });
  it('rejects V6 records relabeled as policy5 even when the byte commitments are recomputed', async () => {
    const sample = await v6SnapshotCase();
    sample.order.policy_version = 'research-receipt/5' as typeof sample.order.policy_version;
    // Legacy content hashing cannot interpret the structured unknown shape; policy
    // changes also break the immutable snapshot binding for factual submissions.
    await expect(validateEvidenceSnapshot({...sample,expectedRevision:1})).rejects.toThrow('RR_SNAPSHOT_BINDING');
  });
});
