export type Mode = 'demo' | 'live';
export type EvidenceRequirement = 'fact_required' | 'scoped_unknown_allowed';
import { CATALOG_VERSION, FIELD_CATALOG, POLICY_V6, UNKNOWN_DISCLOSURE_VERSION, deriveCriterionText, renderV6ClaimStatement, validateV6Criteria, validateV6Submission } from './field-catalog.mjs';
export { CATALOG_VERSION, FIELD_CATALOG, POLICY_V6, deriveCriterionText, validateV6Criteria } from './field-catalog.mjs';
export type ClaimType = 'factual_assertion' | 'unknown_disclosure' | 'boundary_disclosure';
export interface Criterion { id: string; text: string; required: boolean; evidence_requirement?: EvidenceRequirement; verification_kind?: 'evidence_review' | 'boundary_review'; allowed_claim_types?: ClaimType[]; requested_field_ids?: string[] }
export interface Source { url: string; sha256: string; byteLength: number; publishedAt: string; label: string }
export interface Claim { id: string; text: string; criterion: string; sourceIndexes: number[]; claimType?: ClaimType; disclosureVersion?: string; scope?: string }
export interface FieldCheck { field_id: string; state: 'FOUND' | 'NOT_ESTABLISHED'; evidence_indices: number[] }
export interface Finding { claimId: string; status: string; reason: string; sourceIndexes: number[]; deliveryStatus?: string; claimType?: ClaimType | null; validity?: string | null; basisScopeSourceIndexes?: number[]; scopeSourceIndexes?: number[]; fieldChecks?: FieldCheck[] }
export interface Assessment { verdict: string; items: Finding[]; evaluatedAt: string; mode: Mode; txHash?: string; snapshotHash?: string }
export interface Revision { number: number; reportTitle: string; reportUrl: string; reportBody?: string; claims: Claim[]; sources: Source[]; assessment?: Assessment; evidenceSnapshot?: EvidenceSnapshotSummary; chainRecord?: unknown }
export interface Order { id: number; title: string; protocol: string; chain: string; asOf: string; author: string; owner?: string; policyVersion?: string; catalogVersion?: string; allowedHosts: string[]; createdAt: string; revisions: Revision[]; sourceRoots?: string[]; criteria?: Criterion[]; chainRecord?: unknown; origin?: { mode: Mode; rpcUrl: string; contractAddress: string } }
export interface Config { mode: Mode; rpcUrl: string; contractAddress: string }
export const CRITERIA = [
  { id: 'permissions', text: '说明管理员与升级权限，区分源文件所能支持的事实和部署状态；无证据的部分必须准确披露。', required: true },
  { id: 'withdrawals', text: '说明提现、赎回或退出限制，区分已核查事实与材料未覆盖的机制，不得作无证据承诺。', required: true },
  { id: 'audit', text: '准确说明审计覆盖范围及版本，未获得审计证据必须承认未知。', required: true },
  { id: 'limitations', text: '明确研究的证据边界，不把未发现问题表述为安全或收益保证。', required: true },
].map(item => ({ ...item, evidence_requirement: 'fact_required' as const }));
export const SOURCE_CRITERIA: Criterion[] = [
  { id: 'permissions', text: '说明材料可支持的管理员与升级权限，材料未涉及的权限明确标为未知，区分源文件事实和真实部署状态。', required: true, evidence_requirement: 'fact_required' },
  { id: 'withdrawals', text: '说明材料可支持的提现、赎回或退出限制；材料未提供机制时明确未知，不得无证据承诺即时退出。', required: true, evidence_requirement: 'fact_required' },
  { ...CRITERIA[2] }, { ...CRITERIA[3] },
];
export const V6_CRITERIA: Criterion[] = ['permissions','withdrawals','audit'].map(group => {
  const ids = FIELD_CATALOG.fields.filter(field => field.group === group).map(field => field.id);
  return { id: group, text: deriveCriterionText(ids), required: true, evidence_requirement: 'fact_required', verification_kind: 'evidence_review', allowed_claim_types: ['factual_assertion','unknown_disclosure'], requested_field_ids: ids };
});
V6_CRITERIA.push({ id: 'limitations', text: CRITERIA[3].text, required: true, evidence_requirement: 'fact_required', verification_kind: 'boundary_review', allowed_claim_types: ['boundary_disclosure'], requested_field_ids: [] });
export const criterionAllowsUnknown = (criterion: Criterion) => criterion.allowed_claim_types?.includes('unknown_disclosure') === true;
export function renderClaimStatement(claim: Claim, criteria: readonly Criterion[] = V6_CRITERIA): string {
  if (claim.claimType !== 'unknown_disclosure') return claim.claimType ? claim.text.trim() : claim.text;
  return renderV6ClaimStatement({ criteria }, { criterion_id: claim.criterion, claim_type: claim.claimType });
}
export function serializeClaim(claim: Claim, criteria: readonly Criterion[]): Record<string, unknown> {
  if (claim.claimType === 'unknown_disclosure') {
    if (claim.sourceIndexes.length || (claim.text !== '' && claim.text !== renderClaimStatement(claim, criteria))) throw new Error('未知披露不接受作者自选来源或自由正文。');
    if (claim.disclosureVersion !== undefined && claim.disclosureVersion !== UNKNOWN_DISCLOSURE_VERSION || claim.scope !== undefined && claim.scope !== 'all_committed_sources') throw new Error('未知披露版本或范围不符。');
    return { criterion_id: claim.criterion, claim_type: claim.claimType, disclosure_version: UNKNOWN_DISCLOSURE_VERSION, scope: 'all_committed_sources' };
  }
  if (!claim.claimType || claim.disclosureVersion !== undefined || claim.scope !== undefined) throw new Error('V6 声明必须明确类型，事实与边界声明不能携带未知披露字段。');
  return { criterion_id: claim.criterion, claim_type: claim.claimType, statement: claim.text, evidence_indices: claim.sourceIndexes };
}
export function aggregateFindings(findings: Finding[], criteria: readonly Criterion[]): string {
  const required = findings.filter(item => criteria.find(c => c.id === item.claimId)?.required);
  if (required.some(item => item.status === 'CONTRADICTED')) return 'NOT_ACCEPTED';
  if (required.some(item => item.deliveryStatus !== 'FULFILLED')) return 'INSUFFICIENT_EVIDENCE';
  return findings.some(item => !criteria.find(c => c.id === item.claimId)?.required && item.status !== 'MISSING' && item.deliveryStatus !== 'FULFILLED') ? 'REVISION_REQUIRED' : 'ACCEPTED';
}
export function aggregate(statuses: string[]): string {
  if (!statuses.length) return 'INSUFFICIENT_EVIDENCE';
  if (statuses.some(s => s === 'CONTRADICTED')) return 'NOT_ACCEPTED';
  if (statuses.some(s => s === 'INSUFFICIENT_EVIDENCE')) return 'INSUFFICIENT_EVIDENCE';
  return statuses.every(s => s === 'SUPPORTED') ? 'ACCEPTED' : 'INSUFFICIENT_EVIDENCE';
}
export function deliveryStatus(status: string, requirement: EvidenceRequirement): string {
  if (status === 'CONTRADICTED') return 'CONTRADICTED';
  if (status === 'SUPPORTED' || status === 'BOUNDARY_DISCLOSED' || (status === 'SCOPED_UNKNOWN' && requirement === 'scoped_unknown_allowed')) return 'FULFILLED';
  return 'INSUFFICIENT';
}
export function structuredReportBody(claims: Claim[], criteria: readonly Criterion[] = CRITERIA): string {
  return criteria.flatMap(criterion => claims.filter(claim => claim.criterion === criterion.id).map(claim => claim.claimType ? renderClaimStatement(claim, criteria) : claim.text.trim())).join('\n');
}
export function publicPinnedUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.hostname !== 'raw.githubusercontent.com') throw new Error('证据仅支持 raw.githubusercontent.com 的 HTTPS 原始文件链接。');
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[a-fA-F0-9]{40}\/.+/.test(url.pathname) || /%|\\|\/\.\.?\//.test(value)) throw new Error('请使用含 40 位完整 Git commit 的固定文件链接，不支持分支或标签。');
  return url;
}
export function validateSubmission(input: Omit<Revision, 'number' | 'assessment'>, order: Order, live: boolean): void {
  const v6 = order.policyVersion === POLICY_V6;
  const criteria = order.criteria || CRITERIA;
  if (v6) validateV6Submission({ catalog_version: order.catalogVersion, criteria }, { sources: input.sources, claims: input.claims.map(claim => serializeClaim(claim, criteria)), report_body: structuredReportBody(input.claims, criteria) });
  else if (input.claims.some(claim => claim.claimType !== undefined || claim.disclosureVersion !== undefined || claim.scope !== undefined)) throw new Error('旧政策订单不能写入 V6 类型声明，请新建 V6 委托。');
  if (input.reportBody !== undefined && input.reportBody !== structuredReportBody(input.claims, order.criteria || CRITERIA)) throw new Error('正文必须是按锁定标准排列的交付条目汇总，不能包含未绑定的文字。');
  if (!input.reportTitle.trim() || input.reportTitle.length > 160) throw new Error('请填写不超过 160 字符的报告名称。');
  if (input.sources.length > 3 || !input.sources.length) throw new Error('每个版本需要 1–3 份来源。');
  if (!input.claims.length || input.claims.length > (v6 ? 6 : 4)) throw new Error('声明数量超过当前政策范围。');
  const ids = new Set<string>();
  for (const claim of input.claims) {
    if (!criteria.some(c => c.id === claim.criterion) || ids.has(claim.criterion)) throw new Error('验收条目重复或无效，每项仅支持一条声明。');
    ids.add(claim.criterion);
    if (claim.claimType !== 'unknown_disclosure') {
      if (!claim.text.trim() || new TextEncoder().encode(claim.text).length > 1200) throw new Error('声明不能为空或超过 1200 UTF-8 字节。');
      if (!claim.sourceIndexes.length || claim.sourceIndexes.some(i => !Number.isInteger(i) || i < 0 || i >= input.sources.length)) throw new Error('每条声明必须关联有效来源。');
    }
  }
  for (const source of input.sources) {
    if (!/^[a-f0-9]{64}$/i.test(source.sha256) || !Number.isInteger(source.byteLength) || source.byteLength < 1 || source.byteLength > 16384) throw new Error('来源需要 64 位 SHA-256 和 1–16384 字节的原始文件大小。');
    if (live) {
      const url = publicPinnedUrl(source.url);
      if (!order.allowedHosts.includes(url.hostname)) throw new Error('来源域名未获委托授权。');
      if (order.sourceRoots?.length && !order.sourceRoots.some(r => source.url.slice(8).startsWith(r))) throw new Error('来源仓库未获委托授权。');
    }
  }
}
import type { EvidenceSnapshotSummary } from './evidence-snapshot.mjs';
export type { EvidenceSnapshotSummary, EvidenceSourceCheck } from './evidence-snapshot.mjs';
