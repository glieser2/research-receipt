import { V6_CRITERIA, renderClaimStatement, structuredReportBody, type Criterion, type Claim, type Revision } from './domain';
import { localizeChainText, type Language } from './i18n';

export function publicExampleSubmission(corrected = false, lang: Language = 'zh'): Omit<Revision, 'number' | 'assessment'> {
  const claims = [
    { id: 'permissions', criterion: 'permissions', text: corrected ? '仅讨论本次两份固定commit基类源码的默认、未重写实现：Ownable的transferOwnership与renounceOwnership声明都带onlyOwner，_checkOwner在owner()!=_msgSender()时回退；Context的默认_msgSender()返回msg.sender。这两份文件本身均未定义代码升级入口或升级管理员机制；本项只核查这些源文件中的默认权限检查与升级入口，不覆盖任意派生重写、代理或实际部署的权限。' : '仅讨论固定commit中默认、未重写的Ownable源码：transferOwnership与renounceOwnership的声明均没有onlyOwner修饰符，_checkOwner也不会比较owner()与_msgSender()。', sourceIndexes: corrected ? [0, 1] : [0] },
    { id: 'withdrawals', criterion: 'withdrawals', text: '本项只依据Ownable权限模块源码；该文件不提供具体协议的提现或赎回流程证据，因此提现等待期与能否即时退出均为未知，不作即时提现承诺。', sourceIndexes: [0] },
    { id: 'audit', criterion: 'audit', text: '本项材料为Ownable源码，不是审计报告；未提交审计报告，无法核查审计覆盖范围及版本，审计状态未知，不宣称任何部署已通过安全审计。', sourceIndexes: [0] },
    { id: 'limitations', criterion: 'limitations', text: '本报告只核查逐项引用的固定commit源码和上述陈述，不证明任何派生重写、实际部署状态、协议整体安全或未来收益。', sourceIndexes: [0] },
  ];
  const base = { reportTitle: corrected ? '默认未重写基类审查 · 修订稿' : '默认未重写基类审查 · 错误修饰符声明', reportUrl: '', reportBody: claims.map(c => c.text).join('\n'), sources: [
    { url: 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/3e6c86392c97fbc30d3d20a378a6f58beba08eba/contracts/access/Ownable.sol', sha256: '38578bd71c0a909840e67202db527cc6b4e6b437e0f39f0c909da32c1e30cb81', byteLength: 3102, publishedAt: '2023-10-05', label: 'Ownable · 默认基类源码' },
    { url: 'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/3e6c86392c97fbc30d3d20a378a6f58beba08eba/contracts/utils/Context.sol', sha256: '9c1cc43aa4a2bde5c7dea0d4830cd42c54813ff883e55c8d8f12e6189bf7f10a', byteLength: 860, publishedAt: '2023-10-05', label: 'Context · 默认调用者上下文' },
  ], claims };
  if (lang === 'en') {
    const enClaims = base.claims.map(c => ({ ...c, text: localizeChainText(c.text, 'en') }));
    return {
      ...base,
      reportTitle: localizeChainText(base.reportTitle, 'en'),
      reportBody: enClaims.map(c => c.text).join('\n'),
      sources: base.sources.map(s => ({ ...s, label: localizeChainText(s.label, 'en') })),
      claims: enClaims,
    };
  }
  return base;
}

export function publicV6ExampleSubmission(corrected = false, criteria: Criterion[] = V6_CRITERIA, lang: Language = 'zh'): Omit<Revision, 'number' | 'assessment'> {
  const legacy = publicExampleSubmission(corrected, lang);
  const claims: Claim[] = legacy.claims.filter(claim => criteria.some(criterion => criterion.id === claim.criterion)).map(claim => {
    const unknown = ['withdrawals','audit'].includes(claim.criterion);
    const typed: Claim = { ...claim, claimType: unknown ? 'unknown_disclosure' : claim.criterion === 'limitations' ? 'boundary_disclosure' : 'factual_assertion', sourceIndexes: unknown ? [] : claim.sourceIndexes };
    typed.text = renderClaimStatement(typed, criteria);
    return typed;
  });
  return { ...legacy, claims, reportBody: structuredReportBody(claims, criteria) };
}
