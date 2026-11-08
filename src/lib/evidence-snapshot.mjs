// Shared browser/Node verification of public, immutable policy-5/6 evidence bytes.
// This verifies internal commitments; it does not fetch URLs or replace chain consensus.
import { POLICY_V6, renderV6ClaimStatement, validateV6Submission } from './field-catalog.mjs';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : fail('RR_SNAPSHOT_OBJECT');
const exact = (value, keys) => { object(value); if (Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) fail('RR_SNAPSHOT_FIELDS'); };
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
export function canonicalEvidenceJson(value) {
  if (typeof value === 'string') {
    for(let index=0;index<value.length;index++) {
      const code=value.charCodeAt(index);
      if(code>=0xd800&&code<=0xdbff) {const next=value.charCodeAt(++index);if(!(next>=0xdc00&&next<=0xdfff))fail('RR_SNAPSHOT_UNICODE');}
      else if(code>=0xdc00&&code<=0xdfff)fail('RR_SNAPSHOT_UNICODE');
    }
    return JSON.stringify(value);
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalEvidenceJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalEvidenceJson(value[key])).join(',') + '}';
  return fail('RR_SNAPSHOT_CANONICAL_VALUE');
}
export async function sha256EvidenceBytes(bytes) {
  const result = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(result)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export const hashEvidenceJson = value => sha256EvidenceBytes(new TextEncoder().encode(canonicalEvidenceJson(value)));
export async function evidenceContentFingerprint(submission, spec = undefined) {
  object(submission);
  if (typeof submission.report_body !== 'string' || !Array.isArray(submission.sources) || !Array.isArray(submission.claims)) fail('RR_SNAPSHOT_SUBMISSION');
  const sources = submission.sources.map(canonicalEvidenceJson);
  const claims = submission.claims.map(item => {
    object(item);
    const statement = spec ? renderV6ClaimStatement(spec, item) : item.statement;
    const indices = spec && item.claim_type === 'unknown_disclosure' ? sources.map((_, index) => index) : item.evidence_indices;
    if (typeof item.criterion_id !== 'string' || typeof statement !== 'string' || !Array.isArray(indices) || indices.some(index => !Number.isInteger(index) || index < 0 || index >= sources.length)) fail('RR_SNAPSHOT_CLAIM');
    return { criterion_id: item.criterion_id, statement, evidence: indices.map(index => sources[index]).sort() };
  }).sort((a, b) => a.criterion_id < b.criterion_id ? -1 : a.criterion_id > b.criterion_id ? 1 : 0);
  return hashEvidenceJson({ report_body: submission.report_body, sources: [...sources].sort(), claims });
}
export async function validateEvidenceRecord({ order, revision, expectedRevision }) {
  object(order); object(revision); object(order.spec); object(revision.submission);
  if (!['research-receipt/5', POLICY_V6].includes(order.policy_version) || !positive(order.id) || !positive(expectedRevision) || expectedRevision > 5 || revision.order_id !== order.id || revision.revision !== expectedRevision) fail('RR_SNAPSHOT_RECORD_BINDING');
  if (![order.spec_hash, revision.submission_hash, revision.content_hash].every(hash)) fail('RR_SNAPSHOT_RECORD_HASH');
  const sources = revision.submission.sources;
  if (!Array.isArray(sources) || sources.length > 3 || sources.some(source => !source || typeof source.url !== 'string' || !hash(source.sha256) || !positive(source.byte_length) || source.byte_length > 16384)) fail('RR_SNAPSHOT_SOURCES');
  if (order.policy_version === POLICY_V6) validateV6Submission(order.spec, revision.submission, { allowEmptyReferences: true });
  const [specHash, submissionHash, contentHash] = await Promise.all([hashEvidenceJson(order.spec), hashEvidenceJson(revision.submission), evidenceContentFingerprint(revision.submission, order.policy_version === POLICY_V6 ? order.spec : undefined)]);
  if (specHash !== order.spec_hash || submissionHash !== revision.submission_hash || contentHash !== revision.content_hash) fail('RR_SNAPSHOT_RECORD_COMMITMENT');
  return { sources };
}
function validateV6Findings(assessment, spec, submission, snapshot) {
  const same = (left, right) => canonicalEvidenceJson(left) === canonicalEvidenceJson(right);
  const allIndices = submission.sources.map((_, index) => index);
  const refs = value => Array.isArray(value) && new Set(value).size === value.length && value.every(index => Number.isSafeInteger(index) && allIndices.includes(index));
  if (!Array.isArray(assessment.findings) || assessment.findings.length !== spec.criteria.length) fail('RR_SNAPSHOT_FINDINGS');
  for (let index = 0; index < spec.criteria.length; index++) {
    const criterion = spec.criteria[index], finding = assessment.findings[index];
    exact(finding, ['criterion_id','claim_type','validity','status','delivery_status','evidence_indices','basis_scope_source_indices','scope_source_indices','field_checks','reason']);
    if (finding.criterion_id !== criterion.id || typeof finding.reason !== 'string' || !refs(finding.evidence_indices) || !refs(finding.basis_scope_source_indices) || !refs(finding.scope_source_indices) || !Array.isArray(finding.field_checks)) fail('RR_SNAPSHOT_FINDING_SHAPE');
    const claim = submission.claims.find(item => item.criterion_id === criterion.id);
    if (!claim) {
      if (finding.claim_type !== null || finding.validity !== null || finding.status !== 'MISSING' || finding.delivery_status !== 'INSUFFICIENT' || finding.evidence_indices.length || finding.basis_scope_source_indices.length || finding.scope_source_indices.length || finding.field_checks.length) fail('RR_SNAPSHOT_MISSING_FINDING');
      continue;
    }
    const unknown = claim.claim_type === 'unknown_disclosure';
    if (finding.claim_type !== claim.claim_type || !same(finding.basis_scope_source_indices, unknown ? [] : claim.evidence_indices) || !same(finding.scope_source_indices, unknown ? allIndices : [])) fail('RR_SNAPSHOT_FINDING_SCOPE');
    const selected = unknown ? allIndices : claim.evidence_indices;
    const unavailable = !selected.length || selected.some(sourceIndex => snapshot.source_checks[sourceIndex].status !== 'VERIFIED');
    if (unavailable) {
      if (finding.status !== 'SOURCE_UNAVAILABLE' || finding.validity !== null || finding.delivery_status !== 'INSUFFICIENT' || finding.evidence_indices.length || finding.field_checks.length) fail('RR_SNAPSHOT_UNAVAILABLE_FINDING');
      continue;
    }
    if (unknown) {
      if (finding.field_checks.length !== criterion.requested_field_ids.length) fail('RR_SNAPSHOT_FIELD_COUNT');
      const foundRefs = new Set();
      finding.field_checks.forEach((field, fieldIndex) => {
        exact(field, ['field_id','state','evidence_indices']);
        if (field.field_id !== criterion.requested_field_ids[fieldIndex] || !refs(field.evidence_indices) || !['FOUND','NOT_ESTABLISHED'].includes(field.state) || (field.state === 'FOUND' ? !field.evidence_indices.length : field.evidence_indices.length)) fail('RR_SNAPSHOT_FIELD_CHECK');
        field.evidence_indices.forEach(source => foundRefs.add(source));
      });
      const contradicted = finding.field_checks.some(field => field.state === 'FOUND');
      if (finding.validity !== (contradicted ? 'CONTRADICTED' : 'VALID') || finding.status !== (contradicted ? 'CONTRADICTED' : 'SCOPED_UNKNOWN') || !same(finding.evidence_indices, [...foundRefs].sort((a,b) => a-b))) fail('RR_SNAPSHOT_UNKNOWN_FINDING');
    } else if (finding.field_checks.length || finding.evidence_indices.length || !['ESTABLISHED','NOT_ESTABLISHED'].includes(finding.validity) || finding.status !== (finding.validity === 'ESTABLISHED' ? (claim.claim_type === 'boundary_disclosure' ? 'BOUNDARY_DISCLOSED' : 'SUPPORTED') : 'NOT_ESTABLISHED')) fail('RR_SNAPSHOT_SUFFICIENCY_FINDING');
    const delivery = finding.status === 'CONTRADICTED' ? 'CONTRADICTED' : ['SUPPORTED','BOUNDARY_DISCLOSED'].includes(finding.status) || finding.status === 'SCOPED_UNKNOWN' && criterion.evidence_requirement === 'scoped_unknown_allowed' ? 'FULFILLED' : 'INSUFFICIENT';
    if (finding.delivery_status !== delivery) fail('RR_SNAPSHOT_FINDING_DELIVERY');
  }
  const required = assessment.findings.filter((_, index) => spec.criteria[index].required);
  const verdict = required.some(item => item.status === 'CONTRADICTED') ? 'NOT_ACCEPTED' : required.some(item => item.delivery_status !== 'FULFILLED') ? 'INSUFFICIENT_EVIDENCE' : assessment.findings.some((item,index) => !spec.criteria[index].required && item.status !== 'MISSING' && item.delivery_status !== 'FULFILLED') ? 'REVISION_REQUIRED' : 'ACCEPTED';
  if (assessment.verdict !== verdict) fail('RR_SNAPSHOT_FINDING_VERDICT');
}
export async function validateEvidenceSnapshot({ snapshot, order, revision, expectedRevision, assessment = null }) {
  const { sources } = await validateEvidenceRecord({ order, revision, expectedRevision });
  exact(snapshot, ['snapshot_version', 'binding', 'source_checks', 'materials', 'snapshot_hash']);
  if (snapshot.snapshot_version !== 'research-receipt/evidence-snapshot/1' || !hash(snapshot.snapshot_hash)) fail('RR_SNAPSHOT_VERSION');
  const expectedBinding = { policy_version: order.policy_version, order_id: order.id, revision: expectedRevision, spec_hash: order.spec_hash, submission_hash: revision.submission_hash, content_hash: revision.content_hash, sources };
  exact(snapshot.binding, Object.keys(expectedBinding));
  if (canonicalEvidenceJson(snapshot.binding) !== canonicalEvidenceJson(expectedBinding)) fail('RR_SNAPSHOT_BINDING');
  if (!Array.isArray(snapshot.source_checks) || !Array.isArray(snapshot.materials) || snapshot.source_checks.length !== sources.length || snapshot.materials.length !== sources.length) fail('RR_SNAPSHOT_SOURCE_COUNT');
  const checks = await Promise.all(snapshot.source_checks.map(async (check, index) => {
    exact(check, ['index', 'status', 'sha256']);
    if (check.index !== index || !Number.isInteger(check.index) || !['VERIFIED', 'UNAVAILABLE', 'TOO_LARGE', 'HASH_MISMATCH', 'INVALID_ENCODING'].includes(check.status) || !(check.sha256 === '' || hash(check.sha256)) || (check.status !== 'UNAVAILABLE' && !hash(check.sha256))) fail('RR_SNAPSHOT_SOURCE_CHECK');
    const material = snapshot.materials[index];
    if (check.status === 'VERIFIED') {
      if (typeof material !== 'string') fail('RR_SNAPSHOT_VERIFIED_MATERIAL');
      const bytes = new TextEncoder().encode(material);
      if (bytes.length !== sources[index].byte_length || bytes.length > 16384 || check.sha256 !== sources[index].sha256 || await sha256EvidenceBytes(bytes) !== check.sha256) fail('RR_SNAPSHOT_MATERIAL_COMMITMENT');
    } else if (material !== null) fail('RR_SNAPSHOT_FAILED_MATERIAL');
    return { index: check.index, status: check.status, sha256: check.sha256 };
  }));
  const committed = { snapshot_version: snapshot.snapshot_version, binding: snapshot.binding, source_checks: snapshot.source_checks, materials: snapshot.materials };
  if (await hashEvidenceJson(committed) !== snapshot.snapshot_hash) fail('RR_SNAPSHOT_HASH');
  if (assessment !== null) {
    object(assessment);
    if (assessment.snapshot_hash !== snapshot.snapshot_hash || assessment.policy_version !== order.policy_version || assessment.order_id !== order.id || assessment.revision !== expectedRevision || assessment.spec_hash !== order.spec_hash || assessment.submission_hash !== revision.submission_hash || assessment.content_hash !== revision.content_hash || !Array.isArray(assessment.source_checks) || canonicalEvidenceJson(assessment.source_checks) !== canonicalEvidenceJson(snapshot.source_checks)) fail('RR_SNAPSHOT_ASSESSMENT_BINDING');
    if (order.policy_version === POLICY_V6) validateV6Findings(assessment, order.spec, revision.submission, snapshot);
  }
  return { snapshotHash: snapshot.snapshot_hash, sourceChecks: checks, allVerified: checks.length > 0 && checks.every(check => check.status === 'VERIFIED') };
}
