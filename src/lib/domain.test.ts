import { describe, it, expect } from 'vitest';
import { aggregate, deliveryStatus, structuredReportBody, CRITERIA, publicPinnedUrl, validateSubmission } from './domain';
import { assessDemo, demoSubmission, seedOrders } from './demo';
import { V6_CRITERIA, POLICY_V6, CATALOG_VERSION, serializeClaim, renderClaimStatement, validateV6Criteria, aggregateFindings, type Claim } from './domain';
describe('evidence boundaries', () => {
  const commit = 'a'.repeat(40);
  it('accepts immutable public raw GitHub files', () => { expect(publicPinnedUrl(`https://raw.githubusercontent.com/aave/core/${commit}/README.md`).hostname).toBe('raw.githubusercontent.com'); });
  it.each(['https://127.0.0.1/a', 'http://raw.githubusercontent.com/a/b/'+commit+'/x', 'https://raw.githubusercontent.com/a/b/main/x', 'https://raw.githubusercontent.com/a/b/'+commit+'/x?token=secret', 'https://user:pass@raw.githubusercontent.com/a/b/'+commit+'/x', 'https://raw.githubusercontent.com/a/b/'+commit+'/%2e%2e/x'])('rejects unsafe or mutable URL %s', url => expect(() => publicPinnedUrl(url)).toThrow());
  it('does not pass unknown or missing evidence', () => { expect(aggregate(['SUPPORTED','INSUFFICIENT_EVIDENCE'])).toBe('INSUFFICIENT_EVIDENCE'); expect(aggregate([])).toBe('INSUFFICIENT_EVIDENCE'); });
  it('rejects a contradicted required finding consistently with the contract', () => { expect(aggregate(['SUPPORTED','CONTRADICTED'])).toBe('NOT_ACCEPTED'); });
  it('rejects duplicate criteria and out-of-range citations', async () => {
    const order = (await seedOrders())[0]; const input = await demoSubmission();
    input.claims[1].criterion = input.claims[0].criterion; expect(() => validateSubmission(input, order, false)).toThrow();
    input.claims[1].criterion = 'withdrawals'; input.claims[0].sourceIndexes = [9]; expect(() => validateSubmission(input, order, false)).toThrow();
  });
  it('requires actual byte bounds and complete digests', async () => { const order=(await seedOrders())[0]; const input=await demoSubmission(); input.sources[0].byteLength=16385; expect(() => validateSubmission(input,order,false)).toThrow(); });
  it('binds the complete report to locked-criterion order even when claims are reordered', async () => {
    const input = await demoSubmission(); const order = (await seedOrders())[0];
    const expected = input.claims.map(c => c.text).join('\n');
    input.claims.reverse();
    expect(structuredReportBody(input.claims)).toBe(expected);
    input.reportBody = expected;
    expect(() => validateSubmission(input, order, false)).not.toThrow();
  });
  it('rejects unclaimed prose and keeps a missing section absent from the derived report', async () => {
    const input = await demoSubmission(); const order = (await seedOrders())[0];
    input.reportBody = structuredReportBody(input.claims) + '\n未绑定的收益保证。';
    expect(() => validateSubmission(input, order, false)).toThrow('正文');
    input.claims = input.claims.filter(c => c.criterion !== 'permissions');
    input.reportBody = structuredReportBody(input.claims);
    expect(input.reportBody).not.toContain('管理员可升级');
    expect(() => validateSubmission(input, order, false)).not.toThrow();
  });
});
describe('V6 buyer-owned fields and typed delivery', () => {
  const unknown: Claim = { id:'withdrawals', criterion:'withdrawals', claimType:'unknown_disclosure', text:'', sourceIndexes:[] };
  it('derives unknown prose from locked fields and refuses hidden author promises or a narrowed scope', () => {
    const statement = renderClaimStatement(unknown, V6_CRITERIA);
    expect(statement).toContain('提现等待期、即时退出条件');
    expect(serializeClaim({ ...unknown, text:statement }, V6_CRITERIA)).toEqual({ criterion_id:'withdrawals', claim_type:'unknown_disclosure', disclosure_version:'scoped-unknown/1', scope:'all_committed_sources' });
    expect(() => serializeClaim({ ...unknown, text:'资料不足，但保证即时提现。' }, V6_CRITERIA)).toThrow('自由正文');
    expect(() => serializeClaim({ ...unknown, sourceIndexes:[0] }, V6_CRITERIA)).toThrow('自选来源');
    expect(() => serializeClaim({ ...unknown, scope:'only_selected' }, V6_CRITERIA)).toThrow('范围');
  });
  it('locks same-group registered questions even under strict delivery and permits custom criterion IDs', () => {
    const criteria = structuredClone(V6_CRITERIA);
    criteria[0].id = 'buyer_custom_id';
    expect(() => validateV6Criteria(criteria, CATALOG_VERSION)).not.toThrow();
    criteria[0].text += ' 另外保证安全。';
    expect(() => validateV6Criteria(criteria, CATALOG_VERSION)).toThrow('原文');
    const mixed = structuredClone(V6_CRITERIA);
    mixed[0].requested_field_ids!.push('audit_version');
    expect(() => validateV6Criteria(mixed, CATALOG_VERSION)).toThrow();
    const strict = structuredClone(V6_CRITERIA);
    strict[0].requested_field_ids = [];
    expect(() => validateV6Criteria(strict, CATALOG_VERSION)).toThrow();
  });
  it('fails closed when typed claims are supplied to a legacy order and accepts a correctly generated V6 body', async () => {
    const order = (await seedOrders())[0], input = await demoSubmission();
    input.claims = [unknown];
    expect(() => validateSubmission(input,order,false)).toThrow('旧政策');
    const typedOrder = { ...order, policyVersion:POLICY_V6, catalogVersion:CATALOG_VERSION, criteria:V6_CRITERIA };
    input.reportBody = structuredReportBody(input.claims,V6_CRITERIA);
    expect(() => validateSubmission(input,typedOrder,false)).not.toThrow();
  });
  it('evaluates submitted optional failures after required fulfillment and ignores only absent optionals', () => {
    const criteria = [{...V6_CRITERIA[0],id:'required'}, {...V6_CRITERIA[1],id:'optional',required:false}];
    const required = {claimId:'required',status:'SUPPORTED',deliveryStatus:'FULFILLED',reason:'',sourceIndexes:[]};
    const optional = {claimId:'optional',status:'MISSING',deliveryStatus:'INSUFFICIENT',reason:'',sourceIndexes:[]};
    expect(aggregateFindings([required,optional],criteria)).toBe('ACCEPTED');
    expect(aggregateFindings([required,{...optional,status:'CONTRADICTED',deliveryStatus:'CONTRADICTED'}],criteria)).toBe('REVISION_REQUIRED');
    expect(aggregateFindings([{...required,status:'CONTRADICTED'},optional],criteria)).toBe('NOT_ACCEPTED');
  });
});
describe('honest local walkthrough', () => {
  it('keeps unknown evidence unchanged while the locked delivery policy changes', async () => {
    const revision = { ...await demoSubmission(), number: 1 };
    revision.claims[1].text = '提现请求有7天等待期。';
    const allowed = await assessDemo(revision);
    const strict = await assessDemo(revision, CRITERIA);
    expect(allowed.items.find(i => i.claimId === 'audit')).toMatchObject({ status: 'SCOPED_UNKNOWN', deliveryStatus: 'FULFILLED' });
    expect(strict.items.find(i => i.claimId === 'audit')).toMatchObject({ status: 'SCOPED_UNKNOWN', deliveryStatus: 'INSUFFICIENT' });
    expect(allowed.verdict).toBe('ACCEPTED');
    expect(strict.verdict).toBe('INSUFFICIENT_EVIDENCE');
  });
  it('never lets unknown permission excuse contradiction or unavailable evidence', () => {
    for (const policy of ['fact_required', 'scoped_unknown_allowed'] as const) {
      expect(deliveryStatus('CONTRADICTED', policy)).toBe('CONTRADICTED');
      expect(deliveryStatus('SOURCE_UNAVAILABLE', policy)).toBe('INSUFFICIENT');
      expect(deliveryStatus('NOT_ESTABLISHED', policy)).toBe('INSUFFICIENT');
    }
  });
  it('flags the fictional withdrawal contradiction without inventing a transaction', async () => { const revision={...await demoSubmission(),number:1}; const result=await assessDemo(revision); expect(result.verdict).toBe('NOT_ACCEPTED'); expect(result.mode).toBe('demo'); expect(result.txHash).toBeUndefined(); });
  it('accepts the corrected fictional statement against the known fixture', async () => { const revision={...await demoSubmission(),number:2}; revision.claims[1].text='提现请求有7天等待期。'; expect((await assessDemo(revision)).verdict).toBe('ACCEPTED'); });
  it('fails closed for an arbitrary source with a copied digest', async () => { const revision={...await demoSubmission(),number:1}; revision.sources[0].url='https://evil.example/a'; expect((await assessDemo(revision)).verdict).toBe('INSUFFICIENT_EVIDENCE'); });
});
