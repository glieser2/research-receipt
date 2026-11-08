import catalog from '../field-catalog.json' with { type: 'json' };

export const POLICY_V6 = 'research-receipt/6';
export const CATALOG_VERSION = 'research-receipt/field-catalog/1';
export const FIELD_CATALOG = catalog;
export const UNKNOWN_DISCLOSURE_VERSION = 'scoped-unknown/1';
const error = message => { throw new Error(message); };
export function deriveCriterionText(ids) {
  return '请回答以下已锁定问题；材料不足时按锁定规则披露未知：\n' + ids.map(id => {
    const field = catalog.fields.find(item => item.id === id) || error('未知的锁定字段。');
    return field.label + '：' + field.question;
  }).join('\n');
}
export function validateV6Criteria(criteria, version = CATALOG_VERSION) {
  if (version !== CATALOG_VERSION || !Array.isArray(criteria) || criteria.length < 1 || criteria.length > 6 || !criteria.some(c => c.required === true)) error('V6 需要同版字段目录、1–6 项标准及至少一项必填标准。');
  const seen = new Set();
  for (const item of criteria) {
    if (!item || Object.keys(item).sort().join('|') !== ['id','text','required','evidence_requirement','verification_kind','allowed_claim_types','requested_field_ids'].sort().join('|') || typeof item.id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(item.id) || seen.has(item.id) || typeof item.text !== 'string' || !item.text.trim() || item.text.includes('\0') || new TextEncoder().encode(item.text).length > 600 || typeof item.required !== 'boolean' || !['fact_required','scoped_unknown_allowed'].includes(item.evidence_requirement)) error('V6 标准字段不完整、重复或无效。');
    seen.add(item.id);
    const types = item.allowed_claim_types, ids = item.requested_field_ids;
    if (!Array.isArray(types) || !types.length || new Set(types).size !== types.length || !Array.isArray(ids) || new Set(ids).size !== ids.length) error('V6 声明类型或字段集合无效。');
    if (item.verification_kind === 'boundary_review') {
      if (types.length !== 1 || types[0] !== 'boundary_disclosure' || ids.length) error('边界标准只允许边界披露且不选择未知字段。');
    } else if (item.verification_kind === 'evidence_review') {
      if (types.some(type => !['factual_assertion','unknown_disclosure'].includes(type))) error('证据标准声明类型无效。');
      if (types.includes('unknown_disclosure')) {
        const fields = ids.map(id => catalog.fields.find(field => field.id === id));
        if (!fields.length || fields.some(field => !field) || new Set(fields.map(field => field.group)).size !== 1 || fields.some(field => !field.allowed_claim_types.includes('unknown_disclosure')) || item.text !== deriveCriterionText(ids)) error('未知披露必须使用同组注册字段和目录生成的原文。');
      } else if (ids.length) error('事实专用标准不得选择未知字段。');
    } else error('V6 核查种类无效。');
  }
  return criteria;
}
export function renderV6ClaimStatement(spec, claim) {
  const criterion = spec.criteria.find(item => item.id === claim.criterion_id) || error('声明未绑定锁定标准。');
  if (claim.claim_type !== 'unknown_disclosure') return typeof claim.statement === 'string' ? claim.statement.trim() : claim.statement;
  const labels = criterion.requested_field_ids.map(id => (catalog.fields.find(field => field.id === id) || error('未知的锁定字段。')).label);
  return '在本次提交并锁定的全部来源材料中，以下买方指定字段尚未建立答案：' + labels.join('、') + '。这些字段仅在本次材料范围内记为未知；本披露不构成即时退出、安全或收益保证。';
}
export function validateV6Submission(spec, submission, { allowEmptyReferences = false } = {}) {
  if (spec.catalog_version !== CATALOG_VERSION) error('V6 字段目录版本不匹配。');
  validateV6Criteria(spec.criteria, spec.catalog_version);
  if (!Array.isArray(submission.sources) || !Array.isArray(submission.claims) || submission.claims.length < 1 || submission.claims.length > 6) error('V6 需要 1–6 条交付声明。');
  const seen = new Set();
  for (const claim of submission.claims) {
    const criterion = spec.criteria.find(item => item.id === claim.criterion_id);
    if (!criterion || seen.has(claim.criterion_id) || !criterion.allowed_claim_types.includes(claim.claim_type)) error('声明类型未获买方授权或声明重复。');
    seen.add(claim.criterion_id);
    const unknown = claim.claim_type === 'unknown_disclosure';
    const keys = unknown ? ['criterion_id','claim_type','disclosure_version','scope'] : ['criterion_id','claim_type','statement','evidence_indices'];
    if (Object.keys(claim).sort().join('|') !== keys.sort().join('|')) error('声明字段与类型不一致。');
    if (unknown) {
      if (claim.disclosure_version !== UNKNOWN_DISCLOSURE_VERSION || claim.scope !== 'all_committed_sources') error('未知披露必须覆盖全部锁定来源。');
    } else if (typeof claim.statement !== 'string' || !claim.statement.trim() || claim.statement.includes('\0') || new TextEncoder().encode(claim.statement).length > 1200 || !Array.isArray(claim.evidence_indices) || (!allowEmptyReferences && !claim.evidence_indices.length) || new Set(claim.evidence_indices).size !== claim.evidence_indices.length || claim.evidence_indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= submission.sources.length)) error('声明正文或核查来源范围无效。');
  }
  const body = spec.criteria.flatMap(criterion => submission.claims.filter(claim => claim.criterion_id === criterion.id).map(claim => renderV6ClaimStatement(spec, claim))).join('\n');
  if (submission.report_body !== body) error('正文必须严格等于按锁定标准生成的声明正文。');
  return submission;
}
