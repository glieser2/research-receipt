import { CRITERIA, V6_CRITERIA, POLICY_V6, CATALOG_VERSION, renderClaimStatement, serializeClaim, validateV6Criteria, structuredReportBody, validateSubmission, type Claim, type Finding, type Order, type Revision, type Config, type Assessment } from './domain';
import { assessDemo, demoSubmission, seedOrders, DEMO_SUBMISSION as initialSubmission } from './demo';
import { read, withReadSession, write } from './live';
import deployment from '../deployment.json';
import { validateEvidenceRecord, validateEvidenceSnapshot } from './evidence-snapshot.mjs';
export type { Order, Revision, Claim, Source, Assessment, Config } from './domain';
export { CRITERIA, SOURCE_CRITERIA, V6_CRITERIA, POLICY_V6, CATALOG_VERSION, FIELD_CATALOG, deriveCriterionText, criterionAllowsUnknown, renderClaimStatement, serializeClaim } from './domain';
export { publicExampleSubmission, publicV6ExampleSubmission } from './liveExample';
export { connectWallet, connectDevSession, getDevSessionAddress, watchTransactions, getPendingTransaction, resumePendingTransaction, getWriteCompatibility } from './live';
const DEMO_KEY = 'rr:demo:v1';
const CONFIG_KEY = 'rr:config:v1';
export const DEMO_SUBMISSION = initialSubmission;
// Complete the actual digest before a user can submit the prefilled local example.
demoSubmission().then(input => Object.assign(DEMO_SUBMISSION, input));
export function getConfig(): Config {
  try { const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null'); if (saved && ['demo','live'].includes(saved.mode)) return saved; } catch { /* Use safe default for invalid local settings. */ }
  return { mode: deployment.verified ? 'live' : 'demo', rpcUrl: deployment.rpcUrl, contractAddress: deployment.contractAddress };
}
export function saveConfig(config: Config) { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
async function demoOrders(): Promise<Order[]> {
  const value = localStorage.getItem(DEMO_KEY);
  if (value) { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; throw new Error('本地演练记录格式损坏。请导出浏览器数据后重新建立演练记录。'); }
  const orders = await seedOrders();
  localStorage.setItem(DEMO_KEY, JSON.stringify(orders));
  return orders;
}
function persist(orders: Order[]) { localStorage.setItem(DEMO_KEY, JSON.stringify(orders)); }
const demoOrigin = { mode: 'demo' as const, rpcUrl: '', contractAddress: '' };
export async function listDemoOrders() { return structuredClone(await demoOrders()).map(order => ({ ...order, origin: demoOrigin })); }
export async function loadPublishedExamples(config: Config): Promise<Order[]> {
  const published = deployment as typeof deployment & { sampleOrderIds?: number[] };
  if (!published.verified || config.mode !== 'live' || config.rpcUrl !== published.rpcUrl || config.contractAddress.toLowerCase() !== published.contractAddress.toLowerCase()) return [];
  return Promise.all((published.sampleOrderIds || []).map(id => loadOrder(id, config)));
}
function assertOrigin(order: Order, config: Config) {
  if (!order.origin || order.origin.mode !== config.mode || (config.mode === 'live' && (order.origin.rpcUrl !== config.rpcUrl || order.origin.contractAddress.toLowerCase() !== config.contractAddress.toLowerCase()))) throw new Error('当前模式或合约已改变。请从当前网络重新载入订单再操作。');
}
function parseJson(value: unknown) { if (typeof value !== 'string') throw new Error('合约返回格式不符，无法核验记录。'); return JSON.parse(value); }
function iso(value: unknown): string {
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  return typeof value === 'string' ? value : '';
}
export async function loadOrder(id: number, config: Config): Promise<Order> {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('订单 ID 必须为正整数。');
  if (config.mode === 'demo') {
    const order = (await demoOrders()).find(o => o.id === id);
    if (!order) throw new Error('未找到本地示例订单。');
    return { ...structuredClone(order), origin: demoOrigin };
  }
  const origin = { ...config };
  return withReadSession(origin, async sessionRead => {
    const raw = parseJson(await sessionRead('get_order', [id]));
    const spec = raw.spec;
    if (!spec || raw.id !== id || !Number.isInteger(raw.revision_count) || raw.revision_count < 0 || raw.revision_count > 5) throw new Error('合约订单结构与本应用不匹配。');
    const v6 = raw.policy_version === POLICY_V6;
    const staged = raw.policy_version === 'research-receipt/5' || v6;
    const revisions: Revision[] = [];
    for (let number = 1; number <= raw.revision_count; number++) {
      const [revisionRaw, assessmentRaw, snapshotRaw] = await Promise.all([
        sessionRead('get_revision', [id, number]), sessionRead('get_assessment', [id, number]),
        staged ? sessionRead('get_evidence_snapshot', [id, number]) : Promise.resolve(''),
      ]);
      const record = parseJson(revisionRaw);
      const submission = record.submission;
      const a = assessmentRaw ? parseJson(assessmentRaw) : null;
      const snapshot = staged && snapshotRaw !== '' ? parseJson(snapshotRaw) : null;
      let evidenceSnapshot: Revision['evidenceSnapshot'];
      if (staged) {
        if (a && !snapshot) throw new Error('验收记录缺少已绑定的证据快照，不能视为通过。');
        try {
          if (snapshot) evidenceSnapshot = await validateEvidenceSnapshot({ snapshot, order: raw, revision: record, expectedRevision: number, assessment: a });
          else await validateEvidenceRecord({ order: raw, revision: record, expectedRevision: number });
        } catch { throw new Error('链上证据快照与当前订单、版本或材料承诺不一致，已停止读取。'); }
      }
      let assessment: Assessment | undefined;
      if (a) assessment = { verdict: a.verdict, items: a.findings.map((f: Record<string, unknown>) => ({ claimId: f.criterion_id, status: f.status, reason: f.reason, sourceIndexes: f.evidence_indices, ...(f.delivery_status ? { deliveryStatus: f.delivery_status } : {}), ...(v6 ? { claimType: f.claim_type, validity: f.validity, basisScopeSourceIndexes: f.basis_scope_source_indices, scopeSourceIndexes: f.scope_source_indices, fieldChecks: f.field_checks } : {}) } as Finding)), evaluatedAt: iso(a.assessed_at), mode: 'live', ...(a.snapshot_hash ? { snapshotHash: a.snapshot_hash } : {}) };
      revisions.push({ number, reportTitle: submission.report_title, reportBody: submission.report_body, reportUrl: '', sources: submission.sources.map((s: { url: string; sha256: string; byte_length: number }, i: number) => ({ url: s.url, sha256: s.sha256, byteLength: s.byte_length, label: `固定证据 ${i+1}`, publishedAt: '' })), claims: submission.claims.map((c: { criterion_id: string; statement?: string; evidence_indices?: number[]; claim_type?: Claim['claimType']; disclosure_version?: string; scope?: string }) => {
        const claim: Claim = { id: c.criterion_id, criterion: c.criterion_id, text: c.statement || '', sourceIndexes: c.evidence_indices || [], ...(v6 ? { claimType: c.claim_type, ...(c.disclosure_version ? { disclosureVersion: c.disclosure_version } : {}), ...(c.scope ? { scope: c.scope } : {}) } : {}) };
        if (v6) claim.text = renderClaimStatement(claim, spec.criteria);
        return claim;
      }), assessment, ...(evidenceSnapshot ? { evidenceSnapshot } : {}), chainRecord: { submission: record, assessment: a, ...(staged ? { snapshot } : {}) } });
    }
    return { id, title: spec.title, protocol: spec.protocol, chain: spec.chain, asOf: spec.as_of, author: spec.author, owner: raw.owner, ...(typeof raw.policy_version === 'string' ? { policyVersion: raw.policy_version } : {}), ...(v6 ? { catalogVersion: spec.catalog_version } : {}), allowedHosts: spec.allowed_hosts, sourceRoots: spec.source_roots, criteria: spec.criteria, createdAt: iso(raw.created_at), revisions, chainRecord: raw, origin };
  });
}
export async function createOrder(input: Omit<Order, 'id' | 'revisions' | 'createdAt'>, config: Config): Promise<Order> {
  if (!input.title.trim() || !input.protocol.trim() || !input.chain.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) throw new Error('请填写委托名称、协议、链及有效资料截止日期。');
  if (config.mode === 'demo') {
    const orders = await demoOrders();
    const typed = input.policyVersion === POLICY_V6 || input.criteria?.some(criterion => criterion.verification_kind !== undefined);
    if (typed) validateV6Criteria(input.criteria || V6_CRITERIA, input.catalogVersion || CATALOG_VERSION);
    const order = { ...structuredClone(input), ...(typed ? { policyVersion: POLICY_V6, catalogVersion: CATALOG_VERSION, criteria: structuredClone(input.criteria || V6_CRITERIA) } : {}), id: Math.max(0, ...orders.map(o => o.id)) + 1, createdAt: new Date().toISOString(), revisions: [], origin: demoOrigin };
    orders.unshift(order); persist(orders); return order;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.author)) throw new Error('研究作者必须是有效的钱包地址。');
  if (input.allowedHosts.some(h => h !== 'raw.githubusercontent.com') || input.allowedHosts.length !== 1) throw new Error('首版链上来源仅允许 raw.githubusercontent.com 的固定 commit 文件。');
  if (!input.sourceRoots?.length || input.sourceRoots.some(root => !/^raw\.githubusercontent\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/$/.test(root))) throw new Error('请锁定至少一个可信仓库前缀，例如 raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/。');
  const ref = crypto.randomUUID();
  const criteria = input.criteria || V6_CRITERIA;
  validateV6Criteria(criteria, input.catalogVersion || CATALOG_VERSION);
  const spec = { client_ref: ref, title: input.title, protocol: input.protocol, chain: input.chain, as_of: input.asOf, author: input.author, allowed_hosts: input.allowedHosts, source_roots: input.sourceRoots || [], catalog_version: input.catalogVersion || CATALOG_VERSION, criteria };
  await write(config, 'create_order', [JSON.stringify(spec)], { clientRef: ref, policyVersion: POLICY_V6 });
  const id = Number(await read(config, 'get_order_id', [ref]));
  if (!id) throw new Error('交易已完成，但未读到订单 ID。请保留交易记录，勿重复创建。');
  return loadOrder(id, config);
}
export async function submitRevision(order: Order, input: Omit<Revision, 'number' | 'assessment'>, config: Config) {
  assertOrigin(order, config);
  validateSubmission(input, order, config.mode === 'live');
  const current = await loadOrder(order.id, config);
  if (current.revisions.length >= 5) throw new Error('每个订单最多 5 个交付版本。');
  if (current.revisions.at(-1)?.assessment?.verdict === 'ACCEPTED') throw new Error('此委托已完成验收。新的研究范围需要新建委托。');
  if (current.revisions.length && !current.revisions.at(-1)?.assessment) throw new Error('请先完成上一版本的验收。');
  if (config.mode === 'demo') {
    const orders = await demoOrders(); const index = orders.findIndex(o => o.id === order.id);
    orders[index].revisions.push({ ...structuredClone(input), number: current.revisions.length + 1 });
    persist(orders); return { ...structuredClone(orders[index]), origin: demoOrigin };
  }
  if (current.policyVersion !== POLICY_V6) throw new Error('旧政策订单仅供读取；请在已核验的 V6 合约新建委托。');
  const reportBody = structuredReportBody(input.claims, order.criteria || CRITERIA);
  if (new TextEncoder().encode(reportBody).length > 12000) throw new Error('报告正文超过 12000 UTF-8 字节。');
  if (current.policyVersion !== order.policyVersion || JSON.stringify(current.criteria) !== JSON.stringify(order.criteria)) throw new Error('当前政策或锁定标准发生变化，请重新载入订单。');
  const submission = { report_title: input.reportTitle, report_body: reportBody, report_version: `v${current.revisions.length + 1}`, sources: input.sources.map(s => ({ url: s.url, sha256: s.sha256.toLowerCase(), byte_length: s.byteLength })), claims: input.claims.map(c => current.policyVersion === POLICY_V6 ? serializeClaim(c, current.criteria || []) : ({ criterion_id: c.criterion, statement: c.text, evidence_indices: c.sourceIndexes })) };
  await write(config, 'submit_revision', [order.id, JSON.stringify(submission)], { orderId: order.id, revision: current.revisions.length + 1, policyVersion: current.policyVersion });
  return loadOrder(order.id, config);
}
export async function evaluateRevision(order: Order, revision: number, config: Config) {
  config = { ...config };
  assertOrigin(order, config);
  const current = await loadOrder(order.id, config);
  const found = current.revisions.find(r => r.number === revision);
  if (!found || found.assessment) throw new Error('版本不存在，或此版本已完成验收。请查看已有回执。');
  if (current.revisions.at(-1)?.number !== revision) throw new Error('只能对当前提交版本执行操作，请重新读取订单。');
  if (config.mode === 'live' && ['research-receipt/5', POLICY_V6].includes(current.policyVersion || '') && !found.evidenceSnapshot) throw new Error('请先锁定此版本的链上证据快照，再单独发起评估。');
  if (config.mode === 'demo') {
    const assessment = await assessDemo(found, current.criteria);
    const orders = await demoOrders(); const index = orders.findIndex(o => o.id === order.id);
    orders[index].revisions.find(r => r.number === revision)!.assessment = assessment;
    persist(orders); return { ...structuredClone(orders[index]), origin: demoOrigin };
  }
  if (current.policyVersion !== POLICY_V6) throw new Error('旧政策订单仅供读取；请在已核验的 V6 合约新建委托。');
  const txHash = await write(config, 'evaluate', [order.id, revision], { orderId: order.id, revision, policyVersion: current.policyVersion });
  const refreshed = await loadOrder(order.id, config);
  const result = refreshed.revisions.find(r => r.number === revision)?.assessment;
  if (!result) throw new Error('已确认交易执行，但尚未读到验收记录。请按订单 ID 重新读取。');
  result.txHash = txHash;
  return refreshed;
}
export async function verifyEvidence(order: Order, revision: number, config: Config) {
  config = { ...config };
  assertOrigin(order, config);
  const current = await loadOrder(order.id, config);
  if (config.mode !== 'live' || current.policyVersion !== POLICY_V6) throw new Error('旧政策订单仅供读取；锁定证据仅支持已核验的 V6 合约。');
  const found = current.revisions.find(item => item.number === revision);
  if (!found || current.revisions.at(-1)?.number !== revision) throw new Error('只能锁定当前提交版本的证据，请重新读取订单。');
  if (found.evidenceSnapshot) throw new Error('此版本的证据快照已锁定，成功或失败结果都不能重新抓取。');
  if (found.assessment || (current.chainRecord as { status?: string })?.status !== 'SUBMITTED') throw new Error('当前版本不是待验收提交状态，不能锁定证据。');
  await write(config, 'verify_evidence', [order.id, revision], { orderId: order.id, revision, policyVersion: current.policyVersion });
  const refreshed = await loadOrder(order.id, config);
  if (!refreshed.revisions.find(item => item.number === revision)?.evidenceSnapshot) throw new Error('已确认交易执行，但尚未读到证据快照。请保留交易记录并重新读取，不要重复锁源。');
  return refreshed;
}
export function buildReceipt(order: Order, revision: number) {
  const selected = order.revisions.find(r => r.number === revision);
  if (!selected) throw new Error('未找到需要导出的版本。');
  if (!order.origin) throw new Error('记录来源未绑定，无法导出可信回执。请重新载入订单。');
  return { format: 'research-receipt/v1', exportedAt: new Date().toISOString(), mode: order.origin.mode, scope: 'Consistency of submitted claims with committed public evidence; not a security audit, deployment verification, or investment recommendation.', network: order.origin.mode === 'live' ? { rpcUrl: order.origin.rpcUrl, contract: order.origin.contractAddress } : null, order: { ...order, revisions: undefined }, revision: selected };
}
export function exportReceipt(order: Order, revision: number) {
  const receipt = buildReceipt(order, revision);
  const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `research-receipt-${order.id}-v${revision}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
