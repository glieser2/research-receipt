import { aggregate, aggregateFindings, deliveryStatus, CRITERIA, type Criterion, type Finding, type Assessment, type Order, type Revision } from './domain';
import { localizeChainText, type Language } from './i18n';

// Deliberately fictional. No market claims or consensus decisions are fabricated.
const DEMO_CRITERIA = CRITERIA.map(item => ({ ...item, evidence_requirement: item.id === 'audit' ? 'scoped_unknown_allowed' as const : 'fact_required' as const }));
export const DEMO_EVIDENCE = 'Northstar 示例协议（虚构）公开说明 v1\n管理：管理员可升级合约；更改有48小时延迟。\n退出：用户提交请求后，存在7天等待期。\n审计：目前没有可核验的第三方审计报告。\n范围：这些材料仅描述示例规则，不证明部署安全，也不保证收益。\n';
export const DEMO_SUBMISSION: Omit<Revision, 'number' | 'assessment'> = {
  reportTitle: 'Northstar 风险研究 · 初稿', reportUrl: '',
  sources: [{ url: 'https://example.org/fictional/northstar-v1.txt', sha256: '', byteLength: new TextEncoder().encode(DEMO_EVIDENCE).length, publishedAt: '2026-11-01', label: 'Northstar 虚构协议 · 本地内置证据' }],
  claims: [
    { id: 'permissions', criterion: 'permissions', text: '管理员可升级合约，更改存在48小时延迟。', sourceIndexes: [0] },
    { id: 'withdrawals', criterion: 'withdrawals', text: '用户可随时即时提现，没有等待期。', sourceIndexes: [0] },
    { id: 'audit', criterion: 'audit', text: '未取得可核验的第三方审计报告，审计状态未知。', sourceIndexes: [0] },
    { id: 'limitations', criterion: 'limitations', text: '本研究不证明部署安全，也不保证收益。', sourceIndexes: [0] },
  ],
};
export async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function demoSubmission(lang: Language = 'zh') {
  const input = structuredClone(DEMO_SUBMISSION);
  input.sources[0].sha256 = await sha256(DEMO_EVIDENCE);
  if (lang === 'en') {
    input.reportTitle = localizeChainText(input.reportTitle, 'en');
    input.sources[0].label = localizeChainText(input.sources[0].label, 'en');
    input.claims = input.claims.map(claim => ({ ...claim, text: localizeChainText(claim.text, 'en') }));
  }
  return input;
}
export async function seedOrders(): Promise<Order[]> {
  const input = await demoSubmission();
  return [{ id: 1, title: 'Northstar · 协议风险研究验收', protocol: 'Northstar（虚构示例）', chain: 'Ethereum · 示例', asOf: '2026-11-04', author: 'demo-author', allowedHosts: ['example.org'], criteria: DEMO_CRITERIA, createdAt: '2026-11-04T09:00:00.000Z', revisions: [{ ...input, number: 1 }] }];
}
export async function assessDemo(revision: Revision, lockedCriteria: Criterion[] = DEMO_CRITERIA): Promise<Assessment> {
  if (lockedCriteria.some(criterion => criterion.verification_kind !== undefined)) return assessTypedDemo(revision, lockedCriteria);
  const expectedHash = await sha256(DEMO_EVIDENCE);
  const items = lockedCriteria.map(criterion => {
    const claim = revision.claims.find(c => c.criterion === criterion.id);
    if (!claim) return { claimId: criterion.id, status: 'INSUFFICIENT_EVIDENCE', reason: '未提交这项约定内容。', sourceIndexes: [] };
    const known = claim.sourceIndexes.some(i => revision.sources[i]?.sha256 === expectedHash && revision.sources[i]?.byteLength === new TextEncoder().encode(DEMO_EVIDENCE).length && revision.sources[i]?.url === DEMO_SUBMISSION.sources[0].url);
    if (!known) return { claimId: criterion.id, status: 'INSUFFICIENT_EVIDENCE', reason: '本地演练只识别内置虚构材料；其他来源需进入真实链上验收。', sourceIndexes: claim.sourceIndexes };
    let status = 'INSUFFICIENT_EVIDENCE';
    const text = claim.text;
    const lower = text.toLowerCase();
    if (criterion.id === 'permissions' && ((text.includes('管理员可升级') && text.includes('48小时')) || (lower.includes('admin') && lower.includes('upgrade') && lower.includes('48-hour')))) status = 'SUPPORTED';
    if (criterion.id === 'withdrawals') {
      if ((text.includes('7天') && (text.includes('等待') || text.includes('冷却'))) || (lower.includes('7-day') && (lower.includes('waiting') || lower.includes('cooldown')))) status = 'SUPPORTED';
      else if (text.includes('即时提现') || text.includes('没有等待期') || lower.includes('withdraw immediately') || lower.includes('no waiting period')) status = 'CONTRADICTED';
    }
    if (criterion.id === 'audit' && ((text.includes('未取得') && text.includes('审计')) || (lower.includes('no verifiable third-party audit') && lower.includes('unknown')))) status = 'SCOPED_UNKNOWN';
    if (criterion.id === 'limitations' && ((text.includes('不证明') && text.includes('不保证收益')) || (lower.includes('does not prove') && lower.includes('does not guarantee')))) status = 'SUPPORTED';
    return { claimId: criterion.id, status, reason: status === 'SUPPORTED' ? '内置示例规则与固定示例材料匹配；这是本地规则演练，未调用模型或共识。' : status === 'SCOPED_UNKNOWN' ? '声明准确披露示例材料中审计证据未知；能否完成交付由锁定政策决定。这是本地规则演练。' : status === 'CONTRADICTED' ? '示例材料规定7天等待期，与“即时提现、没有等待期”矛盾。' : '示例规则无法确认此表述。不会推定通过；真实语义判断需链上验证。', sourceIndexes: claim.sourceIndexes };
  });
  const derived = items.map(item => ({ ...item, deliveryStatus: deliveryStatus(item.status, lockedCriteria.find(c => c.id === item.claimId)?.evidence_requirement || 'fact_required') }));
  return { verdict: aggregate(derived.map(i => i.deliveryStatus === 'FULFILLED' ? 'SUPPORTED' : i.deliveryStatus === 'CONTRADICTED' ? 'CONTRADICTED' : 'INSUFFICIENT_EVIDENCE')), items: derived, evaluatedAt: new Date().toISOString(), mode: 'demo' };
}
async function assessTypedDemo(revision: Revision, criteria: Criterion[]): Promise<Assessment> {
  const expectedHash = await sha256(DEMO_EVIDENCE);
  const validSource = (index: number) => revision.sources[index]?.sha256 === expectedHash && revision.sources[index]?.byteLength === new TextEncoder().encode(DEMO_EVIDENCE).length && revision.sources[index]?.url === DEMO_SUBMISSION.sources[0].url;
  const items: Finding[] = criteria.map(criterion => {
    const claim = revision.claims.find(item => item.criterion === criterion.id);
    const base: Finding = { claimId: criterion.id, claimType: claim?.claimType || null, validity: null, status: 'MISSING', deliveryStatus: 'INSUFFICIENT', sourceIndexes: [], basisScopeSourceIndexes: [], scopeSourceIndexes: [], fieldChecks: [], reason: '本地固定规则演练，未调用模型或共识；未提交此项声明。' };
    if (!claim) return base;
    const unknown = claim.claimType === 'unknown_disclosure';
    const selected = unknown ? revision.sources.map((_, index) => index) : claim.sourceIndexes;
    base.basisScopeSourceIndexes = unknown ? [] : [...selected];
    base.scopeSourceIndexes = unknown ? [...selected] : [];
    if (!selected.length || selected.some(index => !validSource(index))) return { ...base, status: 'SOURCE_UNAVAILABLE', reason: '本地演练只识别内置虚构材料，不能核验任意外部来源。' };
    if (unknown) {
      // These are answers in the fixed fictional fixture, not model decisions.
      base.fieldChecks = (criterion.requested_field_ids || []).map(field_id => ({ field_id, state: ['withdrawal_waiting_period','instant_exit_conditions'].includes(field_id) ? 'FOUND' as const : 'NOT_ESTABLISHED' as const, evidence_indices: ['withdrawal_waiting_period','instant_exit_conditions'].includes(field_id) ? [...selected] : [] }));
      const contradicted = base.fieldChecks.some(field => field.state === 'FOUND');
      base.status = contradicted ? 'CONTRADICTED' : 'SCOPED_UNKNOWN';
      base.validity = contradicted ? 'CONTRADICTED' : 'VALID';
      base.sourceIndexes = contradicted ? [...selected] : [];
      base.reason = '内置材料给出虚构协议的7天退出等待期，未建立默认 Ownable/Context 或审计覆盖字段答案。此结果仅是本地固定规则演练。';
    } else {
      base.status = 'NOT_ESTABLISHED'; base.validity = 'NOT_ESTABLISHED';
      base.reason = '本地固定规则不判断新的事实标准是否充分；真实语义验收需经过链上模型与共识。';
      const lower = claim.text.toLowerCase();
      if (claim.claimType === 'boundary_disclosure' && ((claim.text.includes('不证明') && claim.text.includes('不保证收益')) || (lower.includes('does not prove') && lower.includes('does not guarantee'))) && criterion.id === 'limitations') {
        base.status = 'BOUNDARY_DISCLOSED'; base.validity = 'ESTABLISHED';
        base.reason = '内置边界示例与固定规则匹配；这是本地演练，未调用模型或共识。';
      }
    }
    base.deliveryStatus = deliveryStatus(base.status, criterion.evidence_requirement || 'fact_required');
    return base;
  });
  return { verdict: aggregateFindings(items, criteria), items, evaluatedAt: new Date().toISOString(), mode: 'demo' };
}
