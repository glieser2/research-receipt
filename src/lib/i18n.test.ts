import { beforeEach, describe, expect, it } from 'vitest';
import bradburyEvidence from '../../docs/evidence/bradbury-v6-wallet-4-e2e.json';
import studioEvidence from '../../docs/evidence/studio-e2e.json';
import { CRITERIA, SOURCE_CRITERIA, V6_CRITERIA, POLICY_V6, renderClaimStatement, type Claim, type Finding, type Order, type Revision } from './domain';
import { assessDemo, demoSubmission, seedOrders } from './demo';
import { publicExampleSubmission, publicV6ExampleSubmission } from './liveExample';
import {
  CRITERION_GROUP_LABELS,
  FIELD_LABELS_EN,
  LANGUAGE_STORAGE_KEY,
  SOURCE_CHECK_LABELS_I18N,
  UI_TEXT,
  displayClaimText,
  displayCriterionText,
  displayReportBody,
  findingLabelI18n,
  getFieldLabel,
  getLanguage,
  humanStatusI18n,
  localizeChainText,
  localizeMessage,
  localizeOrderForDisplay,
  setLanguage,
} from './i18n';

const CJK_REGEX = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (typeof value === 'function') {
    // 使用多组参数调用字典中的格式化函数，覆盖不同分支且不吞咽异常
    const fn = value as (...args: unknown[]) => unknown;
    for (const args of [
      [1, 'Sample', '0x1234', 2, 'detail'],
      [0, '', '0xabcd', 0, ''],
      [2, 'ACCEPTED', '0x9999', 5, 'extra'],
    ]) {
      const sample = fn(...args);
      expect(typeof sample).toBe('string');
      if (typeof sample === 'string') out.push(sample);
    }
  } else if (Array.isArray(value)) {
    value.forEach(item => collectStrings(item, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectStrings(item, out));
  }
  return out;
}

describe('i18n bilingual support & zero-Chinese-in-English guarantees', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
        clear: () => { store.clear(); },
      },
      configurable: true,
    });
  });

  it('defaults to English (en) and allows switching between en and zh', () => {
    expect(getLanguage()).toBe('en');
    setLanguage('zh');
    expect(getLanguage()).toBe('zh');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh');
    setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('contains zero Chinese characters across all English UI dictionaries, status labels, and criteria', () => {
    expect(Object.keys(UI_TEXT.en).sort()).toEqual(Object.keys(UI_TEXT.zh).sort());
    const enStrings = [
      ...collectStrings(UI_TEXT.en),
      ...collectStrings(CRITERION_GROUP_LABELS.en),
      ...collectStrings(SOURCE_CHECK_LABELS_I18N.en),
      ...collectStrings(FIELD_LABELS_EN),
    ];
    for (const s of enStrings) {
      expect(s).not.toMatch(CJK_REGEX);
    }

    const statuses = [
      'ACCEPTED', 'REVISION_REQUIRED', 'NOT_ACCEPTED', 'INSUFFICIENT_EVIDENCE',
      'SUPPORTED', 'BOUNDARY_DISCLOSED', 'SCOPED_UNKNOWN', 'NOT_ESTABLISHED',
      'MISSING', 'SOURCE_UNAVAILABLE', 'FULFILLED', 'INSUFFICIENT',
      'CONTRADICTED', 'UNSUPPORTED', 'PENDING', undefined,
    ];
    for (const st of statuses) {
      expect(humanStatusI18n(st, 'en')).not.toMatch(CJK_REGEX);
      expect(findingLabelI18n(st, false, 'en')).not.toMatch(CJK_REGEX);
      expect(findingLabelI18n(st, true, 'en')).not.toMatch(CJK_REGEX);
    }

    for (const criterion of [...CRITERIA, ...SOURCE_CRITERIA, ...V6_CRITERIA]) {
      const textEn = displayCriterionText(criterion, 'en');
      expect(textEn).not.toMatch(CJK_REGEX);
      const textZh = displayCriterionText(criterion, 'zh');
      expect(textZh).toMatch(CJK_REGEX);
    }
  });

  it('localizes demo orders, templates, and assessments in English with zero Chinese characters and identical verdicts', async () => {
    const orders = await seedOrders();
    const localizedEn = orders.map(order => localizeOrderForDisplay(order, 'en'));
    for (const s of collectStrings(localizedEn)) {
      expect(s).not.toMatch(CJK_REGEX);
    }

    const subEn = await demoSubmission('en');
    for (const s of collectStrings(subEn)) {
      expect(s).not.toMatch(CJK_REGEX);
    }
    const subZh = await demoSubmission('zh');
    const evalEn = await assessDemo({ ...subEn, number: 1 }, orders[0].criteria);
    const evalZh = await assessDemo({ ...subZh, number: 1 }, orders[0].criteria);
    expect(evalEn.verdict).toBe(evalZh.verdict);
    expect(evalEn.items.map(i => i.status)).toEqual(evalZh.items.map(i => i.status));

    const exEnFalse = publicExampleSubmission(false, 'en');
    const exEnTrue = publicExampleSubmission(true, 'en');
    for (const s of [...collectStrings(exEnFalse), ...collectStrings(exEnTrue)]) {
      expect(s).not.toMatch(CJK_REGEX);
    }

    const v6Sub = publicV6ExampleSubmission(true, V6_CRITERIA, 'en');
    expect(v6Sub.reportTitle).not.toMatch(CJK_REGEX);
    for (const src of v6Sub.sources) {
      expect(src.label).not.toMatch(CJK_REGEX);
    }
    for (const claim of v6Sub.claims) {
      expect(displayClaimText(claim, V6_CRITERIA, 'en')).not.toMatch(CJK_REGEX);
    }
    expect(displayReportBody(v6Sub.claims, V6_CRITERIA, 'en')).not.toMatch(CJK_REGEX);
  });

  it('localizes all 9 real Bradbury Phase 2 on-chain orders and 3 Studio orders with zero Chinese characters in English mode', () => {
    const bradburyRawOrders = Object.values(((bradburyEvidence as { orders?: unknown }).orders || {}) as Record<string, unknown>);
    const studioRawOrders = Object.values(((studioEvidence as { orders?: unknown }).orders || {}) as Record<string, unknown>);
    expect(bradburyRawOrders.length).toBe(9);
    expect(studioRawOrders.length).toBe(3);
    let totalRevisions = 0;
    let totalAssessments = 0;

    for (const rawEvidence of [bradburyEvidence as unknown, studioEvidence as unknown]) {
      const rawOrders = Object.values(((rawEvidence as { orders?: unknown }).orders || {}) as Record<string, unknown>) as Record<string, unknown>[];

      for (const entry of rawOrders) {
        const rawOrder = (entry.order || entry) as {
          id: number;
          policy_version?: string;
          spec: {
            title: string;
            protocol: string;
            chain: string;
            as_of: string;
            author: string;
            allowed_hosts: string[];
            criteria: typeof V6_CRITERIA;
          };
        };
        const rawRevs = (entry.revisions || []) as {
          number?: number;
          revision?: { revision?: number; submission: { report_title: string; report_body: string; sources: { url: string; sha256: string; byte_length: number }[]; claims: { criterion_id: string; statement?: string; evidence_indices?: number[]; claim_type?: Claim['claimType'] }[] } };
          submission?: { revision?: number; submission: { report_title: string; report_body: string; sources: { url: string; sha256: string; byte_length: number }[]; claims: { criterion_id: string; statement?: string; evidence_indices?: number[]; claim_type?: Claim['claimType'] }[] } };
          assessment?: { verdict: string; findings: { criterion_id: string; status: string; reason: string; evidence_indices?: number[]; delivery_status?: string }[] } | null;
        }[];
        const v6 = rawOrder.policy_version === POLICY_V6;
        const revisions: Revision[] = rawRevs.map((rEntry, revIdx) => {
          const subRecord = rEntry.revision || rEntry.submission!;
          const sub = subRecord.submission;
          const a = rEntry.assessment;
          const claims: Claim[] = sub.claims.map(c => {
            const cl: Claim = {
              id: c.criterion_id,
              criterion: c.criterion_id,
              text: c.statement || '',
              sourceIndexes: c.evidence_indices || [],
              ...(v6 ? { claimType: c.claim_type } : {}),
            };
            if (v6) cl.text = renderClaimStatement(cl, rawOrder.spec.criteria);
            return cl;
          });
          return {
            number: rEntry.number ?? subRecord.revision ?? (revIdx + 1),
            reportTitle: sub.report_title,
            reportBody: sub.report_body,
            reportUrl: '',
            sources: sub.sources.map((s, idx) => ({
              url: s.url,
              sha256: s.sha256,
              byteLength: s.byte_length,
              label: `固定证据 ${idx + 1}`,
              publishedAt: '',
            })),
            claims,
            assessment: a
              ? {
                  verdict: a.verdict,
                  items: a.findings.map(f => ({
                    claimId: f.criterion_id,
                    status: f.status,
                    reason: f.reason,
                    sourceIndexes: f.evidence_indices || [],
                    deliveryStatus: f.delivery_status,
                  } as Finding)),
                  evaluatedAt: '',
                  mode: 'live',
                }
              : undefined,
          };
        });

        const orderObj: Order = {
          id: rawOrder.id,
          title: rawOrder.spec.title,
          protocol: rawOrder.spec.protocol,
          chain: rawOrder.spec.chain,
          asOf: rawOrder.spec.as_of,
          author: rawOrder.spec.author,
          policyVersion: rawOrder.policy_version,
          allowedHosts: rawOrder.spec.allowed_hosts,
          createdAt: '',
          criteria: rawOrder.spec.criteria,
          revisions,
        };

        const localized = localizeOrderForDisplay(orderObj, 'en');
        totalRevisions += localized.revisions.length;
        totalAssessments += localized.revisions.filter(r => Boolean(r.assessment)).length;
        for (const s of collectStrings(localized)) {
          expect(s).not.toMatch(CJK_REGEX);
        }
      }
    }
    expect(totalRevisions).toBeGreaterThanOrEqual(13);
    expect(totalAssessments).toBeGreaterThanOrEqual(13);
  });

  it('translates internal errors and status messages into pure English when lang is en', () => {
    const sampleMessages = [
      '连接钱包后核验写入环境。',
      '写入环境尚未通过核验：合约缺少可核验的 V6 政策或字段目录；当前仅可读取。',
      '未知披露不接受作者自选来源或自由正文。',
      '已确认执行成功。订单 #9，请重新读取该订单查看记录。',
      '请在钱包中切换到正确测试网络（Chain ID 4221）后重试。',
      '此版本的证据快照已锁定，成功或失败结果都不能重新抓取。',
    ];
    for (const msg of sampleMessages) {
      const en = localizeMessage(msg, 'en');
      expect(en).not.toMatch(CJK_REGEX);
      expect(localizeMessage(msg, 'zh')).toBe(msg);
    }
    expect(getFieldLabel('default_ownable_controls', 'en')).toBe('Default Ownable Authorization Checks');
    expect(getFieldLabel('default_ownable_controls', 'zh')).toBe('默认所有者权限检查');
    expect(localizeChainText('固定证据 1', 'en')).toBe('Pinned Evidence 1');
  });
});
