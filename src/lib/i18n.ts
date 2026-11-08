import {
  FIELD_CATALOG,
  deriveCriterionText,
  renderClaimStatement,
  type Assessment,
  type Claim,
  type Criterion,
  type Order,
  type Revision,
} from './domain';

export type Language = 'en' | 'zh';

export const LANGUAGE_STORAGE_KEY = 'rr:lang:v1';

// 读取当前语言设置，默认返回英文 ('en')
export function getLanguage(): Language {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(LANGUAGE_STORAGE_KEY) : null;
    return saved === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

// 切换并持久化语言设置，同时同步 html[lang] 属性
export function setLanguage(lang: Language): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    }
  } catch {
    // 忽略受限存储环境错误
  }
}

// 字段目录英文标签映射（仅在 UI 层本地化展示，保持链上 wire 数据不变）
export const FIELD_LABELS_EN: Record<string, string> = {
  default_ownable_controls: 'Default Ownable Authorization Checks',
  default_context_sender: 'Default Context Sender',
  default_upgrade_entry: 'Default Upgrade Entry',
  withdrawal_waiting_period: 'Withdrawal Waiting Period',
  instant_exit_conditions: 'Immediate Exit Conditions',
  audit_coverage: 'Audit Coverage Scope',
  audit_version: 'Audited Version / Commit',
};

export function getFieldLabel(fieldId: string, lang: Language): string {
  if (lang === 'en') {
    return FIELD_LABELS_EN[fieldId] ?? fieldId;
  }
  return FIELD_CATALOG.fields.find(field => field.id === fieldId)?.label ?? fieldId;
}

export const CRITERION_GROUP_LABELS: Record<Language, Record<string, string>> = {
  en: {
    permissions: 'Admin & Upgrade Permissions',
    withdrawals: 'Withdrawal Constraints',
    audit: 'Audit Coverage',
    limitations: 'Evidence Boundaries',
  },
  zh: {
    permissions: '管理与升级权限',
    withdrawals: '提现约束',
    audit: '审计覆盖',
    limitations: '证据限制',
  },
};

export function getCriterionGroupLabel(id: string, lang: Language): string {
  return CRITERION_GROUP_LABELS[lang][id] ?? id;
}

const STATUS_TEXT_I18N: Record<Language, Record<string, string>> = {
  en: {
    ACCEPTED: 'Accepted',
    REVISION_REQUIRED: 'Revision Required',
    NOT_ACCEPTED: 'Not Accepted',
    INSUFFICIENT_EVIDENCE: 'Insufficient Evidence',
    SUPPORTED: 'Supported (Legacy Policy)',
    BOUNDARY_DISCLOSED: 'Boundary Disclosed',
    SCOPED_UNKNOWN: 'Scoped Unknown',
    NOT_ESTABLISHED: 'Not Established by Evidence',
    MISSING: 'Missing in Submission',
    SOURCE_UNAVAILABLE: 'Source Unverifiable',
    FULFILLED: 'Delivery Fulfilled',
    INSUFFICIENT: 'Insufficient Delivery Evidence',
    CONTRADICTED: 'Contradicted',
    UNSUPPORTED: 'Unsupported',
    PENDING: 'Pending Evaluation',
  },
  zh: {
    ACCEPTED: '符合验收',
    REVISION_REQUIRED: '需要修订',
    NOT_ACCEPTED: '未通过',
    INSUFFICIENT_EVIDENCE: '证据不足',
    SUPPORTED: '旧版标准支持',
    BOUNDARY_DISCLOSED: '边界披露合格',
    SCOPED_UNKNOWN: '范围内未知',
    NOT_ESTABLISHED: '本项证据未满足',
    MISSING: '未提交此项',
    SOURCE_UNAVAILABLE: '来源不可核验',
    FULFILLED: '交付满足',
    INSUFFICIENT: '交付证据不足',
    CONTRADICTED: '存在冲突',
    UNSUPPORTED: '未支持',
    PENDING: '待验收',
  },
};

export function humanStatusI18n(value: string | undefined, lang: Language): string {
  if (!value) return STATUS_TEXT_I18N[lang].PENDING;
  return STATUS_TEXT_I18N[lang][value] || value;
}

export function findingLabelI18n(status: string | undefined, v6: boolean, lang: Language): string {
  if (!v6 && status === 'SUPPORTED') {
    return lang === 'en' ? 'Supported (Legacy Policy)' : '旧版标准支持';
  }
  if (v6 && status === 'SUPPORTED') {
    return lang === 'en' ? 'Materials Support Full Answer' : '材料支持完整答复';
  }
  if (v6 && status === 'BOUNDARY_DISCLOSED') {
    return lang === 'en' ? 'Boundary Disclosed' : '边界披露合格';
  }
  if (v6 && status === 'NOT_ESTABLISHED') {
    return lang === 'en' ? 'Not Established by Evidence' : '本项证据未满足';
  }
  return humanStatusI18n(status, lang);
}

export const SOURCE_CHECK_LABELS_I18N: Record<Language, Record<string, string>> = {
  en: {
    VERIFIED: 'Source bytes match locked digest',
    HASH_MISMATCH: 'Source digest or byte length mismatch',
    UNAVAILABLE: 'Source unavailable',
    TOO_LARGE: 'Source exceeds size limit',
    INVALID_ENCODING: 'Source is not valid UTF-8',
  },
  zh: {
    VERIFIED: '来源字节与锁定摘要一致',
    HASH_MISMATCH: '来源摘要或字节数不符',
    UNAVAILABLE: '来源不可用',
    TOO_LARGE: '来源超出大小上限',
    INVALID_ENCODING: '来源不是有效 UTF-8',
  },
};

// 链上及示例固定文本中英双向精确映射表（确保在英文模式下浏览链上真实订单、Studio 证据与演示订单不出现任何中文字符）
const ZH_TO_EN_EXACT: Record<string, string> = {
  // 标题与来源标签
  '默认基类源码审查 · Ownable + Context': 'Default Base Class Source Review · Ownable + Context',
  '默认基类源码审查 · Ownable + Context · 审计事实必须有据': 'Default Base Class Source Review · Ownable + Context · Audit Facts Required',
  '默认未重写基类审查 · 修订稿': 'Default Non-Overridden Base Class Review · Revised Draft',
  '默认未重写基类审查 · 错误修饰符声明': 'Default Non-Overridden Base Class Review · Incorrect Modifier Claim',
  'OpenZeppelin Ownable · 公开源文件研究验收': 'OpenZeppelin Ownable · Public Source File Research Acceptance',
  '证据完整性负例 · 摘要不匹配': 'Evidence Integrity Negative Case · Digest Mismatch',
  '浏览器端到端 · Ownable源码审查': 'Browser End-to-End · Ownable Source Code Review',
  'Northstar · 协议风险研究验收': 'Northstar · Protocol Risk Research Acceptance',
  'Northstar（虚构示例）': 'Northstar (Fictional Example)',
  'Ethereum · 示例': 'Ethereum · Example',
  'Northstar 风险研究 · 初稿': 'Northstar Risk Research · Initial Draft',
  'Northstar 虚构协议 · 本地内置证据': 'Northstar Fictional Protocol · Built-in Local Evidence',
  'Ownable · 默认基类源码': 'Ownable · Default Base Class Source',
  'Context · 默认调用者上下文': 'Context · Default Sender Context',
  '固定证据 1': 'Pinned Evidence 1',
  '固定证据 2': 'Pinned Evidence 2',
  '固定证据 3': 'Pinned Evidence 3',

  // 验收标准与字段前缀
  '请回答以下已锁定问题；材料不足时按锁定规则披露未知：':
    'Answer the following locked questions; if materials are insufficient, disclose unknowns under the locked rules:',
  '默认所有者权限检查：What owner-only authorization checks do the default Ownable transferOwnership and renounceOwnership functions define?':
    'Default Ownable Authorization Checks: What owner-only authorization checks do the default Ownable transferOwnership and renounceOwnership functions define?',
  '默认调用者地址：What value does the default Context._msgSender() implementation return?':
    'Default Context Sender: What value does the default Context._msgSender() implementation return?',
  '默认升级入口：Do these two default source files themselves define an upgrade entry or upgrade administrator? An established source-level absence is an answer; do not infer deployed or derived behavior.':
    'Default Upgrade Entry: Do these two default source files themselves define an upgrade entry or upgrade administrator? An established source-level absence is an answer; do not infer deployed or derived behavior.',
  '提现等待期：What waiting period applies to asset withdrawal/redemption in a concrete external protocol? Absence of withdrawal logic in these base files is not an answer about an external protocol.':
    'Withdrawal Waiting Period: What waiting period applies to asset withdrawal/redemption in a concrete external protocol? Absence of withdrawal logic in these base files is not an answer about an external protocol.',
  '即时退出条件：Under what conditions can users exit a concrete external protocol immediately? Absence of exit logic in these base files is not evidence that immediate exit is possible.':
    'Immediate Exit Conditions: Under what conditions can users exit a concrete external protocol immediately? Absence of exit logic in these base files is not evidence that immediate exit is possible.',
  '审计覆盖范围：What audit coverage is established for the reviewed code or protocol by these materials? Merely observing that no audit report was submitted is not an audit-coverage answer.':
    'Audit Coverage Scope: What audit coverage is established for the reviewed code or protocol by these materials? Merely observing that no audit report was submitted is not an audit-coverage answer.',
  '审计覆盖版本：What exact version/commit is established as covered by an audit? A source-file commit alone does not establish an audited version.':
    'Audited Version / Commit: What exact version/commit is established as covered by an audit? A source-file commit alone does not establish an audited version.',
  '明确研究只覆盖提交的固定commit源码；列出未覆盖的派生重写、代理和实际部署状态，不把本报告当作协议整体安全或未来收益保证。':
    'State clearly that the research covers only the submitted commit-pinned source files; list uncovered derived overrides, proxies, and actual deployed states, and do not treat this report as a guarantee of overall protocol security or future yield.',
  '说明管理员与升级权限，区分源文件所能支持的事实和部署状态；无证据的部分必须准确披露。':
    'Describe administrator and upgrade permissions, distinguishing facts supported by source files from deployment state; any aspects without evidence must be accurately disclosed.',
  '说明提现、赎回或退出限制，区分已核查事实与材料未覆盖的机制，不得作无证据承诺。':
    'Describe withdrawal, redemption, or exit restrictions, distinguishing verified facts from mechanisms not covered by the materials; make no unsupported promises.',
  '说明材料可支持的管理员与升级权限，材料未涉及的权限明确标为未知，区分源文件事实和真实部署状态。':
    'Describe administrator and upgrade permissions supported by the materials; mark unaddressed permissions as unknown and distinguish source-file facts from actual deployment state.',
  '说明材料可支持的提现、赎回或退出限制；材料未提供机制时明确未知，不得无证据承诺即时退出。':
    'Describe withdrawal, redemption, or exit restrictions supported by the materials; when no mechanism is provided, state unknown explicitly and never promise immediate exit without evidence.',
  '准确说明审计覆盖范围及版本，未获得审计证据必须承认未知。':
    'Accurately state audit coverage scope and version; if no audit evidence is available, explicitly acknowledge it as unknown.',
  '明确研究的证据边界，不把未发现问题表述为安全或收益保证。':
    'State the evidence boundary of the research clearly and do not present the absence of findings as a guarantee of security or yield.',

  // 链上真实订单陈述与未知披露模板
  '在本次提交并锁定的全部来源材料中，以下买方指定字段尚未建立答案：提现等待期、即时退出条件。这些字段仅在本次材料范围内记为未知；本披露不构成即时退出、安全或收益保证。':
    'Across all committed and locked source materials in this submission, answers to the following buyer-specified fields are not established: Withdrawal Waiting Period, Immediate Exit Conditions. These fields are recorded as unknown within the scope of the submitted materials only; this disclosure does not constitute an immediate-exit, security, or yield guarantee.',
  '在本次提交并锁定的全部来源材料中，以下买方指定字段尚未建立答案：审计覆盖范围、审计覆盖版本。这些字段仅在本次材料范围内记为未知；本披露不构成即时退出、安全或收益保证。':
    'Across all committed and locked source materials in this submission, answers to the following buyer-specified fields are not established: Audit Coverage Scope, Audited Version / Commit. These fields are recorded as unknown within the scope of the submitted materials only; this disclosure does not constitute an immediate-exit, security, or yield guarantee.',
  '在本次提交并锁定的全部来源材料中，以下买方指定字段尚未建立答案：默认调用者地址。这些字段仅在本次材料范围内记为未知；本披露不构成即时退出、安全或收益保证。':
    'Across all committed and locked source materials in this submission, answers to the following buyer-specified fields are not established: Default Context Sender. These fields are recorded as unknown within the scope of the submitted materials only; this disclosure does not constitute an immediate-exit, security, or yield guarantee.',
  '仅讨论固定commit中默认、未重写的Ownable源码：transferOwnership与renounceOwnership的声明均没有onlyOwner修饰符，_checkOwner也不会比较owner()与_msgSender()。':
    'Covering only the default, non-overridden Ownable source at the pinned commit: neither transferOwnership nor renounceOwnership is declared with the onlyOwner modifier, and _checkOwner does not compare owner() with _msgSender().',
  '仅讨论本次两份固定commit基类源码的默认、未重写实现：Ownable的transferOwnership与renounceOwnership声明都带onlyOwner，_checkOwner在owner()!=_msgSender()时回退；Context的默认_msgSender()返回msg.sender。这两份文件本身均未定义代码升级入口或升级管理员机制；本项只核查这些源文件中的默认权限检查与升级入口，不覆盖任意派生重写、代理或实际部署的权限。':
    "Covering only the default, non-overridden implementations in the two commit-pinned base source files: Ownable declares both transferOwnership and renounceOwnership with onlyOwner, and _checkOwner reverts when owner() != _msgSender(); Context's default _msgSender() returns msg.sender. Neither file defines an upgrade entry or upgrade administrator mechanism; this item verifies only default permission checks and upgrade entries in these source files, excluding any derived overrides, proxies, or deployed permissions.",
  '本报告只核查本次提交的固定commit版Ownable与Context默认基类源码及逐项陈述；不覆盖派生重写、代理或实际部署状态，也不把本报告当作协议整体安全或未来收益保证。':
    'This report verifies only the commit-pinned default Ownable and Context base source files submitted here and the itemized statements above; it does not cover derived overrides, proxies, or actual deployment states, nor does it constitute a guarantee of overall protocol security or future yield.',
  '在本次提交的材料范围内，某未提供源码或部署地址的外部协议的提现机制未知，因此该协议用户能够随时即时退出。':
    'Within the scope of the submitted materials, the withdrawal mechanism of an external protocol without provided source code or deployment address is unknown, so users of that protocol can exit immediately at any time.',
  '本报告有局限性。':
    'This report has limitations.',
  '本项只依据Ownable权限模块源码；该文件不提供具体协议的提现或赎回流程证据，因此提现等待期与能否即时退出均为未知，不作即时提现承诺。':
    'This item relies solely on the Ownable access-control source file, which provides no evidence of withdrawal or redemption flows for a concrete protocol; therefore both the withdrawal waiting period and immediate exit capability are unknown, with no promise of immediate withdrawal.',
  '本项材料为Ownable源码，不是审计报告；未提交审计报告，无法核查审计覆盖范围及版本，审计状态未知，不宣称任何部署已通过安全审计。':
    'The submitted material is the Ownable source file rather than an audit report; with no audit report submitted, audit coverage scope and version cannot be verified, audit status is unknown, and no deployment is claimed to have passed a security audit.',
  '本报告只核查逐项引用的固定commit源码和上述陈述，不证明任何派生重写、实际部署状态、协议整体安全或未来收益。':
    'This report verifies only the itemized commit-pinned source files and the statements above; it does not prove any derived overrides, actual deployment states, overall protocol security, or future yield.',

  // 链上真实订单验证原因 (Bradbury v6-wallet-4)
  '两份固定源码已直接给出：Ownable中transferOwnership与renounceOwnership均受onlyOwner限制，onlyOwner通过_checkOwner实现，若owner()!=_msgSender()则revert OwnableUnauthorizedAccount；Context默认_msgSender()返回msg.sender。两文件本身未定义升级入口或升级管理员机制。':
    'Both pinned source files directly establish that transferOwnership and renounceOwnership in Ownable are restricted by onlyOwner via _checkOwner (which reverts with OwnableUnauthorizedAccount if owner() != _msgSender()), and Context._msgSender() returns msg.sender by default. Neither file defines an upgrade entry or upgrade administrator mechanism.',
  '明确限定仅核查固定commit版Ownable与Context默认基类源码；同时明确不覆盖派生重写、代理和实际部署状态，并声明不构成协议整体安全或未来收益保证，覆盖了所需边界且无相反或夸大保证。':
    'Explicitly limits verification to the commit-pinned default Ownable and Context base source files, clearly excludes derived overrides, proxies, and actual deployment states, and states that it does not constitute a guarantee of overall protocol security or future yield—covering all required boundaries without contradictory or exaggerated assurances.',
  '声明明确限定仅核查本次提交的固定commit版Ownable与Context默认基类源码(来源URL均固定于commit 3e6c863…),逐项列出未覆盖的派生重写、代理和实际部署状态,并明确不作为协议整体安全或未来收益保证。完整覆盖标准要求的全部边界,无虚假覆盖或无依据承诺。':
    'The statement explicitly limits verification to the submitted commit-pinned default Ownable and Context base source files (pinned to commit 3e6c863...), lists uncovered derived overrides, proxies, and actual deployment states, and clearly states it is not a guarantee of overall protocol security or future yield—fully covering all required boundaries without false coverage or unsupported promises.',
  '仅给出“本报告有局限性”过于笼统，未明确覆盖要求中的固定commit源码范围，也未列出未覆盖的派生重写、代理和实际部署状态，更未明确不构成协议整体安全或未来收益保证。':
    "Merely stating 'This report has limitations' is overly generic and fails to specify the commit-pinned source scope, list uncovered derived overrides, proxies, and actual deployment states, or state that it does not constitute an overall protocol security or future yield guarantee.",

  // Studio 证据订单陈述与原因
  '这份Ownable源码的transferOwnership任何人都可调用，不要求调用者是owner。':
    'In this Ownable source code, transferOwnership can be called by anyone without requiring the caller to be the owner.',
  '本次只提交Ownable权限模块源码，没有协议提现或赎回流程证据，因此提现等待期与能否即时退出均为未知，不作即时提现承诺。':
    'Only the Ownable access-control source file was submitted here, with no evidence of protocol withdrawal or redemption flows; therefore both the withdrawal waiting period and immediate exit conditions are unknown, and no immediate-exit promise is made.',
  '本次材料不含审计报告，无法核查具体审计覆盖版本，审计状态未知，不宣称任何部署已通过安全审计。':
    'The submitted materials contain no audit report, so no specific audited version can be verified; audit status is unknown, and no deployment is claimed to have passed a security audit.',
  '本报告只核查指定commit文件及上述陈述，不证明某个实际部署状态、协议整体安全或未来收益。':
    'This report verifies only the commit-pinned source file and the statements above; it does not prove any actual deployment state, overall protocol security, or future yield.',
  '这份Ownable源码的transferOwnership受onlyOwner限制；renounceOwnership也只允许owner调用。它不能证明任意部署是否有升级权限。':
    'In this Ownable source code, transferOwnership is restricted by onlyOwner and renounceOwnership may only be called by the owner; it does not prove whether any given deployment has upgrade permissions.',

  // Demo 订单与模拟核验文本
  '管理员可升级合约，更改存在48小时延迟。':
    'The administrator can upgrade the contract, subject to a 48-hour delay.',
  '用户可随时即时提现，没有等待期。':
    'Users can withdraw immediately at any time with no waiting period.',
  '用户提交退出请求后需经历7天等待期，不可随时即时提现。':
    'Users must wait a 7-day waiting period after submitting an exit request and cannot withdraw immediately.',
  '未取得可核验的第三方审计报告，审计状态未知。':
    'No verifiable third-party audit report was obtained; audit status is unknown.',
  '本研究不证明部署安全，也不保证收益。':
    'This research does not prove deployment security and does not guarantee yield.',
  '未提交这项约定内容。':
    'This required criterion was not submitted.',
  '本地演练只识别内置虚构材料；其他来源需进入真实链上验收。':
    'Local demo mode only recognizes the built-in fictional material; external sources require live on-chain verification.',
  '内置示例规则与固定示例材料匹配；这是本地规则演练，未调用模型或共识。':
    'Matches built-in demo rules and fixed sample material; this is a local rule simulation without model or consensus calls.',
  '声明准确披露示例材料中审计证据未知；能否完成交付由锁定政策决定。这是本地规则演练。':
    'Accurately discloses that audit evidence is unknown in the sample material; whether this fulfills delivery is determined by the locked policy. This is a local rule simulation.',
  '示例材料规定7天等待期，与“即时提现、没有等待期”矛盾。':
    'The sample material specifies a 7-day waiting period, which contradicts "withdraw immediately with no waiting period".',
  '示例规则无法确认此表述。不会推定通过；真实语义判断需链上验证。':
    'Demo rules cannot confirm this statement. Acceptance is never presumed; real semantic evaluation requires on-chain verification.',
  '本地固定规则演练，未调用模型或共识；未提交此项声明。':
    'Local fixed-rule simulation without model or consensus calls; this claim was not submitted.',
  '本地演练只识别内置虚构材料，不能核验任意外部来源。':
    'Local demo mode only recognizes built-in fictional material and cannot verify arbitrary external sources.',
  '内置材料给出虚构协议的7天退出等待期，未建立默认 Ownable/Context 或审计覆盖字段答案。此结果仅是本地固定规则演练。':
    'Built-in material specifies a 7-day exit waiting period for the fictional protocol and does not establish default Ownable/Context or audit coverage fields. This result is a local fixed-rule simulation only.',
  '本地固定规则不判断新的事实标准是否充分；真实语义验收需经过链上模型与共识。':
    'Local fixed rules do not evaluate new factual assertions; real semantic acceptance requires on-chain models and consensus.',
  '内置边界示例与固定规则匹配；这是本地演练，未调用模型或共识。':
    'Built-in boundary disclosure matches fixed rules; this is a local simulation without model or consensus calls.',
};

const EN_TO_ZH_EXACT: Record<string, string> = Object.fromEntries(
  Object.entries(ZH_TO_EN_EXACT).map(([zh, en]) => [en, zh]),
);

// 将中文未知披露模板动态转换为英文展示
export function translateUnknownDisclosureLineToEn(line: string): string {
  const prefix = '在本次提交并锁定的全部来源材料中，以下买方指定字段尚未建立答案：';
  const suffix = '。这些字段仅在本次材料范围内记为未知；本披露不构成即时退出、安全或收益保证。';
  if (line.startsWith(prefix) && line.endsWith(suffix)) {
    const middle = line.slice(prefix.length, line.length - suffix.length);
    const zhLabels = middle.split('、').map(item => item.trim()).filter(Boolean);
    const enLabels = zhLabels.map(zhLabel => {
      for (const entry of FIELD_CATALOG.fields) {
        if (entry.label === zhLabel) return FIELD_LABELS_EN[entry.id] ?? entry.id;
      }
      return ZH_TO_EN_EXACT[zhLabel] ?? zhLabel;
    });
    return `Across all committed and locked source materials in this submission, answers to the following buyer-specified fields are not established: ${enLabels.join(', ')}. These fields are recorded as unknown within the scope of the submitted materials only; this disclosure does not constitute an immediate-exit, security, or yield guarantee.`;
  }
  return line;
}

// 将单行或多行链上/示例文本本地化为指定语言
export function localizeChainText(text: string, lang: Language): string {
  if (!text) return text;
  if (lang === 'zh') {
    if (EN_TO_ZH_EXACT[text]) return EN_TO_ZH_EXACT[text];
    return text
      .split('\n')
      .map(line => EN_TO_ZH_EXACT[line.trim()] ?? line)
      .join('\n');
  }

  // English mode ('en')
  if (ZH_TO_EN_EXACT[text]) return ZH_TO_EN_EXACT[text];
  const fixedEvidenceMatch = text.trim().match(/^固定证据\s+(\d+)$/);
  if (fixedEvidenceMatch) return `Pinned Evidence ${fixedEvidenceMatch[1]}`;
  const sourceIndexMatch = text.trim().match(/^来源\s+(\d+)$/);
  if (sourceIndexMatch) return `Source ${sourceIndexMatch[1]}`;

  const lines = text.split('\n').map(rawLine => {
    const trimmed = rawLine.trim();
    if (ZH_TO_EN_EXACT[trimmed]) return ZH_TO_EN_EXACT[trimmed];
    const translatedUnknown = translateUnknownDisclosureLineToEn(trimmed);
    if (translatedUnknown !== trimmed) return translatedUnknown;
    // 处理字段标签前缀行，例如 "默认所有者权限检查：What ..."
    for (const entry of FIELD_CATALOG.fields) {
      const prefix = `${entry.label}：`;
      if (trimmed.startsWith(prefix)) {
        return `${FIELD_LABELS_EN[entry.id] ?? entry.id}: ${trimmed.slice(prefix.length)}`;
      }
    }
    return rawLine;
  });

  let joined = lines.join('\n');
  // 替换混合语言验证原因中的中文片段（如 studio-e2e.json 中英文原因内嵌的中文引用）
  joined = joined
    .replace(/['"]提现等待期与能否即时退出均为未知，不作即时提现承诺['"]\s*\(([^)]+)\)/g, "'$1'")
    .replace(/提现等待期与能否即时退出均为未知，不作即时提现承诺/g, 'withdrawal waiting period and immediate exit conditions are unknown, with no promise of immediate withdrawal')
    .replace(/future收益/g, 'future yield');
  return joined;
}

// 本地化展示验收标准文本
export function displayCriterionText(criterion: Criterion, lang: Language): string {
  if (lang === 'zh') {
    if (criterion.requested_field_ids?.length) {
      return deriveCriterionText(criterion.requested_field_ids);
    }
    return localizeChainText(criterion.text, 'zh');
  }
  if (criterion.requested_field_ids?.length) {
    const canonical = deriveCriterionText(criterion.requested_field_ids);
    if (!criterion.text || criterion.text === canonical || criterion.text.startsWith('Answer the following locked questions')) {
      return [
        'Answer the following locked questions; if materials are insufficient, disclose unknowns under the locked rules:',
        ...criterion.requested_field_ids.map(id => {
          const item = FIELD_CATALOG.fields.find(field => field.id === id);
          return `${FIELD_LABELS_EN[id] ?? id}: ${item?.question ?? id}`;
        }),
      ].join('\n');
    }
  }
  return localizeChainText(criterion.text, 'en');
}

// 本地化展示单条 Claim 陈述
export function displayClaimText(
  claim: Claim,
  criteria: readonly Criterion[],
  lang: Language,
): string {
  const wireText = claim.claimType === 'unknown_disclosure' ? renderClaimStatement(claim, criteria) : claim.text;
  if (claim.claimType === 'unknown_disclosure') {
    return lang === 'en' ? translateUnknownDisclosureLineToEn(wireText) : wireText;
  }
  return localizeChainText(wireText, lang);
}

// 本地化展示完整报告正文
export function displayReportBody(
  claims: Claim[],
  criteria: readonly Criterion[],
  lang: Language,
): string {
  return criteria
    .flatMap(criterion =>
      claims
        .filter(claim => claim.criterion === criterion.id)
        .map(claim => displayClaimText(claim, criteria, lang).trim()),
    )
    .join('\n');
}

// 本地化展示完整的研究订单（用于 UI 层渲染，不改变底层签名/哈希数据）
export function localizeOrderForDisplay(order: Order, lang: Language): Order {
  const criteria = order.criteria?.map(criterion => ({
    ...criterion,
    text: displayCriterionText(criterion, lang),
  }));
  const revisions: Revision[] = order.revisions.map(rev => {
    const claims = rev.claims.map(claim => ({
      ...claim,
      text: displayClaimText(claim, order.criteria || [], lang),
    }));
    const sources = rev.sources.map(source => ({
      ...source,
      label: localizeChainText(source.label, lang),
    }));
    const assessment: Assessment | undefined = rev.assessment
      ? {
          ...rev.assessment,
          items: rev.assessment.items.map(item => ({
            ...item,
            reason: localizeChainText(item.reason, lang),
          })),
        }
      : undefined;
    return {
      ...rev,
      reportTitle: localizeChainText(rev.reportTitle, lang),
      reportBody: rev.reportBody ? localizeChainText(rev.reportBody, lang) : undefined,
      sources,
      claims,
      ...(assessment ? { assessment } : {}),
    };
  });
  return {
    ...order,
    title: localizeChainText(order.title, lang),
    protocol: localizeChainText(order.protocol, lang),
    chain: localizeChainText(order.chain, lang),
    ...(criteria ? { criteria } : {}),
    revisions,
  };
}

// 统一将底层服务/链上错误与提示信息本地化为当前语言（确保英文模式下不向用户展示任何中文报错或状态）
const ERROR_EXACT_ZH_TO_EN: Record<string, string> = {
  // domain.ts
  '未知披露不接受作者自选来源或自由正文。':
    'Unknown disclosure does not accept author-selected sources or free-form text.',
  '未知披露版本或范围不符。':
    'Unknown disclosure version or scope mismatch.',
  'V6 声明必须明确类型，事实与边界声明不能携带未知披露字段。':
    'V6 claims must specify a claim type, and factual or boundary claims cannot carry unknown disclosure fields.',
  '证据仅支持 raw.githubusercontent.com 的 HTTPS 原始文件链接。':
    'Evidence only supports HTTPS raw file links from raw.githubusercontent.com.',
  '请使用含 40 位完整 Git commit 的固定文件链接，不支持分支或标签。':
    'Please use a pinned file URL containing a full 40-character Git commit SHA; branches or tags are not supported.',
  '旧政策订单不能写入 V6 类型声明，请新建 V6 委托。':
    'Legacy policy orders cannot accept V6 typed claims; please create a new V6 order.',
  '正文必须是按锁定标准排列的交付条目汇总，不能包含未绑定的文字。':
    'Report body must be the summary of delivery items ordered by locked criteria and cannot contain unbound text.',
  '请填写不超过 160 字符的报告名称。':
    'Please enter a report title of at most 160 characters.',
  '每个版本需要 1–3 份来源。':
    'Each revision requires 1 to 3 sources.',
  '声明数量超过当前政策范围。':
    'Number of claims exceeds the current policy limit.',
  '验收条目重复或无效，每项仅支持一条声明。':
    'Duplicate or invalid acceptance criterion; only one claim is allowed per criterion.',
  '声明不能为空或超过 1200 UTF-8 字节。':
    'Claim statement cannot be empty or exceed 1,200 UTF-8 bytes.',
  '每条声明必须关联有效来源。':
    'Each claim must reference at least one valid source.',
  '来源需要 64 位 SHA-256 和 1–16384 字节的原始文件大小。':
    'Each source requires a 64-character SHA-256 digest and a raw file size between 1 and 16,384 bytes.',
  '来源域名未获委托授权。':
    'Source domain is not authorized by the order.',
  '来源仓库未获委托授权。':
    'Source repository is not authorized by the order.',

  // service.ts
  '本地演练记录格式损坏。请导出浏览器数据后重新建立演练记录。':
    'Local demo records are corrupted. Please export browser data and recreate demo records.',
  '当前模式或合约已改变。请从当前网络重新载入订单再操作。':
    'Current mode or contract has changed. Please reload the order from the current network before proceeding.',
  '合约返回格式不符，无法核验记录。':
    'Contract response format mismatch; unable to verify record.',
  '订单 ID 必须为正整数。':
    'Order ID must be a positive integer.',
  '未找到本地示例订单。':
    'Local demo order not found.',
  '合约订单结构与本应用不匹配。':
    'Contract order structure does not match this application.',
  '验收记录缺少已绑定的证据快照，不能视为通过。':
    'Assessment record is missing a bound evidence snapshot and cannot be treated as accepted.',
  '链上证据快照与当前订单、版本或材料承诺不一致，已停止读取。':
    'On-chain evidence snapshot does not match the current order, revision, or material commitments; reading stopped.',
  '请填写委托名称、协议、链及有效资料截止日期。':
    'Please fill in the order title, protocol, chain, and reference cut-off date.',
  '研究作者必须是有效的钱包地址。':
    'Research author must be a valid wallet address.',
  '首版链上来源仅允许 raw.githubusercontent.com 的固定 commit 文件。':
    'On-chain sources only allow commit-pinned files from raw.githubusercontent.com.',
  '请锁定至少一个可信仓库前缀，例如 raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/。':
    'Please lock at least one trusted repository prefix, e.g., raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/.',
  '交易已完成，但未读到订单 ID。请保留交易记录，勿重复创建。':
    'Transaction completed, but the order ID could not be read back. Please keep your transaction record and do not recreate.',
  '每个订单最多 5 个交付版本。':
    'Each order supports at most 5 delivery revisions.',
  '此委托已完成验收。新的研究范围需要新建委托。':
    'This order has already completed acceptance. Create a new order for a new research scope.',
  '请先完成上一版本的验收。':
    'Please complete the evaluation of the previous revision first.',
  '旧政策订单仅供读取；请在已核验的 V6 合约新建委托。':
    'Legacy policy orders are read-only; please create a new order on a verified V6 contract.',
  '报告正文超过 12000 UTF-8 字节。':
    'Report body exceeds 12,000 UTF-8 bytes.',
  '当前政策或锁定标准发生变化，请重新载入订单。':
    'Current policy or locked criteria changed; please reload the order.',
  '版本不存在，或此版本已完成验收。请查看已有回执。':
    'Revision does not exist or has already been evaluated. Please view the existing receipt.',
  '只能对当前提交版本执行操作，请重新读取订单。':
    'Operations can only be performed on the latest submitted revision; please reload the order.',
  '请先锁定此版本的链上证据快照，再单独发起评估。':
    'Please lock the on-chain evidence snapshot for this revision before initiating evaluation.',
  '已确认交易执行，但尚未读到验收记录。请按订单 ID 重新读取。':
    'Transaction execution confirmed, but the assessment record could not be read yet. Please reload by Order ID.',
  '旧政策订单仅供读取；锁定证据仅支持已核验的 V6 合约。':
    'Legacy policy orders are read-only; locking evidence is only supported on verified V6 contracts.',
  '只能锁定当前提交版本的证据，请重新读取订单。':
    'Evidence can only be locked for the latest submitted revision; please reload the order.',
  '此版本的证据快照已锁定，成功或失败结果都不能重新抓取。':
    'The evidence snapshot for this revision is already locked; neither successful nor failed fetches can be re-fetched.',
  '当前版本不是待验收提交状态，不能锁定证据。':
    'Current revision is not in a pending-evaluation submitted state; evidence cannot be locked.',
  '已确认交易执行，但尚未读到证据快照。请保留交易记录并重新读取，不要重复锁源。':
    'Transaction execution confirmed, but the evidence snapshot could not be read yet. Keep the transaction record and reload; do not lock sources again.',
  '未找到需要导出的版本。':
    'The revision to export was not found.',
  '记录来源未绑定，无法导出可信回执。请重新载入订单。':
    'Record origin is not bound; unable to export a trusted receipt. Please reload the order.',

  // live.ts & bradbury.ts
  '临时测试账户仅支持官方 Studio-dev，不支持主网或自定义网络。':
    'Temporary test accounts are only supported on official Studio-dev, not on mainnet or custom networks.',
  '开发网身份不匹配，已停止。':
    'Devnet chain identity mismatch; stopped.',
  '正在为独立临时账户领取官方 Studio 测试 GEN。':
    'Requesting official Studio test GEN for an isolated temporary account...',
  '开发水龙头暂不可用，请稍后重试或连接自己的测试钱包。':
    'Devnet faucet is temporarily unavailable; please retry later or connect your own test wallet.',
  '未确认测试余额，未启用临时账户。':
    'Test balance unconfirmed; temporary account was not enabled.',
  '临时开发账户已就绪。密钥仅在本页内存中，刷新后将丢失写入权限。':
    'Temporary dev account is ready. Keys exist only in page memory; write access will be lost on refresh.',
  '仅支持官方 Studionet、Studio-dev 或经过 Phase 2 验证的 Bradbury RPC。':
    'Only official Studionet, Studio-dev, or Phase 2 verified Bradbury RPC endpoints are supported.',
  '未检测到浏览器钱包。示例演练无需钱包；链上写入需安装并连接 EIP-1193 钱包。':
    'No browser wallet detected. Demo mode requires no wallet; on-chain writes require an EIP-1193 wallet.',
  '钱包未返回账户。':
    'Wallet did not return an account.',
  '请在接入设置填写已部署的 ResearchReceipt 合约地址。':
    'Please enter a deployed ResearchReceipt contract address in Connection Settings.',
  '钱包所连 Bradbury genesis 不匹配，可能仍为旧 Phase 1。请核对官方 Phase 2 RPC。':
    'Wallet Bradbury genesis hash mismatch (possibly legacy Phase 1). Please verify the official Phase 2 RPC.',
  '钱包当前账户已变化，未发送交易。请重新连接并核对账户。':
    'Active wallet account changed; transaction was not sent. Please reconnect and verify your account.',
  '本次发送结果尚未确认，不会再次请求钱包发送或签名。':
    'Previous send result is unconfirmed; will not request another wallet send or signature.',
  '缺少可核对的发送意图，未发送交易。':
    'Verifiable send intent is missing; transaction was not sent.',
  '钱包已返回 EVM 交易哈希，不会重复发送。请恢复追踪。':
    'Wallet already returned an EVM transaction hash; will not resend. Please resume tracking.',
  '钱包发送参数与已连接账户、共识入口合约或网络不一致。':
    'Wallet send parameters do not match the connected account, consensus entrypoint, or network.',
  '钱包发送金额格式无效。':
    'Invalid wallet transaction value format.',
  '钱包发送金额与已报价协议费用不一致或超出测试费用上限。':
    'Wallet transaction value does not match quoted protocol fees or exceeds the testnet fee cap.',
  '钱包发送载荷不是合法的 GenLayer addTransaction 调用。':
    'Wallet payload is not a valid GenLayer addTransaction call.',
  '钱包发送参数与已连接账户、目标合约或方法参数不一致。':
    'Wallet send parameters do not match the connected account, target contract, or method arguments.',
  'Bradbury 交易缺少显式 gas 上限，已阻止发送。':
    'Bradbury transaction is missing an explicit gas limit; send blocked.',
  'Bradbury 交易 gas 格式无效，已阻止发送。':
    'Invalid Bradbury transaction gas format; send blocked.',
  'Bradbury 交易气费估算异常或超出单笔上限（32,000,000 gas），已阻止发送。':
    'Bradbury gas estimate is abnormal or exceeds the per-transaction cap (32,000,000 gas); send blocked.',
  'Studio 已返回协议交易 ID，正在等待最终状态。请勿重复提交。':
    'Studio returned the protocol transaction ID; waiting for final status. Do not resubmit.',
  '钱包已返回 EVM 交易哈希，正在等待协议交易 ID。请勿重复提交。':
    'Wallet returned the EVM transaction hash; waiting for protocol transaction ID. Do not resubmit.',
  '请在钱包中切换到 Bradbury Phase 2（Chain ID 4221）后重试。':
    'Please switch to Bradbury Phase 2 (Chain ID 4221) in your wallet and retry.',
  '当前网络未找到此合约，请核对网络和合约地址。':
    'Contract not found on the current network; please verify the network and contract address.',
  '只读会话已结束，请重新读取以核验当前网络。':
    'Read-only session ended; please reload to verify the current network.',
  '合约缺少可核验的 V6 政策或字段目录；当前仅可读取。':
    'Contract is missing a verifiable V6 policy or field catalog; currently read-only.',
  '此合约政策不是本客户端支持的 V6；当前仅可读取。':
    'Contract policy is not V6 supported by this client; currently read-only.',
  '合约字段目录与客户端完整目录不一致；当前仅可读取。':
    'Contract field catalog does not match the client catalog; currently read-only.',
  'V6 接口匹配，但此网络与地址尚未绑定独立源码验证的发布记录；当前仅可读取。':
    'V6 interface matches, but this network and address are not bound to an independently source-verified release; currently read-only.',
  'V6 政策、完整字段目录及独立源码验证发布记录匹配。':
    'V6 policy, complete field catalog, and independently source-verified release record matched.',
  '本地演练不发送链上交易。':
    'Local demo mode does not send on-chain transactions.',
  '无法核验合约，当前仅可读取。':
    'Unable to verify contract; currently read-only.',
  '此交易未形成协议共识。已独立核对最新最终状态，确认对应操作未落盘，并归档终态证据。再次操作将创建新交易并重新支付测试网费用；应用不会自动重试。':
    'This transaction did not reach protocol consensus. Independent verification of the latest finalized state confirmed the operation was not applied, and terminal evidence was archived. Retrying will create a new transaction and pay testnet fees again; the app will not auto-retry.',
  '交易已提交。等待协议最终状态，请勿重复发起。':
    'Transaction submitted. Waiting for protocol finalization; do not resubmit.',
  '交易已确认取消，没有执行。可检查原因后重新发起。':
    'Transaction confirmed canceled and was not executed. Check the cause before retrying.',
  '等待最终状态超时，请恢复追踪此交易。':
    'Timed out waiting for finalized status; please resume tracking this transaction.',
  '追踪中断或结果尚未确认。请恢复追踪，不要重复提交。':
    'Tracking interrupted or result unconfirmed. Please resume tracking and do not resubmit.',
  '当前网络与合约没有待恢复交易。':
    'No pending transaction to resume for the current network and contract.',
  '发现冲突或不可读的待处理记录，已保留原记录并禁止重发。请先人工核对。':
    'Conflicting or unreadable pending record detected; original record retained and resending blocked. Please verify manually.',
  '恢复期间待处理记录发生冲突，已保留原记录，请人工核对。':
    'Pending record conflict detected during recovery; original record retained. Please verify manually.',
  '已确认此 EVM 交易回滚，未创建协议调用。原记录已归档，可检查原因后重新发起。':
    'Confirmed that this EVM transaction reverted without creating a protocol call. Original record archived; you may retry after checking the cause.',
  '发送结果尚未确认。EVM 哈希不等于协议交易 ID；请核对钱包、区块浏览器及协议事件，确认前禁止重发。':
    'Send result unconfirmed. An EVM hash is not a protocol transaction ID; check your wallet, block explorer, and protocol events, and do not resend before confirming.',
  '存在尚未确认的交易，请先恢复追踪。':
    'An unconfirmed transaction exists; please resume tracking first.',
  '旧政策订单仅供读取，不能发送新交易。':
    'Legacy policy orders are read-only and cannot send new transactions.',
  '此方法没有经过开发费用配置。':
    'This method does not have a configured fee profile.',
  '正在按开发费用配置与当前网络价格报价；未用预算将在最终结算后退还。':
    'Quoting fees using the fee profile and current network prices; unused budget is refunded after final settlement.',
  '请在钱包核对费用并签署此次测试网调用。':
    'Please review the fee in your wallet and sign this testnet call.',
  'RPC 未返回有效协议交易 ID。':
    'RPC did not return a valid protocol transaction ID.',
  '已取得 Studio 协议交易 ID，回执追踪中断。请恢复追踪，勿重复提交。':
    'Obtained Studio protocol transaction ID, but receipt tracking was interrupted. Please resume tracking and do not resubmit.',
  '发送或回执追踪中断，已保留不确定记录。交易可能已经广播，请勿重复提交。':
    'Send or receipt tracking interrupted; uncertain record retained. The transaction may have been broadcast—do not resubmit.',
  '已取得协议交易 ID，但待处理记录发生冲突。请保存此 ID 并人工核对，禁止重发。':
    'Obtained protocol transaction ID, but a pending record conflict occurred. Save this ID and verify manually; resending is blocked.',
  'Bradbury Phase 2 官方清单身份不匹配。':
    'Bradbury Phase 2 official manifest identity mismatch.',
  '无法读取 Bradbury 官方 Phase 2 清单，已停止接入。':
    'Unable to fetch the official Bradbury Phase 2 manifest; connection stopped.',
  'Bradbury genesis 不匹配，拒绝旧 Phase 1 或未知网络。':
    'Bradbury genesis mismatch; rejecting legacy Phase 1 or unknown network.',
  'Bradbury ConsensusData registry 不匹配。':
    'Bradbury ConsensusData registry mismatch.',
  'SDK 缺少 Bradbury 所需协议 ABI。':
    'SDK is missing required Bradbury protocol ABIs.',
  'EVM 回执尚未出现。':
    'EVM receipt has not appeared yet.',
  'EVM 回执与已记录的发送者、目标或区块证据不匹配。':
    'EVM receipt does not match the recorded sender, target, or block evidence.',
  'EVM 回执状态尚未确认。':
    'EVM receipt status is not confirmed yet.',
  '未找到唯一且匹配的协议交易事件。':
    'No unique matching protocol transaction event found.',
  '协议交易与已记录的账户、合约、方法或参数不匹配。':
    'Protocol transaction does not match the recorded account, contract, method, or arguments.',
  '费用报价需要已验证的 Bradbury Phase 2 客户端。':
    'Fee quoting requires a verified Bradbury Phase 2 client.',
  'Bradbury 活跃费用策略返回零价格。':
    'Active Bradbury fee policy returned a zero price.',

  // App.tsx 内置提示与状态文案
  '连接钱包后核验写入环境。': 'Connect wallet to verify write environment.',
  '正在核验写入环境。': 'Verifying write environment...',
  '请至少填写一个可核验来源域名。': 'Please enter at least one verifiable source domain.',
  '正在创建委托': 'Creating research order...',
  '写入环境尚未通过核验，或钱包未连接。': 'Write environment is not verified yet, or wallet is not connected.',
  '示例委托已保存在本机。接下来可以提交研究版本。': 'Demo order saved locally. You can now submit a research revision.',
  '委托已提交。请以链上最终状态为准。': 'Order submitted. Final on-chain state is authoritative.',
  '每项验收标准只能对应一条研究声明。': 'Each acceptance criterion can only have one corresponding research claim.',
  '当前环境或钱包无权提交。': 'Current environment or wallet is not authorized to submit.',
  '请为每条事实或边界声明至少选择一个来源。': 'Please select at least one source for each factual or boundary claim.',
  '证据来源必须使用公开 HTTPS 链接。': 'Evidence sources must use public HTTPS links.',
  '报告正文不能超过 12000 UTF-8 字节。': 'Report body cannot exceed 12,000 UTF-8 bytes.',
  '正在提交研究版本': 'Submitting research revision...',
  '示例研究版本已保存。': 'Demo research revision saved.',
  '研究版本已提交，请查看链上状态。': 'Research revision submitted; please check the on-chain status.',
  '正在运行本地规则': 'Running local demo rules...',
  '正在提交链上验收': 'Submitting on-chain evaluation...',
  '本地规则演练已完成，结果不代表链上共识。': 'Local rule simulation completed; results do not represent on-chain consensus.',
  '请核查交易和验收的最终状态。': 'Please check the final status of the transaction and evaluation.',
  '正在锁定链上来源快照': 'Locking on-chain source snapshot...',
  '来源快照已锁定。核对来源后，可单独提交本版报告评估。':
    'Source snapshot locked. After reviewing sources, you can submit this revision for evaluation.',
  '本版来源检查已固定，包含不可核验来源。可按当前证据评估后，真正更正证据再提交修订；当前版本不能重取来源。':
    'Source checks for this revision are fixed and include unverifiable sources. Evaluate against current evidence first, then correct the evidence in a new revision; sources cannot be re-fetched for the current revision.',
  '请输入有效的正整数委托编号。': 'Please enter a valid positive integer order ID.',
  '正在读取链上委托': 'Loading on-chain order...',
  '已读取委托；请核对来源与最终状态。': 'Order loaded; please verify the sources and finalized status.',
  '正在连接钱包': 'Connecting wallet...',
  '钱包已连接。请在钱包中确认后续操作。': 'Wallet connected. Please confirm subsequent actions in your wallet.',
  '正在创建开发网临时账户': 'Creating temporary devnet account...',
  '临时测试账户已就绪，仅用于 Studio-dev。刷新后会丢失该账户的写入权限。':
    'Temporary test account is ready (for Studio-dev only). Refreshing will lose write access for this account.',
  '已填入公开代码研究模板。它只评估固定源文件，不代表实际部署审计。':
    'Filled public source-code research template. It evaluates only commit-pinned source files and does not represent a deployment audit.',
  '已切换到示例演练。': 'Switched to Demo mode.',
  '链上接入配置已保存。': 'On-chain connection settings saved.',
  '正在读取公开固定来源': 'Fetching commit-pinned public source...',
  '无法读取该公开来源，请检查链接与网络。': 'Unable to fetch this public source; please check the URL and network.',
  '来源超过 16384 字节，无法用于首版验收。': 'Source exceeds 16,384 bytes and cannot be used for acceptance.',
  '来源为空，无法用于验收。': 'Source is empty and cannot be used for acceptance.',
  '已计算来源原始字节数与 SHA-256；请确认链接和内容。':
    'Calculated raw byte length and SHA-256 digest; please confirm the URL and content.',
  '正在恢复交易追踪': 'Resuming transaction tracking...',
  '交易追踪完成，请重新读取相关委托。': 'Transaction tracking finished; please reload the relevant order.',
  '已填入固定 OpenZeppelin 代码材料的研究样例；请确认委托已允许该仓库。':
    'Filled OpenZeppelin commit-pinned source research example; please confirm the order allows this repository.',
  '切换标准已清空原声明，请重新填写。': 'Switching criteria cleared the previous statement; please fill it in again.',
  '已替换原声明并清空自选来源；未知披露覆盖本次全部锁定来源。':
    'Replaced previous statement and cleared manual source selection; unknown disclosure covers all locked sources in this submission.',
  '已清空原声明，请填写实际内容并选择核查材料。':
    'Cleared previous statement; please enter the actual statement and select verification sources.',
};

export function localizeMessage(message: string | null | undefined, lang: Language): string {
  if (!message) return '';
  if (lang === 'zh') return message;
  const trimmed = message.trim();
  if (ERROR_EXACT_ZH_TO_EN[trimmed]) return ERROR_EXACT_ZH_TO_EN[trimmed];

  // 动态正则转换（确保英文模式下不残留中文错误或状态提示）
  let m: RegExpMatchArray | null;
  if ((m = trimmed.match(/^请在钱包中切换到正确测试网络（Chain ID (\d+)）后重试。$/))) {
    return `Please switch to the correct test network (Chain ID ${m[1]}) in your wallet and retry.`;
  }
  if ((m = trimmed.match(/^请在钱包中切换到\s+(.+?)（Chain ID (\d+)）后重试。应用不会自动添加未知网络。$/))) {
    return `Please switch to ${m[1]} (Chain ID ${m[2]}) in your wallet and retry. The app does not auto-add unknown networks.`;
  }
  if ((m = trimmed.match(/^此交易已最终结束但未形成共识。(.+?)已保留交易 ID，禁止自动重发；请恢复追踪或核对最终状态。$/))) {
    return `This transaction finalized without reaching consensus. ${localizeMessage(m[1], 'en')} Transaction ID retained and auto-resend blocked; please resume tracking or check finalized status.`;
  }
  if ((m = trimmed.match(/^交易已最终结束，但未形成可确认的协议共识（(.+?)）。不能视为执行成功或已确认回滚；已保留交易 ID，禁止自动重发。$/))) {
    return `Transaction finalized without verifiable protocol consensus (${m[1]}). Cannot treat as succeeded or confirmed reverted; transaction ID retained and auto-resend blocked.`;
  }
  if ((m = trimmed.match(/^交易未成功执行：(.+?)(?:。执行结果尚未确认，已保留交易 ID，禁止重发。)?$/))) {
    const retained = trimmed.includes('执行结果尚未确认');
    return `Transaction execution did not succeed: ${m[1]}${retained ? '. Execution result unconfirmed; transaction ID retained and resend blocked.' : ''}`;
  }
  if ((m = trimmed.match(/^已确认执行成功。订单 #(\d+)，请重新读取该订单查看记录。$/))) {
    return `Execution confirmed. Order #${m[1]}—please reload this order to view records.`;
  }
  if ((m = trimmed.match(/^已确认最终状态及执行成功。创建引用：(.+)。$/))) {
    return `Finalized status and execution confirmed. Creation reference: ${m[1] === '无' ? 'none' : m[1]}.`;
  }
  if ((m = trimmed.match(/^(.+?)\s+已保留 EVM 哈希及发送意图，请稍后恢复追踪，勿重复提交。$/))) {
    return `${localizeMessage(m[1], 'en')} Retained EVM hash and send intent; please resume tracking later and do not resubmit.`;
  }
  if ((m = trimmed.match(/^发送结果尚未确认，已保留记录并禁止重发。\s*(.+?)请人工核对后恢复协议追踪。$/))) {
    const mid = m[1].startsWith('EVM 哈希：')
      ? `EVM hash: ${m[1].slice('EVM 哈希：'.length).trim()}. `
      : 'Wallet did not return a trackable hash, though it may still have been broadcast. ';
    return `Send result unconfirmed; record retained and resend blocked. ${mid}Please verify manually before resuming protocol tracking.`;
  }
  if ((m = trimmed.match(/^待处理记录冲突，协议交易 ID：(.+)。原记录已保留，请人工核对。$/))) {
    return `Pending record conflict; protocol transaction ID: ${m[1]}. Original record retained; please verify manually.`;
  }
  if ((m = trimmed.match(/^Bradbury 清单地址缺失、重复或无效：(.+)$/))) {
    return `Bradbury manifest address missing, duplicate, or invalid: ${m[1]}`;
  }
  if ((m = trimmed.match(/^Bradbury 链上地址与官方清单不一致：(.+)$/))) {
    return `Bradbury on-chain address does not match official manifest: ${m[1]}`;
  }
  if ((m = trimmed.match(/^Bradbury 协议地址无合约代码：(.+)$/))) {
    return `Bradbury protocol address has no contract code: ${m[1]}`;
  }
  if ((m = trimmed.match(/^写入环境尚未通过核验：(.+)$/))) {
    return `Write environment not yet verified: ${localizeMessage(m[1], 'en')}`;
  }
  return localizeChainText(trimmed, 'en');
}

// 完整的 UI 字典（英文默认 en + 简体中文 zh）
export const UI_TEXT = {
  en: {
    pageTitle: 'ResearchReceipt · Verifiable Research Acceptance Workbench',
    sidebarCaption: 'WORKSPACE',
    navAriaLabel: 'Primary Navigation',
    navWorkspace: 'Workbench',
    navCreate: 'New Order',
    navRecords: 'Records',
    navSettings: 'Settings',
    sidebarCalloutTitle: 'Evidence before conclusions.',
    sidebarCalloutBody: 'Connect every critical judgment to an inspectable source.',
    breadcrumbRoot: 'Workspace',
    breadcrumbWorkspace: 'Research Workbench',
    breadcrumbCreate: 'New Order',
    breadcrumbRecords: 'Acceptance Records',
    breadcrumbSettings: 'Connection Settings',
    modeDemo: 'Demo Mode',
    modeLive: 'GenLayer On-Chain',
    btnDevAccountReady: 'Temp Account Ready',
    btnDevAccountCreate: 'Create Temp Test Account',
    btnConnectWallet: 'Connect Wallet',
    langSwitchLabel: 'EN / ZH',
    langSwitchTitle: 'Switch language to Simplified Chinese (ZH)',
    avatarAriaLabel: 'Visitor',
    bannerDevSession: 'Studio-dev temporary account is for testing only; write access is lost on refresh. Do not store real assets.',
    bannerCompatWritable: 'Write environment verified.',
    bannerCompatReadOnly: (reason: string) => `Read-only mode: ${reason}`,
    envBradburyLabel: 'Bradbury Public Testnet',
    envStudioLabel: 'GenLayer Studio Managed Devnet',
    chainProofSuffix: 'Finalized State Readback',
    chainProofOrder: (id: number) => `Order #${id}`,
    btnCloseAlert: 'Dismiss alert',
    bannerLoadingOrders: 'Reading contract finalized state and public research records...',
    txHashPrefix: 'Tx ',
    btnCloseTxBanner: 'Dismiss transaction status',
    pendingTxWithHash: (shortHash: string) => `Pending transaction ${shortHash} awaiting confirmation. `,
    pendingTxUncertain: 'Transaction broadcast status is uncertain. ',
    pendingTxWarning: 'Please check your wallet history and resume tracking; do not resubmit.',
    btnResumeTracking: 'Resume Tracking',
    heroTitleLine1: 'Make Every Research Delivery',
    heroTitleEm: 'Verifiable by Evidence.',
    heroSubtitle: 'From research order to delivery acceptance—clearly linking facts, sources, and conclusions.',
    btnHeroCreate: 'New Research Order',
    envBannerDemoTitle: 'You are in Demo Mode',
    envBannerDemoBody: 'Data shown below is sample or browser-local; local rule simulations do not represent on-chain consensus.',
    envBannerBradburyBody: 'Connected to Bradbury Public Testnet. Verify the contract address, finalized protocol state, and block evidence.',
    envBannerStudioBody: 'Connected to GenLayer Studio dev environment; records come from finalized contract state. Public Bradbury deployment is verified separately.',
    btnEnvConfigLive: 'Configure On-Chain Access',
    btnEnvViewSettings: 'View Connection Settings',
    statOrdersLabel: 'Research Orders',
    statOrdersNoteDemo: 'Local samples & drafts',
    statOrdersNoteLive: 'Orders loaded in session',
    statRevisionsLabel: 'Submitted Revisions',
    statRevisionsNote: 'Traceable research deliveries',
    statAssessedLabel: 'Evaluated Orders',
    statAssessedNoteDemo: 'Local rule simulation results',
    statAssessedNoteLive: 'Currently loaded verdicts',
    sectionHeadingTitle: 'Research Workbench',
    sectionHeadingSub: 'Manage Orders & Deliveries',
    lookupAriaLabel: 'On-Chain Order ID',
    lookupPlaceholder: 'Enter On-Chain Order ID',
    lookupButton: 'Load',
    btnViewAllRecords: 'View All Records',
    emptyOrdersTitleDemo: 'No Research Orders Yet',
    emptyOrdersTitleLive: 'Load an On-Chain Order',
    emptyOrdersBodyDemo: 'Create an order to start organizing research criteria and evidence.',
    emptyOrdersBodyLive: 'Enter an order ID to read contract records, or create a new research order.',
    btnEmptyCreate: 'New Order',
    listHeaderLabel: 'Order List',
    orderWaitingSubmission: 'Awaiting Submission',
    btnAddOrderCard: 'Create a New Research Order',
    listNoteLine1: 'Research acceptance checks criteria against evidence;',
    listNoteLine2: 'it is not investment advice or a security guarantee.',
    detailOverlineLabel: 'Research Order',
    detailAsOfPrefix: 'Reference Date (Self-Reported) ',
    btnExportReceiptAria: 'Export Acceptance Receipt',
    tabsAriaLabel: 'Order Details',
    tabOverview: 'Overview',
    tabClaims: 'Research Claims',
    tabSources: 'Evidence Sources',
    tabHistory: 'Revision History',
    policyReviewSummary: 'View Buyer-Locked Acceptance Criteria',
    policyBoundaryReview: 'Delivery Policy: Boundary Disclosure',
    policyScopedUnknownAllowed: 'Delivery Policy: Accurate Scoped Unknown Allowed',
    policyFactRequired: 'Delivery Policy: Full Evidence-Backed Answer Required',
    policyLegacy: 'Legacy Revision: Unknown policy interpreted under legacy rules',
    policyReviewFoot: 'Acceptance evaluates only these criteria and does not certify overall protocol security.',
    versionLineLabel: 'Current Research Revision',
    versionSelectAria: 'Select Research Revision',
    versionOptionPrefix: (num: string, title: string) => `Revision ${num} · ${title}`,
    versionOptionNone: 'No Revisions Submitted',
    btnPrepareRevisionAcceptedTitle: 'Order already accepted; create a new order for new research',
    btnPrepareRevisionLegacyTitle: 'Legacy policy orders are read-only',
    btnPrepareRevisionDefaultTitle: 'Prepare a new research delivery revision',
    btnSubmitRevisionDemo: 'Submit Revision',
    btnPrepareRevisionLive: 'Prepare Research Revision',
    emptyRevisionTitle: 'Awaiting Research Delivery',
    emptyRevisionBody: 'Submit a research report, claims, and public evidence to begin acceptance verification.',
    overviewCalloutLabel: 'Current Delivery',
    overviewCalloutBody: 'Review key research claims and connect every judgment to committed evidence sources.',
    btnOpenReportAria: 'Open Research Report',
    metricClaimsLabel: 'Research Claims',
    metricClaimsSub: 'Statements to verify',
    metricSourcesLabel: 'Evidence Sources',
    metricSourcesSub: 'Public materials',
    metricResultLabel: 'Current Verdict',
    metricResultSubDemo: 'Local rule simulation',
    metricResultSubLive: 'On-chain verdict',
    metricResultSubPending: 'Not evaluated yet',
    subheadPreviewTitle: 'Research Claims Preview',
    btnViewAllClaims: 'View All',
    subheadClaimsTitle: 'Verify Research Claims Item by Item',
    subheadClaimsBody: 'Claims, locked criteria, and linked evidence jointly determine the acceptance verdict.',
    emptyClaimsTitle: 'No Claims Yet',
    emptyClaimsBody: 'This revision has not provided any claims to verify.',
    subheadSourcesTitle: 'Public Evidence Sources',
    subheadSourcesBody:
      'Digests verify material consistency only; they do not prove publisher identity, live deployment, timeliness, or investment value.',
    snapshotAllVerified: 'Source Snapshot Locked',
    snapshotHasUnverified: 'Source Check Fixed (Contains Unverifiable Sources)',
    snapshotHashPrefix: 'Snapshot SHA-256 · ',
    snapshotFootNote:
      'Each delivery revision fetches sources only once; temporary unavailability is also recorded. Evaluation uses this snapshot without re-fetching external links. If a source fails, record the actual result first, then submit a new revision with corrected evidence.',
    sourceFallbackLabel: (idx: number) => `Source ${idx}`,
    btnOpenSourceAria: (label: string) => `Open ${label || 'Evidence Source'}`,
    sourceAsOfPrefix: 'Reference Date (Self-Reported) ',
    actualShaPrefix: 'Actual SHA-256 · ',
    subheadHistoryTitle: 'Delivery Revision History',
    subheadHistoryBody: 'Retains every submission and its corresponding acceptance verdict.',
    historyItemMeta: (claimsCount: number, sourcesCount: number) =>
      `${claimsCount} Claim${claimsCount === 1 ? '' : 's'} · ${sourcesCount} Source${sourcesCount === 1 ? '' : 's'}`,
    footerStatusEvaluatedDemo: 'Local simulation result, not on-chain consensus',
    footerStatusEvaluatedLive: 'Finalized on-chain execution result is authoritative',
    footerStatusNeedsEvidence: 'Lock public sources first, then evaluate the report separately; sources are fetched once per revision',
    footerStatusSnapshotReady: 'Evaluate the locked sources and claims for this revision',
    footerStatusReady: 'Run acceptance evaluation when ready',
    btnExportReceipt: 'Export Receipt',
    btnActionEvaluated: 'Revision Evaluated',
    btnActionRunDemo: 'Run Demo Acceptance',
    btnActionLockSnapshot: 'Lock Source Snapshot',
    btnActionEvaluateLocked: 'Evaluate Locked Report',
    btnActionSubmitLiveEval: 'Submit On-Chain Evaluation',
    createPageTitle: 'New Research Order',
    createPageSubtitle: 'Define the research target, evidence scope, and author upfront so acceptance is grounded from the start.',
    btnFillPublicTemplate: 'Fill Public Code Research Template',
    createStepTitle: 'Order Basics',
    createStepSub: 'Specify clear, verifiable research boundaries.',
    chipDemoOrder: 'Demo Mode',
    chipLiveOrder: 'On-Chain Order',
    fieldPolicyScopeLabel: 'Research Scope & Acceptance Rules',
    fieldPolicyScopeAria: 'Research Scope',
    optionScopeProtocol: 'Protocol Risk Research · Core facts require evidence',
    optionScopeSource: 'Pinned Source Research · Explicitly disclose uncovered mechanisms',
    fieldCriterionTypeLabel: 'Criterion Type',
    fieldCriterionTypeAriaSuffix: ' Criterion Type',
    optionCriterionFixed: 'Locked Source Questions',
    optionCriterionCustom: 'Custom Factual Criterion',
    fieldCustomQuestionLabel: 'Factual Question Requiring Evidence',
    fieldCustomQuestionPlaceholder: 'Specify the exact factual question and scope that materials must support',
    fieldCustomQuestionHint: 'Only evidence-backed factual answers are accepted; unknown disclosures cannot fulfill this item.',
    summaryViewLockedQuestion: 'View Locked Questions',
    boundaryCriterionDesc: 'Disclose the evidence boundary of this research without making security or yield guarantees.',
    summaryViewDisclosureReq: 'View Disclosure Requirements',
    checkboxAllowUnknown:
      'Allow accurate disclosure of unknowns within the submitted material scope to fulfill delivery; contradictions or invalid sources are rejected',
    policyLockNotice: 'Criteria are locked upon creation. Allowing unknown disclosure does not mean unknown facts are proven.',
    policyLockSubNotice: 'Acceptance covers only the agreed scope and does not constitute a full protocol security audit.',
    fieldOrderTitleLabel: 'Order Title',
    fieldOrderTitlePlaceholder: 'e.g., DeFi Protocol Risk Research',
    fieldOrderTitleHint: 'Give this research order a clear, recognizable title.',
    fieldProtocolLabel: 'Research Target',
    fieldProtocolPlaceholder: 'e.g., Aave V3',
    fieldChainLabel: 'Target Network',
    fieldChainPlaceholder: 'e.g., Ethereum',
    fieldAsOfLabel: 'Reference Date (Self-Reported)',
    fieldAsOfHint: 'Entered by the buyer; does not automatically prove when materials were published.',
    fieldAuthorLabel: 'Research Author',
    fieldAuthorPlaceholderLive: '0x… Author wallet address',
    fieldAuthorHint: 'Live mode requires a valid author wallet address.',
    fieldHostsLabel: 'Allowed Evidence Source Domains',
    fieldHostsPlaceholder: 'e.g.:\ndocs.aave.com\ngithub.com',
    fieldHostsHint: 'On-chain sources are restricted to raw.githubusercontent.com. Enforced by the contract upon creation.',
    fieldRootsLabel: 'Trusted Repository Prefixes (Required On-Chain)',
    fieldRootsHint: 'One repository prefix per line; only pre-authorized sources can be used for acceptance.',
    createFootDemo: 'Demo orders are saved locally in your browser and do not send on-chain transactions.',
    createFootLive: 'Creating an order requires a wallet signature; please review the specification carefully.',
    btnCancel: 'Cancel',
    btnSubmitCreateOrder: 'Create Order',
    recordsPageTitle: 'Acceptance Records',
    recordsPageSubtitle: 'Inspect all loaded research orders, revisions, and acceptance verdicts in one place.',
    recordsCardTitle: 'All Research Orders',
    recordsCountLabel: (count: number) => `${count} Order${count === 1 ? '' : 's'}`,
    recordsColOrder: 'Order',
    recordsColTarget: 'Research Target',
    recordsColDate: 'Reference Date (Self-Reported)',
    recordsColVerdict: 'Current Verdict',
    recordsRevisionsCount: (count: number) => `${count} Revision${count === 1 ? '' : 's'}`,
    emptyRecordsTitle: 'No Records Yet',
    emptyRecordsBodyDemo: 'Research records will appear here after you create an order.',
    emptyRecordsBodyLive: 'Please return to the Workbench to load on-chain orders first.',
    settingsPageTitle: 'Connection Settings',
    settingsPageSubtitle: 'Choose your experience mode and configure your GenLayer contract connection.',
    settingsCardTitle: 'Operating Mode',
    settingsCardSub: 'Demo simulation results and live on-chain states are strictly separated.',
    btnUseVerifiedBradbury: 'Use Verified Bradbury Configuration',
    modeOptionDemoTitle: 'Demo Mode',
    modeOptionDemoDesc: 'No wallet required; experience the workflow locally with sample data.',
    modeOptionLiveTitle: 'GenLayer On-Chain',
    modeOptionLiveDesc: 'Read and submit research records using a deployed intelligent contract.',
    fieldRpcLabel: 'GenLayer Node RPC',
    fieldRpcHint: 'Use the RPC endpoint matching your deployment network.',
    fieldContractLabel: 'ResearchReceipt Contract Address',
    fieldContractHint: 'Use your deployed ResearchReceipt v6 contract address.',
    settingsFootNote: 'Connection settings are saved in your current browser.',
    btnSaveSettings: 'Save Settings',
    modalHeaderTitle: 'Submit Research Revision',
    modalHeaderSub: 'Provide publicly verifiable evidence and itemized research claims.',
    btnCloseModalAria: 'Close',
    modalIntroWarning: 'Do not submit private keys, personal account data, or materials that cannot be publicly verified.',
    btnFillDemoSample: 'Fill Sample',
    btnFillPublicSample: 'Fill Public Code Sample',
    draftNotePrefix: 'Drafts are kept only on the current page; closing the modal or refreshing will discard them without sending to the chain.',
    submitBlockNoWallet: 'Please connect the research author wallet before submitting.',
    submitBlockNotWritable: (reason: string) => `Write environment not yet verified: ${reason}`,
    submitBlockWrongAuthor: 'Connected wallet is not the designated research author for this order.',
    modalSec01Title: 'Research Report',
    modalSec01Sub: 'Provide the pinned version for this delivery.',
    fieldReportTitleLabel: 'Report Title',
    fieldReportTitlePlaceholder: 'Report Title',
    fieldReportUrlLabel: 'Reference Report URL (Optional)',
    fieldReportBodyLabel: 'Report Body',
    fieldReportBodyPlaceholder: 'Fill in the delivery items below; the report body is automatically assembled according to the locked criteria.',
    fieldReportBodyHint:
      'Automatically assembled from the delivery items below; acceptance covers only this structured report (up to 12,000 UTF-8 bytes). The reference URL is not used as acceptance evidence.',
    modalSec02Title: 'Evidence Sources',
    modalSec02Sub: 'On-chain mode supports only commit-pinned GitHub raw files (1–16,384 bytes).',
    btnAddSource: 'Add Source (Up to 3)',
    sourceCardHeader: (num: string) => `Source ${num}`,
    btnRemove: 'Remove',
    fieldSourceLabel: 'Source Label',
    fieldSourceLabelPlaceholder: 'e.g., Official Documentation',
    fieldSourceDate: 'Reference Date (Self-Reported)',
    fieldSourceUrl: 'Public HTTPS URL',
    fieldSourceUrlPlaceholder: 'https://raw.githubusercontent.com/owner/repo/full-commit-sha/path',
    btnHashSource: 'Fetch Source & Compute SHA-256 / Byte Length',
    fieldSourceShaPlaceholder: '64-character hex SHA-256 digest',
    fieldSourceBytes: 'File Byte Length',
    fieldSourceBytesPlaceholder: 'e.g., 2048',
    modalSec03Title: 'Research Claims',
    modalSec03Sub: 'Write the factual statements and disclosures to be verified against the criteria.',
    btnAddClaim: 'Add Claim',
    claimCardHeader: (num: string) => `Claim ${num}`,
    fieldCriterionSelect: 'Acceptance Criterion',
    fieldDeliveryType: 'Delivery Type',
    optionClaimUnknown: 'Scoped Unknown in Materials',
    optionClaimBoundary: 'Boundary Disclosure',
    optionClaimFact: 'Factual Answer',
    fieldClaimText: 'Claim Statement',
    fieldClaimTextPlaceholder: 'Write the statement to be verified for this delivery',
    claimUnknownHint:
      'Generated automatically from the locked questions and covers all sources in this submission; verification results determine whether delivery is fulfilled.',
    claimUnknownScopeLabel: 'Verification Scope: All Locked Sources in Submission',
    fieldClaimSourcesLabel: 'Verification Material Scope',
    claimRowPendingScope: 'Pending Verification Scope',
    claimRowVerifiedScope: 'Verification Scope',
    claimRowAllLockedSources: 'All Locked Sources',
    claimRowAuthorSelectedScope: 'Author-Selected Material Scope',
    fieldCheckFound: 'Answer Found in Materials',
    fieldCheckNotEstablished: 'Answer Not Established',
    findingTitleTooltip: 'Consensus verifies structured conclusions; model explanation wording may vary.',
    findingBadgeDemo: 'Local Rule Note',
    findingBadgeSourceOrDelivery: 'Source / Delivery Check Note',
    findingBadgeModel: 'Model Explanation (exact wording may vary)',
  },
  zh: {
    pageTitle: 'ResearchReceipt · 可验证加密研究验收台',
    sidebarCaption: '工作空间',
    navAriaLabel: '主导航',
    navWorkspace: '工作台',
    navCreate: '新建委托',
    navRecords: '验收记录',
    navSettings: '接入设置',
    sidebarCalloutTitle: '证据，先于结论。',
    sidebarCalloutBody: '把每一条重要判断，连接到可检查的来源。',
    breadcrumbRoot: '工作空间',
    breadcrumbWorkspace: '研究工作台',
    breadcrumbCreate: '新建委托',
    breadcrumbRecords: '验收记录',
    breadcrumbSettings: '接入设置',
    modeDemo: '示例演练',
    modeLive: 'GenLayer 链上',
    btnDevAccountReady: '临时账户已就绪',
    btnDevAccountCreate: '创建临时测试账户',
    btnConnectWallet: '连接钱包',
    langSwitchLabel: '中文 / EN',
    langSwitchTitle: '切换语言至英文 (Switch to English)',
    avatarAriaLabel: '访客',
    bannerDevSession: 'Studio-dev 临时账户仅供测试；刷新后会丢失写入权限，请勿存放真实资产。',
    bannerCompatWritable: '写入环境已核验。',
    bannerCompatReadOnly: (reason: string) => `当前只读：${reason}`,
    envBradburyLabel: 'Bradbury 公开测试链',
    envStudioLabel: 'GenLayer Studio 托管开发环境',
    chainProofSuffix: '最终状态读取',
    chainProofOrder: (id: number) => `委托 #${id}`,
    btnCloseAlert: '关闭提示',
    bannerLoadingOrders: '正在读取合约最终状态与公开研究记录…',
    txHashPrefix: '交易 ',
    btnCloseTxBanner: '关闭交易状态',
    pendingTxWithHash: (shortHash: string) => `存在待确认交易 ${shortHash}。`,
    pendingTxUncertain: '交易发送结果尚不确定。',
    pendingTxWarning: '请核对钱包记录并恢复追踪，不要重复提交。',
    btnResumeTracking: '恢复追踪',
    heroTitleLine1: '让每一份研究，',
    heroTitleEm: '都有据可验。',
    heroSubtitle: '从研究委托到交付验收，让事实、来源与判断清晰相连。',
    btnHeroCreate: '新建研究委托',
    envBannerDemoTitle: '你正在体验示例演练',
    envBannerDemoBody: '以下为示例或保存在本机的数据；本地规则结果不代表链上共识。',
    envBannerBradburyBody: '当前连接 Bradbury 公开测试链。请核对合约地址、协议最终状态与实际区块证据。',
    envBannerStudioBody: '当前连接 GenLayer Studio 开发环境；记录来自合约最终状态。公开 Bradbury 测试链部署将单独验证。',
    btnEnvConfigLive: '配置链上接入',
    btnEnvViewSettings: '查看接入设置',
    statOrdersLabel: '研究委托',
    statOrdersNoteDemo: '本机示例与草稿',
    statOrdersNoteLive: '本次加载的委托',
    statRevisionsLabel: '已提交版本',
    statRevisionsNote: '可追溯的研究交付',
    statAssessedLabel: '已有验收结果',
    statAssessedNoteDemo: '本地规则演练结果',
    statAssessedNoteLive: '当前加载的结果',
    sectionHeadingTitle: '研究工作台',
    sectionHeadingSub: '管理委托与交付',
    lookupAriaLabel: '链上委托编号',
    lookupPlaceholder: '输入链上委托编号',
    lookupButton: '读取',
    btnViewAllRecords: '查看全部记录',
    emptyOrdersTitleDemo: '还没有研究委托',
    emptyOrdersTitleLive: '读取一份链上委托',
    emptyOrdersBodyDemo: '创建一份委托，开始整理研究要求与证据。',
    emptyOrdersBodyLive: '输入委托编号读取合约记录，或创建新的研究委托。',
    btnEmptyCreate: '新建委托',
    listHeaderLabel: '委托列表',
    orderWaitingSubmission: '等待提交',
    btnAddOrderCard: '新建一份研究委托',
    listNoteLine1: '研究验收核对约定与证据，',
    listNoteLine2: '不构成投资建议或安全保证。',
    detailOverlineLabel: '研究委托',
    detailAsOfPrefix: '委托参考日期（自述）',
    btnExportReceiptAria: '导出验收回执',
    tabsAriaLabel: '委托详情',
    tabOverview: '概览',
    tabClaims: '研究声明',
    tabSources: '证据来源',
    tabHistory: '版本记录',
    policyReviewSummary: '查看委托人锁定的验收标准',
    policyBoundaryReview: '交付政策：边界披露',
    policyScopedUnknownAllowed: '交付政策：允许准确的范围内未知披露',
    policyFactRequired: '交付政策：需要材料支持完整答复',
    policyLegacy: '历史版本：未知政策由旧版规则解释',
    policyReviewFoot: '仅按这些标准验收交付，不认证协议整体安全。',
    versionLineLabel: '当前研究版本',
    versionSelectAria: '选择研究版本',
    versionOptionPrefix: (num: string, title: string) => `版本 ${num} · ${title}`,
    versionOptionNone: '尚未提交版本',
    btnPrepareRevisionAcceptedTitle: '委托已完成验收；新研究需创建新委托',
    btnPrepareRevisionLegacyTitle: '历史政策订单仅供读取',
    btnPrepareRevisionDefaultTitle: '准备新的研究交付版本',
    btnSubmitRevisionDemo: '提交版本',
    btnPrepareRevisionLive: '准备研究版本',
    emptyRevisionTitle: '等待研究交付',
    emptyRevisionBody: '提交研究报告、声明与公开证据后，即可开始验收。',
    overviewCalloutLabel: '本次交付',
    overviewCalloutBody: '核对关键研究声明，并将每一项判断连接到约定的证据来源。',
    btnOpenReportAria: '打开研究报告',
    metricClaimsLabel: '研究声明',
    metricClaimsSub: '条待核查的内容',
    metricSourcesLabel: '证据来源',
    metricSourcesSub: '个公开资料',
    metricResultLabel: '当前结果',
    metricResultSubDemo: '本地规则演练',
    metricResultSubLive: '链上结果',
    metricResultSubPending: '尚未进行验收',
    subheadPreviewTitle: '研究声明预览',
    btnViewAllClaims: '查看全部',
    subheadClaimsTitle: '逐条核对研究声明',
    subheadClaimsBody: '声明、约定标准与关联证据共同决定验收结果。',
    emptyClaimsTitle: '暂无声明',
    emptyClaimsBody: '此版本尚未提供需要核查的声明。',
    subheadSourcesTitle: '公开证据来源',
    subheadSourcesBody: '摘要只能检查材料一致性，不能证明发布者身份、真实部署、研究时效或投资价值。',
    snapshotAllVerified: '来源快照已锁定',
    snapshotHasUnverified: '来源检查已固定，含不可核验来源',
    snapshotHashPrefix: '快照 SHA-256 · ',
    snapshotFootNote:
      '每个交付版本仅取源一次，暂时不可用也会被记录。评估使用本快照，不重新抓取外链；失败后应先记录实际结果，再更正真实证据提交修订。',
    sourceFallbackLabel: (idx: number) => `来源 ${idx}`,
    btnOpenSourceAria: (label: string) => `打开${label || '证据来源'}`,
    sourceAsOfPrefix: '参考日期（自述） ',
    actualShaPrefix: '实际 SHA-256 · ',
    subheadHistoryTitle: '交付版本记录',
    subheadHistoryBody: '保留每次提交与对应的验收结果。',
    historyItemMeta: (claimsCount: number, sourcesCount: number) => `${claimsCount} 条声明 · ${sourcesCount} 个来源`,
    footerStatusEvaluatedDemo: '本地演练结果，非链上共识',
    footerStatusEvaluatedLive: '以链上最终执行结果为准',
    footerStatusNeedsEvidence: '先锁定公开来源，再单独评估报告；每版仅取源一次',
    footerStatusSnapshotReady: '对本版已锁定的来源与条目进行评估',
    footerStatusReady: '准备好后运行验收',
    btnExportReceipt: '导出回执',
    btnActionEvaluated: '此版已评估',
    btnActionRunDemo: '运行示例验收',
    btnActionLockSnapshot: '锁定来源快照',
    btnActionEvaluateLocked: '评估已锁定报告',
    btnActionSubmitLiveEval: '提交链上验收',
    createPageTitle: '新建研究委托',
    createPageSubtitle: '先约定研究对象、证据范围与交付人，让验收从一开始就有依据。',
    btnFillPublicTemplate: '填入公开代码研究模板',
    createStepTitle: '委托基本信息',
    createStepSub: '填写明确、可核查的研究边界。',
    chipDemoOrder: '示例演练',
    chipLiveOrder: '链上委托',
    fieldPolicyScopeLabel: '本次研究范围与验收规则',
    fieldPolicyScopeAria: '研究范围',
    optionScopeProtocol: '协议风险研究 · 核心事实必须有证据',
    optionScopeSource: '固定源码研究 · 明确不覆盖的机制',
    fieldCriterionTypeLabel: '标准类型',
    fieldCriterionTypeAriaSuffix: '标准类型',
    optionCriterionFixed: '固定源码问题',
    optionCriterionCustom: '自定义事实标准',
    fieldCustomQuestionLabel: '需要材料回答的事实问题',
    fieldCustomQuestionPlaceholder: '写明需要材料支持的具体事实与范围',
    fieldCustomQuestionHint: '仅接受材料支持的事实答复；此项不允许以未知披露代替。',
    summaryViewLockedQuestion: '查看锁定问题',
    boundaryCriterionDesc: '披露本次研究的证据边界，不作安全或收益保证。',
    summaryViewDisclosureReq: '查看披露要求',
    checkboxAllowUnknown: '允许准确披露本次材料范围内的未知作为交付；不接受事实矛盾或失效来源',
    policyLockNotice: '标准创建后锁定。允许披露未知不代表未知事实已获证明。',
    policyLockSubNotice: '验收仅覆盖约定范围，不等于完成协议整体安全审计。',
    fieldOrderTitleLabel: '委托名称',
    fieldOrderTitlePlaceholder: '例如：DeFi 协议风险研究',
    fieldOrderTitleHint: '为这次研究起一个易于识别的名称。',
    fieldProtocolLabel: '研究对象',
    fieldProtocolPlaceholder: '例如：Aave V3',
    fieldChainLabel: '所在网络',
    fieldChainPlaceholder: '例如：Ethereum',
    fieldAsOfLabel: '委托参考日期（自述）',
    fieldAsOfHint: '日期由委托人填写，不自动证明材料的真实发布时间。',
    fieldAuthorLabel: '研究作者',
    fieldAuthorPlaceholderLive: '0x… 作者钱包地址',
    fieldAuthorHint: '链上模式须填写正确的作者地址。',
    fieldHostsLabel: '允许的证据来源域名',
    fieldHostsPlaceholder: '例如：\ndocs.aave.com\ngithub.com',
    fieldHostsHint: '首版链上来源限 raw.githubusercontent.com。创建后以合约约定为准。',
    fieldRootsLabel: '可信仓库前缀（链上必填）',
    fieldRootsHint: '每行一个仓库前缀；只有预先允许的来源可用于验收。',
    createFootDemo: '演练委托将保存在本机，不会发起链上交易。',
    createFootLive: '创建委托可能需要钱包签名，请核对内容。',
    btnCancel: '取消',
    btnSubmitCreateOrder: '创建委托',
    recordsPageTitle: '验收记录',
    recordsPageSubtitle: '从同一处查看已加载的研究委托、版本与验收结果。',
    recordsCardTitle: '全部研究',
    recordsCountLabel: (count: number) => `${count} 份委托`,
    recordsColOrder: '委托',
    recordsColTarget: '研究对象',
    recordsColDate: '委托参考日期（自述）',
    recordsColVerdict: '当前结果',
    recordsRevisionsCount: (count: number) => `${count} 个版本`,
    emptyRecordsTitle: '暂无记录',
    emptyRecordsBodyDemo: '创建委托后，研究记录会显示在这里。',
    emptyRecordsBodyLive: '请先回到工作台读取链上委托。',
    settingsPageTitle: '接入设置',
    settingsPageSubtitle: '选择体验模式，并配置你的 GenLayer 合约连接。',
    settingsCardTitle: '工作模式',
    settingsCardSub: '演练结果和真实链上状态会明确区分。',
    btnUseVerifiedBradbury: '使用已核验的 Bradbury 配置',
    modeOptionDemoTitle: '示例演练',
    modeOptionDemoDesc: '无需钱包，使用示例数据在本机体验流程。',
    modeOptionLiveTitle: 'GenLayer 链上',
    modeOptionLiveDesc: '使用已部署的合约读取和提交研究记录。',
    fieldRpcLabel: 'GenLayer 节点 RPC',
    fieldRpcHint: '请使用与你的部署网络相匹配的节点地址。',
    fieldContractLabel: 'ResearchReceipt 合约地址',
    fieldContractHint: '请使用你实际部署的合约地址。',
    settingsFootNote: '接入配置保存在当前浏览器。',
    btnSaveSettings: '保存设置',
    modalHeaderTitle: '提交研究版本',
    modalHeaderSub: '补充可公开核验的证据与逐条研究声明。',
    btnCloseModalAria: '关闭',
    modalIntroWarning: '请勿提交私钥、私人账户信息或无法公开核验的资料。',
    btnFillDemoSample: '填入示例',
    btnFillPublicSample: '填入公开代码样例',
    draftNotePrefix: '草稿仅保留在当前页面，关闭编辑器或刷新后不会保存，也不会发送到链上。',
    submitBlockNoWallet: '请连接研究作者的钱包后提交。',
    submitBlockNotWritable: (reason: string) => `写入环境尚未通过核验：${reason}`,
    submitBlockWrongAuthor: '当前钱包不是此委托的研究作者。',
    modalSec01Title: '研究报告',
    modalSec01Sub: '提供本次交付的固定版本。',
    fieldReportTitleLabel: '报告标题',
    fieldReportTitlePlaceholder: '报告标题',
    fieldReportUrlLabel: '报告参考链接（选填）',
    fieldReportBodyLabel: '报告正文',
    fieldReportBodyPlaceholder: '在下方逐项填写交付条目；报告正文将按锁定标准自动汇总。',
    fieldReportBodyHint:
      '正文由下方交付条目自动汇总；验收只覆盖这份结构化报告，最多 12000 UTF-8 字节。参考链接不作为验收证据。',
    modalSec02Title: '证据来源',
    modalSec02Sub: '链上模式仅支持固定 commit 的 GitHub 原始文件，1–16384 字节。',
    btnAddSource: '添加来源（最多 3 个）',
    sourceCardHeader: (num: string) => `来源 ${num}`,
    btnRemove: '移除',
    fieldSourceLabel: '来源名称',
    fieldSourceLabelPlaceholder: '例如：官方文档',
    fieldSourceDate: '参考日期（自述）',
    fieldSourceUrl: '公开 HTTPS 链接',
    fieldSourceUrlPlaceholder: 'https://raw.githubusercontent.com/owner/repo/完整commit/文件',
    btnHashSource: '读取来源并计算摘要与字节数',
    fieldSourceShaPlaceholder: '64 位十六进制摘要',
    fieldSourceBytes: '文件字节数',
    fieldSourceBytesPlaceholder: '例如：2048',
    modalSec03Title: '研究声明',
    modalSec03Sub: '写下要核查的事实与验收标准。',
    btnAddClaim: '添加声明',
    claimCardHeader: (num: string) => `声明 ${num}`,
    fieldCriterionSelect: '验收标准',
    fieldDeliveryType: '交付类型',
    optionClaimUnknown: '材料范围内未知',
    optionClaimBoundary: '边界披露',
    optionClaimFact: '事实答复',
    fieldClaimText: '声明内容',
    fieldClaimTextPlaceholder: '写下本次交付需要核查的内容',
    claimUnknownHint: '此内容按锁定问题生成，覆盖本次提交的全部来源；核查结果决定交付是否满足。',
    claimUnknownScopeLabel: '核查范围：本次全部锁定来源',
    fieldClaimSourcesLabel: '核查材料范围',
    claimRowPendingScope: '待核查范围',
    claimRowVerifiedScope: '核查范围',
    claimRowAllLockedSources: '全部锁定来源',
    claimRowAuthorSelectedScope: '作者选定的核查材料范围',
    fieldCheckFound: '材料中找到答案',
    fieldCheckNotEstablished: '未建立答案',
    findingTitleTooltip: '共识核对结构化结论，模型解释的措辞可能不同。',
    findingBadgeDemo: '本地规则说明',
    findingBadgeSourceOrDelivery: '来源或交付检查说明',
    findingBadgeModel: '模型解释（措辞不要求逐字一致）',
  },
} as const;
