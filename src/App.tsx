import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  connectWallet, connectDevSession, getDevSessionAddress, createOrder, verifyEvidence, evaluateRevision, exportReceipt, getPendingTransaction,
  getConfig, CRITERIA, SOURCE_CRITERIA, V6_CRITERIA, POLICY_V6, CATALOG_VERSION, criterionAllowsUnknown, renderClaimStatement, getWriteCompatibility, listDemoOrders, loadPublishedExamples, publicV6ExampleSubmission, loadOrder, resumePendingTransaction, saveConfig, submitRevision, watchTransactions,
  type Assessment, type Claim, type Config, type Order, type Revision, type Source,
} from './lib/service'
import { demoSubmission } from './lib/demo'
import { publicPinnedUrl, structuredReportBody, type Criterion, type ClaimType } from './lib/domain'
import {
  UI_TEXT,
  SOURCE_CHECK_LABELS_I18N,
  displayClaimText,
  displayCriterionText,
  displayReportBody as renderLocalizedReportBody,
  findingLabelI18n,
  getCriterionGroupLabel,
  getFieldLabel,
  getLanguage,
  humanStatusI18n,
  localizeMessage,
  localizeOrderForDisplay,
  setLanguage,
  type Language,
} from './lib/i18n'
import deployment from './deployment.json'
import './App.css'

type Page = 'workspace' | 'create' | 'records' | 'settings'
type IconName = 'grid' | 'plus' | 'file' | 'settings' | 'arrow' | 'external' | 'check' | 'clock' | 'shield' | 'link' | 'download' | 'chevron' | 'wallet' | 'spark' | 'search' | 'copy' | 'warning' | 'refresh' | 'close'

const iconPaths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.3"/><rect x="14" y="3" width="7" height="7" rx="1.3"/><rect x="3" y="14" width="7" height="7" rx="1.3"/><rect x="14" y="14" width="7" height="7" rx="1.3"/></>,
  plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>, file: <><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .7 1.4-2.7 2.7-1.4-.7-1.5.6-.5 1.6h-4l-.5-1.6-1.5-.6-1.4.7L4 16.4l.7-1.4-.6-1.5-1.6-.5v-3l1.6-.5.6-1.5L4 6.6 6.6 4l1.4.7 1.5-.6L10 2.5h4l.5 1.6 1.5.6 1.4-.7 2.7 2.6-.7 1.4.6 1.5 1.5.5v3l-1.5.5z"/></>,
  arrow: <><path d="M4 12h15"/><path d="m14 7 5 5-5 5"/></>, external: <><path d="M13 5h6v6M19 5l-8 8"/><path d="M19 14v5H5V5h5"/></>,
  check: <path d="m5 12 4 4L19 6"/>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  shield: <><path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5z"/><path d="m8.5 12 2.3 2.3 4.7-5"/></>,
  link: <><path d="m10 13 4-4"/><path d="M8 15 6.5 16.5a4 4 0 0 1-5.6-5.6l4-4a4 4 0 0 1 5.6 0" transform="translate(2 1)"/><path d="m16 9 1.5-1.5a4 4 0 0 1 5.6 5.6l-4 4a4 4 0 0 1-5.6 0" transform="translate(-2 -1)"/></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 17v3h16v-3"/></>, chevron: <path d="m9 18 6-6-6-6"/>,
  wallet: <><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 8h18M16 14h2"/></>, spark: <><path d="m12 2 1.8 5.8L20 10l-6.2 2.2L12 18l-1.8-5.8L4 10l6.2-2.2z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>, copy: <><rect x="8" y="8" width="11" height="12" rx="1"/><path d="M16 8V4H4v12h4"/></>,
  warning: <><path d="M12 3 2.5 20h19z"/><path d="M12 9v4m0 3h.01"/></>, refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 9a7 7 0 0 1 12-3l3 3M19 15a7 7 0 0 1-12 3l-3-3"/></>,
  close: <><path d="m6 6 12 12M18 6 6 18"/></>,
}
function Icon({ name, size = 18, className = '' }: { name: IconName, size?: number, className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>
}

const statusClass = (value: string) => value === 'ACCEPTED' || value === 'SUPPORTED' ? 'success' : value === 'CONTRADICTED' || value === 'NOT_ACCEPTED' ? 'danger' : value === 'REVISION_REQUIRED' ? 'amber' : 'muted'
const displayDate = (value?: string) => value ? value.slice(0, 10).replaceAll('-', '.') : '—'
const latest = (order?: Order) => order?.revisions?.[order.revisions.length - 1]
const shorten = (text: string, first = 8, last = 6) => text && text.length > first + last + 3 ? `${text.slice(0, first)}…${text.slice(-last)}` : text
const newSource = (): Source => ({ label: '', url: '', sha256: '', byteLength: 0, publishedAt: '' })
const newClaim = (criterion: Criterion, v6: boolean): Claim => ({ id: criterion.id, text: '', criterion: criterion.id, sourceIndexes: [0], ...(v6 ? { claimType: criterion.allowed_claim_types?.[0] } : {}) })
const blankSubmission = (items: Criterion[] = CRITERIA, v6 = false): Omit<Revision, 'number' | 'assessment'> => ({ reportTitle: '', reportUrl: '', reportBody: '', sources: [newSource()], claims: items.length ? [newClaim(items[0], v6)] : [] })

function Brand() {
  return <div className="brand"><div className="brand-mark"><span>r</span><span>r</span><i /></div><div><b>research<span>receipt</span></b><small>PROOF OF RESEARCH</small></div></div>
}
function Chip({ text, kind = 'muted', dot = true }: { text: string, kind?: string, dot?: boolean }) {
  return <span className={`chip ${kind}`}>{dot && <i />}{text}</span>
}
function SourceCheck({ revision, index, lang }: { revision: Revision, index: number, lang: Language }) {
  const record = revision.chainRecord as { assessment?: { source_checks?: unknown }; snapshot?: { source_checks?: unknown } } | undefined
  const checks = record?.assessment?.source_checks ?? record?.snapshot?.source_checks
  if (!Array.isArray(checks)) return null
  const check = checks.find(item => item && item.index === index)
  const labels = SOURCE_CHECK_LABELS_I18N[lang]
  if (!check || typeof check.status !== 'string' || !labels[check.status]) return null
  return <div className="source-check"><Chip text={labels[check.status]} kind={check.status === 'VERIFIED' ? 'success' : 'danger'}/>{check.status === 'HASH_MISMATCH' && typeof check.sha256 === 'string' && /^[a-f0-9]{64}$/.test(check.sha256) && <small title={check.sha256}>{UI_TEXT[lang].actualShaPrefix}{shorten(check.sha256, 14, 8)}</small>}</div>
}
function Empty({ icon = 'file', title, body, action }: { icon?: IconName, title: string, body: string, action?: ReactNode }) {
  return <div className="empty"><div className="empty-icon"><Icon name={icon} size={22}/></div><strong>{title}</strong><p>{body}</p>{action}</div>
}

function App() {
  const [lang, setLangState] = useState<Language>(() => getLanguage())
  const t = UI_TEXT[lang]
  const [page, setPage] = useState<Page>('workspace')
  const [config, setConfig] = useState<Config>(() => getConfig())
  const [settingsDraft, setSettingsDraft] = useState<Config>(() => getConfig())
  const [wallet, setWallet] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [revisionNumber, setRevisionNumber] = useState<number | null>(null)
  const [panel, setPanel] = useState<'overview' | 'claims' | 'sources' | 'history'>('overview')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [transaction, setTransaction] = useState<{ hash?: string, stage: string, message: string } | null>(null)
  const [showSubmission, setShowSubmission] = useState(false)
  const [submission, setSubmission] = useState<Omit<Revision, 'number' | 'assessment'>>(() => blankSubmission())
  const [lookup, setLookup] = useState('')
  const [policyScope, setPolicyScope] = useState<'protocol' | 'source'>('protocol')
  const [unknownAllowed, setUnknownAllowed] = useState<string[]>([])
  const [customCriteria, setCustomCriteria] = useState<Record<string, string>>({})
  const [orderDraft, setOrderDraft] = useState({ title: '', protocol: '', chain: 'Ethereum', asOf: '', author: '', hosts: 'raw.githubusercontent.com', roots: '' })
  const [pending, setPending] = useState(() => getPendingTransaction(getConfig()))
  const [compatState, setCompat] = useState<{ key: string; writable: boolean; reason: string }>({ key: '', writable: false, reason: '连接钱包后核验写入环境。' })

  // 同步文档语言与标题
  useEffect(() => {
    setLanguage(lang)
    if (typeof document !== 'undefined') {
      document.title = t.pageTitle
    }
  }, [lang, t.pageTitle])

  function toggleLanguage() {
    const next: Language = lang === 'en' ? 'zh' : 'en'
    setLanguage(next)
    setLangState(next)
  }

  // 将底层订单列表转换为当前界面语言的展示副本，保持原始订单对象用于链上交互与签名回执
  const displayOrders = useMemo(() => orders.map(order => localizeOrderForDisplay(order, lang)), [orders, lang])
  const rawSelected = orders.find(order => order.id === selectedId)
  const selected = displayOrders.find(order => order.id === selectedId)
  const revision = selected?.revisions?.find(item => item.number === revisionNumber) || latest(selected)
  const assessment = revision?.assessment
  const assessedCount = displayOrders.filter(order => latest(order)?.assessment).length
  const demoMode = config.mode === 'demo'
  const compatKey = JSON.stringify([config.mode, config.rpcUrl, config.contractAddress, wallet])
  const compat = compatState.key === compatKey ? compatState : { writable: false, reason: wallet ? '正在核验写入环境。' : '连接钱包后核验写入环境。' }
  const publicTestnet = config.rpcUrl.replace(/\/$/, '') === 'https://rpc-bradbury.genlayer.com'
  const snapshotMode = !demoMode && ['research-receipt/5', POLICY_V6].includes(rawSelected?.policyVersion || '')
  const needsEvidence = !!(snapshotMode && revision && !revision.evidenceSnapshot)
  const environmentLabel = publicTestnet ? t.envBradburyLabel : t.envStudioLabel
  const canWrite = demoMode || (!!wallet && compat.writable && rawSelected?.policyVersion === POLICY_V6)
  const canSubmit = demoMode || (canWrite && wallet.toLowerCase() === rawSelected?.author.toLowerCase())
  const localizedCompatReason = localizeMessage(compat.reason, lang)
  const submitBlockReason = !wallet ? t.submitBlockNoWallet : !compat.writable ? t.submitBlockNotWritable(localizedCompatReason) : wallet.toLowerCase() !== rawSelected?.author.toLowerCase() ? t.submitBlockWrongAuthor : ''
  const canEvaluate = demoMode || (canWrite && [rawSelected?.owner?.toLowerCase(), rawSelected?.author.toLowerCase()].includes(wallet.toLowerCase()))
  const rawSelectedCriteria: Criterion[] = rawSelected?.criteria || CRITERIA
  const selectedCriteria: Criterion[] = selected?.criteria || CRITERIA.map(item => ({ ...item, text: displayCriterionText(item, lang) }))
  const selectedV6 = rawSelected?.policyVersion === POLICY_V6
  let reportBody = ''
  let reportError = ''
  try { reportBody = structuredReportBody(submission.claims, rawSelectedCriteria) } catch (e) { reportError = e instanceof Error ? e.message : String(e) }
  const localizedReportDisplay = reportError ? localizeMessage(reportError, lang) : renderLocalizedReportBody(submission.claims, rawSelectedCriteria, lang)

  useEffect(() => {
    let cancelled = false
    const key = JSON.stringify([config.mode, config.rpcUrl, config.contractAddress, wallet])
    setCompat({ key, writable: false, reason: wallet ? '正在核验写入环境。' : '连接钱包后核验写入环境。' })
    if (config.mode === 'live' && wallet) getWriteCompatibility(config).then(result => { if (!cancelled) setCompat({ ...result, key }) }).catch(e => { if (!cancelled) setCompat({ key, writable: false, reason: e instanceof Error ? e.message : String(e) }) })
    return () => { cancelled = true }
  }, [config.mode, config.rpcUrl, config.contractAddress, wallet])

  useEffect(() => watchTransactions(event => setTransaction(event)), [])
  useEffect(() => { setPending(getPendingTransaction(config)) }, [config, busy])

  useEffect(() => {
    let cancelled = false
    if (config.mode === 'demo') {
      setLoadingOrders(false)
      listDemoOrders().then(data => {
        if (cancelled) return
        setOrders(data)
        setSelectedId(data[0]?.id ?? null)
        setRevisionNumber(data[0] ? latest(data[0])?.number ?? null : null)
      }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    } else {
      setLoadingOrders(true)
      setOrders([]); setSelectedId(null); setRevisionNumber(null)
      loadPublishedExamples(config).then(data => {
        if (cancelled) return
        setOrders(data); setSelectedId(data[0]?.id ?? null); setRevisionNumber(data[0] ? latest(data[0])?.number ?? null : null)
      }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) }).finally(() => { if (!cancelled) setLoadingOrders(false) })
    }
    return () => { cancelled = true }
  }, [config.mode, config.rpcUrl, config.contractAddress])

  const stats = useMemo(() => [
    { label: t.statOrdersLabel, value: String(displayOrders.length).padStart(2, '0'), note: demoMode ? t.statOrdersNoteDemo : t.statOrdersNoteLive, icon: 'file' as IconName },
    { label: t.statRevisionsLabel, value: String(displayOrders.reduce((n, order) => n + order.revisions.length, 0)).padStart(2, '0'), note: t.statRevisionsNote, icon: 'link' as IconName },
    { label: t.statAssessedLabel, value: String(assessedCount).padStart(2, '0'), note: demoMode ? t.statAssessedNoteDemo : t.statAssessedNoteLive, icon: 'shield' as IconName },
  ], [displayOrders, demoMode, assessedCount, t])

  function chooseOrder(order: Order) { setSelectedId(order.id); setRevisionNumber(latest(order)?.number ?? null); setPanel('overview'); setPage('workspace'); setError(''); setNotice('') }
  function updateOrder(order: Order) { setOrders(existing => existing.some(item => item.id === order.id) ? existing.map(item => item.id === order.id ? order : item) : [...existing, order]); setSelectedId(order.id); setRevisionNumber(latest(order)?.number ?? null) }
  async function perform(label: string, fn: () => Promise<void>) { setError(''); setNotice(''); setBusy(label); try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy('') } }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    const hosts = orderDraft.hosts.split(/[\n,，]/).map(host => host.trim()).filter(Boolean)
    if (!hosts.length) { setError('请至少填写一个可核验来源域名。'); return }
    await perform('正在创建委托', async () => {
      const roots = orderDraft.roots.split(/[\n,，]/).map(root => root.trim()).filter(Boolean)
      if (!demoMode && (!wallet || !compat.writable)) throw new Error('写入环境尚未通过核验，或钱包未连接。')
      const lockedCriteria = (demoMode ? (policyScope === 'source' ? SOURCE_CRITERIA : CRITERIA) : V6_CRITERIA).map(item => {
        if (!demoMode && Object.hasOwn(customCriteria, item.id)) return { ...item, text: customCriteria[item.id].trim(), evidence_requirement: 'fact_required' as const, allowed_claim_types: ['factual_assertion' as const], requested_field_ids: [] }
        return { ...item, evidence_requirement: unknownAllowed.includes(item.id) && (demoMode || criterionAllowsUnknown(item)) ? 'scoped_unknown_allowed' as const : 'fact_required' as const }
      })
      const order = await createOrder({ title: orderDraft.title.trim(), protocol: orderDraft.protocol.trim(), chain: orderDraft.chain.trim(), asOf: orderDraft.asOf, author: orderDraft.author.trim() || 'demo-author', allowedHosts: hosts, criteria: lockedCriteria, ...(!demoMode ? { policyVersion: POLICY_V6, catalogVersion: CATALOG_VERSION } : {}), ...(roots.length ? { sourceRoots: roots } : {}) }, config)
      updateOrder(order); setPage('workspace'); setPanel('overview'); setNotice(demoMode ? '示例委托已保存在本机。接下来可以提交研究版本。' : '委托已提交。请以链上最终状态为准。')
    })
  }
  async function handleSubmit(event: FormEvent) {
    event.preventDefault(); if (!rawSelected) return
    if (new Set(submission.claims.map(claim => claim.criterion)).size !== submission.claims.length) { setError('每项验收标准只能对应一条研究声明。'); return }
    if (!canSubmit) { setError('当前环境或钱包无权提交。'); return }
    if (submission.claims.some(claim => claim.claimType !== 'unknown_disclosure' && !claim.sourceIndexes.length)) { setError('请为每条事实或边界声明至少选择一个来源。'); return }
    if (submission.sources.some(source => !source.url.startsWith('https://'))) { setError('证据来源必须使用公开 HTTPS 链接。'); return }
    if (reportError) { setError(reportError); return }
    if (new TextEncoder().encode(reportBody).length > 12000) { setError('报告正文不能超过 12000 UTF-8 字节。'); return }
    await perform('正在提交研究版本', async () => {
      const updated = await submitRevision(rawSelected, { ...submission, reportBody }, config)
      updateOrder(updated); setShowSubmission(false); setPanel('claims'); setNotice(demoMode ? '示例研究版本已保存。' : '研究版本已提交，请查看链上状态。')
    })
  }
  async function handleEvaluate() {
    if (!rawSelected || !revision) return
    await perform(demoMode ? '正在运行本地规则' : '正在提交链上验收', async () => {
      const updated = await evaluateRevision(rawSelected, revision.number, config)
      updateOrder(updated); setRevisionNumber(revision.number); setPanel('claims'); setNotice(demoMode ? '本地规则演练已完成，结果不代表链上共识。' : '请核查交易和验收的最终状态。')
    })
  }
  async function handleVerifyEvidence() {
    if (!rawSelected || !revision || !needsEvidence) return
    await perform('正在锁定链上来源快照', async () => {
      const updated = await verifyEvidence(rawSelected, revision.number, config)
      const snapshot = updated.revisions.find(item => item.number === revision.number)?.evidenceSnapshot
      updateOrder(updated); setRevisionNumber(revision.number); setPanel('sources')
      setNotice(snapshot?.allVerified ? '来源快照已锁定。核对来源后，可单独提交本版报告评估。' : '本版来源检查已固定，包含不可核验来源。可按当前证据评估后，真正更正证据再提交修订；当前版本不能重取来源。')
    })
  }
  async function handleLookup(event: FormEvent) {
    event.preventDefault()
    const id = Number(lookup)
    if (!Number.isSafeInteger(id) || id < 1 || lookup.trim() === '') { setError('请输入有效的正整数委托编号。'); return }
    await perform('正在读取链上委托', async () => { const order = await loadOrder(id, config); updateOrder(order); setPage('workspace'); setNotice('已读取委托；请核对来源与最终状态。') })
  }
  async function handleWallet() { await perform('正在连接钱包', async () => { const address = await connectWallet(); setWallet(address); setNotice('钱包已连接。请在钱包中确认后续操作。') }) }
  async function handleDevSession() { await perform('正在创建开发网临时账户', async () => { const address = await connectDevSession(config); setWallet(address); setOrderDraft(current => ({ ...current, author: address, roots: current.roots || 'raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/' })); setNotice('临时测试账户已就绪，仅用于 Studio-dev。刷新后会丢失该账户的写入权限。') }) }
  function fillPublicOrder() { setCustomCriteria({}); setPolicyScope('source'); setUnknownAllowed(['withdrawals', 'audit']); setOrderDraft({ title: lang === 'en' ? 'Default Base Class Source Review · Ownable + Context' : '默认基类源码审查 · Ownable + Context', protocol: 'OpenZeppelin Ownable + Context (pinned default implementations)', chain: 'EVM source only; excludes derived overrides, proxies and deployed instances', asOf: '2026-11-05', author: wallet || getDevSessionAddress() || '', hosts: 'raw.githubusercontent.com', roots: 'raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/' }); setNotice('已填入公开代码研究模板。它只评估固定源文件，不代表实际部署审计。') }
  function applySettings(event: FormEvent) {
    event.preventDefault()
    try { saveConfig(settingsDraft); setConfig(settingsDraft); setNotice(settingsDraft.mode === 'demo' ? '已切换到示例演练。' : '链上接入配置已保存。'); setError(''); setPage('workspace') } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  function addSource() { setSubmission(current => ({ ...current, sources: [...current.sources, newSource()] })) }
  function changeSource(index: number, patch: Partial<Source>) { setSubmission(current => ({ ...current, sources: current.sources.map((source, i) => i === index ? { ...source, ...patch } : source) })) }
  async function hashSource(index: number) {
    const rawUrl = submission.sources[index]?.url || ''
    await perform('正在读取公开固定来源', async () => {
      publicPinnedUrl(rawUrl)
      const controller = new AbortController()
      try {
        const response = await fetch(rawUrl, { credentials: 'omit', redirect: 'error', signal: controller.signal })
        if (!response.ok || !response.body) throw new Error('无法读取该公开来源，请检查链接与网络。')
        const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 16384) { await reader.cancel(); throw new Error('来源超过 16384 字节，无法用于首版验收。') }; chunks.push(value) }
        if (!size) throw new Error('来源为空，无法用于验收。')
        const bytes = new Uint8Array(size); let offset = 0
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
        setSubmission(current => ({ ...current, sources: current.sources.map((source, i) => i === index && source.url === rawUrl ? { ...source, sha256: digest, byteLength: size } : source) }))
        setNotice('已计算来源原始字节数与 SHA-256；请确认链接和内容。')
      } finally { controller.abort() }
    })
  }
  function changeClaim(index: number, patch: Partial<Claim>) { setSubmission(current => ({ ...current, claims: current.claims.map((claim, i) => i === index ? { ...claim, ...patch } : claim) })) }
  function deleteSource(index: number) {
    setSubmission(current => ({ ...current, sources: current.sources.filter((_, i) => i !== index), claims: current.claims.map(claim => ({ ...claim, sourceIndexes: claim.sourceIndexes.filter(i => i !== index).map(i => i > index ? i - 1 : i) })) }))
  }
  const navItems: { id: Page, icon: IconName, label: string }[] = [
    { id: 'workspace', icon: 'grid', label: t.navWorkspace },
    { id: 'create', icon: 'plus', label: t.navCreate },
    { id: 'records', icon: 'file', label: t.navRecords },
    { id: 'settings', icon: 'settings', label: t.navSettings },
  ]
  const activeAlertText = localizeMessage(error || busy || notice, lang)

  return <div className="app-shell">
    <aside className="sidebar">
      <Brand/>
      <div className="sidebar-caption">{t.sidebarCaption}</div>
      <nav className="nav" aria-label={t.navAriaLabel}>{navItems.map(item => <button key={item.id} aria-label={item.label} title={item.label} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setError(''); setNotice('') }}><Icon name={item.icon} size={18}/><span>{item.label}</span>{page === item.id && <i/>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-callout"><div className="side-icon"><Icon name="shield" size={18}/></div><strong>{t.sidebarCalloutTitle}</strong><p>{t.sidebarCalloutBody}</p></div><div className="sidebar-foot"><span className="online-dot"/> RESEARCH WORKSPACE <span>01</span></div></div>
    </aside>
    <main className="main">
      <header className="topbar"><div className="breadcrumb"><span>{t.breadcrumbRoot}</span><Icon name="chevron" size={13}/><b>{page === 'workspace' ? t.breadcrumbWorkspace : page === 'create' ? t.breadcrumbCreate : page === 'records' ? t.breadcrumbRecords : t.breadcrumbSettings}</b></div><div className="top-actions"><button type="button" className="wallet-button lang-button" aria-label={t.langSwitchTitle} title={t.langSwitchTitle} onClick={toggleLanguage}><span>{t.langSwitchLabel}</span></button><button className="mode-control" onClick={() => { setSettingsDraft(config); setPage('settings') }}><span className={demoMode ? 'mode-dot demo' : 'mode-dot'}/>{demoMode ? t.modeDemo : t.modeLive}<Icon name="chevron" size={13}/></button>{!demoMode && config.rpcUrl === 'https://studio-dev.genlayer.com/api' && <button className="wallet-button dev-account-button" disabled={!!busy} onClick={handleDevSession}>{getDevSessionAddress() ? t.btnDevAccountReady : t.btnDevAccountCreate}</button>}<button className="wallet-button" onClick={handleWallet} disabled={!!busy}><Icon name="wallet" size={16}/><span>{wallet ? shorten(wallet, 6, 4) : t.btnConnectWallet}</span></button><div className="avatar" aria-label={t.avatarAriaLabel}>R</div></div></header>
      <div className="mobile-brand"><Brand/></div>
      <div className="page-wrap">
        {!demoMode && getDevSessionAddress() && <div className="transaction-banner"><Icon name="shield" size={15}/><span>{t.bannerDevSession}</span></div>}
        {!demoMode && <div className="transaction-banner"><Icon name="shield" size={15}/><span>{compat.writable ? t.bannerCompatWritable : t.bannerCompatReadOnly(localizedCompatReason)}</span></div>}{!demoMode && selected?.origin && <div className="chain-proof"><span>{environmentLabel} · {t.chainProofSuffix}</span><code>{selected.origin.contractAddress}</code><span>{t.chainProofOrder(selected.id)}</span></div>}
        {(error || notice || busy) && <div className={`alert ${error ? 'alert-error' : ''}`} role={error ? 'alert' : 'status'}><Icon name={error ? 'warning' : busy ? 'refresh' : 'check'} size={16}/><span>{activeAlertText}</span>{!busy && <button aria-label={t.btnCloseAlert} onClick={() => { setError(''); setNotice('') }}><Icon name="close" size={15}/></button>}</div>}
        {loadingOrders && <div className="transaction-banner" role="status"><Icon name="refresh" size={15}/><span>{t.bannerLoadingOrders}</span></div>}
        {transaction && <div className="transaction-banner" role="status"><Icon name="refresh" size={15}/><span title={transaction.hash}>{localizeMessage(transaction.message, lang)}{transaction.hash && <> · {t.txHashPrefix}{shorten(transaction.hash, 10, 8)}</>}</span><button onClick={() => setTransaction(null)} aria-label={t.btnCloseTxBanner}><Icon name="close" size={14}/></button></div>}
        {config.mode === 'live' && pending && <div className="transaction-banner" role="status"><Icon name="clock" size={15}/><span>{pending.hash ? t.pendingTxWithHash(shorten(pending.hash, 10, 8)) : t.pendingTxUncertain}{t.pendingTxWarning}</span><button className="resume-button" disabled={!!busy} onClick={() => perform('正在恢复交易追踪', async () => { await resumePendingTransaction(config); setPending(getPendingTransaction(config)); setNotice('交易追踪完成，请重新读取相关委托。') })}>{t.btnResumeTracking}</button></div>}

        {page === 'workspace' && <>
          <div className="hero-head"><div><div className="eyebrow"><span className="eyebrow-line"/> THE EVIDENCE WORKSPACE</div><h1>{t.heroTitleLine1}<br/><em>{t.heroTitleEm}</em></h1><p>{t.heroSubtitle}</p></div><button className="primary hero-cta" onClick={() => { setPage('create'); setError(''); setNotice('') }}><Icon name="plus" size={17}/> {t.btnHeroCreate} <Icon name="arrow" size={16}/></button><div className="hero-art" aria-hidden="true"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="orbit orbit-c"/><span className="orbit-point one"/><span className="orbit-point two"/><span className="orbit-center"><Icon name="shield" size={23}/></span></div></div>
          <div className={`environment-banner ${demoMode ? '' : 'live'}`}><span className="env-icon"><Icon name={demoMode ? 'spark' : 'shield'} size={16}/></span><p><strong>{demoMode ? t.envBannerDemoTitle : environmentLabel}</strong><span>{demoMode ? t.envBannerDemoBody : publicTestnet ? t.envBannerBradburyBody : t.envBannerStudioBody}</span></p><button onClick={() => { setSettingsDraft(config); setPage('settings') }}>{demoMode ? t.btnEnvConfigLive : t.btnEnvViewSettings} <Icon name="arrow" size={14}/></button></div>
          <div className="stats-grid">{stats.map((stat, i) => <div className="stat-card" key={stat.label}><div className="stat-top"><span>{stat.label}</span><span className={`stat-icon stat-${i}`}><Icon name={stat.icon} size={17}/></span></div><div className="stat-bottom"><strong>{stat.value}</strong><small>{stat.note}</small></div></div>)}</div>
          <section className="workspace-section"><div className="section-heading"><div><div className="section-kicker">YOUR RESEARCH</div><h2>{t.sectionHeadingTitle} <span>／</span> <small>{t.sectionHeadingSub}</small></h2></div><div className="section-tools">{!demoMode && <form className="lookup" onSubmit={handleLookup}><Icon name="search" size={15}/><input aria-label={t.lookupAriaLabel} placeholder={t.lookupPlaceholder} value={lookup} onChange={e => setLookup(e.target.value)}/><button disabled={!!busy}>{t.lookupButton}</button></form>}<button className="text-action" onClick={() => setPage('records')}>{t.btnViewAllRecords} <Icon name="arrow" size={15}/></button></div></div>
            {displayOrders.length === 0 ? <div className="panel empty-panel"><Empty title={demoMode ? t.emptyOrdersTitleDemo : t.emptyOrdersTitleLive} body={demoMode ? t.emptyOrdersBodyDemo : t.emptyOrdersBodyLive} action={<button className="secondary" onClick={() => setPage('create')}>{t.btnEmptyCreate} <Icon name="arrow" size={15}/></button>}/></div> : <div className="workspace-grid"><div className="order-list"><div className="list-label"><span>{t.listHeaderLabel}</span><span>{displayOrders.length.toString().padStart(2, '0')}</span></div>{displayOrders.map(order => { const rev = latest(order); return <button key={order.id} className={`order-card ${selected?.id === order.id ? 'selected' : ''}`} onClick={() => chooseOrder(order)}><span className="order-top"><span className="order-number">RR · {String(order.id).padStart(3, '0')}</span><Icon name="arrow" size={15}/></span><strong>{order.title}</strong><span className="order-meta">{order.protocol} <i/> {order.chain}</span><span className="order-footer"><Chip text={humanStatusI18n(rev?.assessment?.verdict, lang)} kind={statusClass(rev?.assessment?.verdict || '')}/><span>{rev ? `V${rev.number} · ${displayDate(order.asOf)}` : t.orderWaitingSubmission}</span></span></button>})}<button className="add-order" onClick={() => setPage('create')}><Icon name="plus" size={16}/> {t.btnAddOrderCard}</button><div className="list-note"><Icon name="shield" size={16}/><span>{t.listNoteLine1}<br/>{t.listNoteLine2}</span></div></div>
            {selected && rawSelected && <div className="detail panel"><div className="detail-heading"><div><div className="detail-overline"><span className="green-dot"/> {t.detailOverlineLabel} <span> / </span> RR-{String(selected.id).padStart(3, '0')}</div><h3>{selected.title}</h3><div className="detail-meta"><span>{selected.protocol}</span><i/><span>{selected.chain}</span><i/><span>{t.detailAsOfPrefix}{displayDate(selected.asOf)}</span></div></div><div className="detail-actions"><Chip text={humanStatusI18n(assessment?.verdict, lang)} kind={statusClass(assessment?.verdict || '')}/><button className="icon-button" aria-label={t.btnExportReceiptAria} title={t.btnExportReceiptAria} disabled={!revision || !assessment} onClick={() => revision && exportReceipt(rawSelected, revision.number)}><Icon name="download" size={17}/></button></div></div>
              <div className="tabs" role="tablist" aria-label={t.tabsAriaLabel}>{([{ id: 'overview', label: t.tabOverview }, { id: 'claims', label: t.tabClaims }, { id: 'sources', label: t.tabSources }, { id: 'history', label: t.tabHistory }] as const).map(tab => <button role="tab" aria-selected={panel === tab.id} key={tab.id} className={panel === tab.id ? 'active' : ''} onClick={() => setPanel(tab.id)}>{tab.label}{tab.id === 'claims' && revision && <span>{revision.claims.length}</span>}{tab.id === 'sources' && revision && <span>{revision.sources.length}</span>}</button>)}</div>
              <div className="detail-body"><details className="policy-review"><summary>{t.policyReviewSummary}</summary><ol>{selectedCriteria.map(item => <li key={item.id}>{item.text}<small>{item.verification_kind === 'boundary_review' ? t.policyBoundaryReview : item.evidence_requirement === 'scoped_unknown_allowed' ? t.policyScopedUnknownAllowed : item.evidence_requirement === 'fact_required' ? t.policyFactRequired : t.policyLegacy}</small></li>)}</ol><small>{t.policyReviewFoot}</small></details><div className="version-line"><div><span className="label-sm">{t.versionLineLabel}</span><div className="version-select-wrap"><select aria-label={t.versionSelectAria} value={revision?.number ?? ''} onChange={e => setRevisionNumber(Number(e.target.value))} disabled={!selected.revisions.length}>{selected.revisions.length ? selected.revisions.map(item => <option key={item.number} value={item.number}>{t.versionOptionPrefix(String(item.number).padStart(2, '0'), item.reportTitle)}</option>) : <option value="">{t.versionOptionNone}</option>}</select><Icon name="chevron" size={13}/></div></div><button className="outline-button" disabled={!!busy || (!demoMode && !selectedV6) || latest(selected)?.assessment?.verdict === 'ACCEPTED'} title={latest(selected)?.assessment?.verdict === 'ACCEPTED' ? t.btnPrepareRevisionAcceptedTitle : !demoMode && !selectedV6 ? t.btnPrepareRevisionLegacyTitle : t.btnPrepareRevisionDefaultTitle} onClick={() => { setSubmission(blankSubmission(rawSelectedCriteria, selectedV6)); setShowSubmission(true) }}><Icon name="plus" size={15}/> {demoMode ? t.btnSubmitRevisionDemo : t.btnPrepareRevisionLive}</button></div>
                {!revision ? <Empty title={t.emptyRevisionTitle} body={t.emptyRevisionBody}/> : <>
                  {panel === 'overview' && <><div className="overview-callout"><div className="overview-icon"><Icon name="file" size={21}/></div><div><div className="label-sm">{t.overviewCalloutLabel}</div><h4>{revision.reportTitle}</h4><p>{t.overviewCalloutBody}</p></div>{revision.reportUrl && <a href={revision.reportUrl} target="_blank" rel="noreferrer" aria-label={t.btnOpenReportAria}><Icon name="external" size={17}/></a>}</div><div className="overview-metrics"><div><span>{t.metricClaimsLabel}</span><strong>{String(revision.claims.length).padStart(2, '0')}</strong><small>{t.metricClaimsSub}</small></div><div><span>{t.metricSourcesLabel}</span><strong>{String(revision.sources.length).padStart(2, '0')}</strong><small>{t.metricSourcesSub}</small></div><div><span>{t.metricResultLabel}</span><strong className="metric-status">{humanStatusI18n(assessment?.verdict, lang)}</strong><small>{assessment ? (assessment.mode === 'demo' ? t.metricResultSubDemo : t.metricResultSubLive) : t.metricResultSubPending}</small></div></div><div className="subhead"><div><span className="section-kicker">EVIDENCE FIRST</span><h4>{t.subheadPreviewTitle}</h4></div><button className="text-action" onClick={() => setPanel('claims')}>{t.btnViewAllClaims} <Icon name="arrow" size={15}/></button></div><div className="claim-preview">{revision.claims.slice(0, 2).map((claim, i) => <ClaimRow key={claim.id} claim={claim} index={i} assessment={assessment} v6={selectedV6} lang={lang} compact/>)}</div></>}
                  {panel === 'claims' && <><div className="subhead tab-heading"><div><span className="section-kicker">CLAIMS & FINDINGS</span><h4>{t.subheadClaimsTitle}</h4><p>{t.subheadClaimsBody}</p></div></div><div className="claim-preview">{revision.claims.length ? revision.claims.map((claim, i) => <ClaimRow key={claim.id} claim={claim} index={i} assessment={assessment} v6={selectedV6} lang={lang}/>) : <Empty title={t.emptyClaimsTitle} body={t.emptyClaimsBody}/>}{assessment?.items.filter(item => !revision.claims.some(claim => claim.id === item.claimId)).map(item => <div className="claim-row" key={item.claimId}><div className="claim-content"><strong>{getCriterionGroupLabel(item.claimId, lang)}</strong><p>{item.reason}</p></div><div className="finding-status"><Chip text={humanStatusI18n(item.status, lang)} kind={statusClass(item.status)}/>{item.deliveryStatus && <small>{humanStatusI18n(item.deliveryStatus, lang)}</small>}</div></div>)}</div></>}
                  {panel === 'sources' && <><div className="subhead tab-heading"><div><span className="section-kicker">SOURCE LIBRARY</span><h4>{t.subheadSourcesTitle}</h4><p>{t.subheadSourcesBody}</p></div></div>{revision.evidenceSnapshot && <div className="policy-review"><strong>{revision.evidenceSnapshot.allVerified ? t.snapshotAllVerified : t.snapshotHasUnverified}</strong><p title={revision.evidenceSnapshot.snapshotHash}>{t.snapshotHashPrefix}{shorten(revision.evidenceSnapshot.snapshotHash, 18, 12)}</p><small>{t.snapshotFootNote}</small></div>}<div className="source-list">{revision.sources.map((source, i) => <div className="source-row" key={`${source.url}-${i}`}><span className="source-index">{String(i + 1).padStart(2, '0')}</span><div><div className="source-title">{source.label || t.sourceFallbackLabel(i + 1)} <a href={source.url} target="_blank" rel="noreferrer" aria-label={t.btnOpenSourceAria(source.label)}><Icon name="external" size={14}/></a></div><div className="source-url">{source.url}</div><div className="source-hash">SHA-256 · {shorten(source.sha256, 14, 8)} <span>／</span> {source.byteLength} bytes <span>／</span> {t.sourceAsOfPrefix}{displayDate(source.publishedAt)}</div><SourceCheck revision={revision} index={i} lang={lang}/></div></div>)}</div></>}
                  {panel === 'history' && <><div className="subhead tab-heading"><div><span className="section-kicker">REVISION HISTORY</span><h4>{t.subheadHistoryTitle}</h4><p>{t.subheadHistoryBody}</p></div></div><div className="history-list">{[...selected.revisions].reverse().map(item => <button key={item.number} onClick={() => { setRevisionNumber(item.number); setPanel('overview') }}><span className="history-dot"/><div><strong>{t.versionOptionPrefix(String(item.number).padStart(2, '0'), item.reportTitle)}</strong><small>{t.historyItemMeta(item.claims.length, item.sources.length)}</small></div><Chip text={humanStatusI18n(item.assessment?.verdict, lang)} kind={statusClass(item.assessment?.verdict || '')}/><Icon name="chevron" size={15}/></button>)}</div></>}
                  <div className="detail-footer"><div><span className="footer-icon"><Icon name="shield" size={15}/></span><span>{assessment ? (assessment.mode === 'demo' ? t.footerStatusEvaluatedDemo : t.footerStatusEvaluatedLive) : needsEvidence ? t.footerStatusNeedsEvidence : snapshotMode ? t.footerStatusSnapshotReady : t.footerStatusReady}</span></div><div className="footer-buttons">{assessment && <button className="outline-button" onClick={() => exportReceipt(rawSelected, revision.number)}><Icon name="download" size={15}/> {t.btnExportReceipt}</button>}<button className="primary" disabled={!!busy || !!assessment || !canEvaluate} onClick={needsEvidence ? handleVerifyEvidence : handleEvaluate}>{assessment ? t.btnActionEvaluated : demoMode ? t.btnActionRunDemo : needsEvidence ? t.btnActionLockSnapshot : snapshotMode ? t.btnActionEvaluateLocked : t.btnActionSubmitLiveEval} <Icon name="arrow" size={15}/></button></div></div>
                </>}
              </div></div>}</div>}
          </section>
          <div className="page-foot"><span>RESEARCHRECEIPT <b> / </b> EVIDENCE OVER ASSUMPTION</span><span>Built for verifiable research <i>✳</i></span></div>
        </>}

        {page === 'create' && <section className="form-page"><div className="form-header"><div className="eyebrow"><span className="eyebrow-line"/> NEW RESEARCH REQUEST</div><h1>{t.createPageTitle}<span className="title-dot">.</span></h1><p>{t.createPageSubtitle}</p>{!demoMode && <button className="outline-button template-button" type="button" onClick={fillPublicOrder}>{t.btnFillPublicTemplate}</button>}</div><form className="form-card" onSubmit={handleCreate}><div className="form-card-head"><div className="form-step">01</div><div><h2>{t.createStepTitle}</h2><p>{t.createStepSub}</p></div><Chip text={demoMode ? t.chipDemoOrder : t.chipLiveOrder} kind={demoMode ? 'amber' : 'success'}/></div><div className="policy-review">{demoMode && <label className="field"><span>{t.fieldPolicyScopeLabel}</span><select aria-label={t.fieldPolicyScopeAria} value={policyScope} onChange={e => setPolicyScope(e.target.value as 'protocol' | 'source')}><option value="protocol">{t.optionScopeProtocol}</option><option value="source">{t.optionScopeSource}</option></select></label>}<ol>{(demoMode ? (policyScope === 'source' ? SOURCE_CRITERIA : CRITERIA) : V6_CRITERIA).map((item: Criterion) => { const custom = !demoMode && Object.hasOwn(customCriteria, item.id); const evidence = criterionAllowsUnknown(item); const groupLabel = getCriterionGroupLabel(item.id, lang); const listSeparator = lang === 'en' ? ', ' : '、'; return <li key={item.id} className="criterion-item"><strong>{groupLabel}</strong>{demoMode ? <p className="criterion-text">{displayCriterionText(item, lang)}</p> : evidence ? <><label className="field criterion-choice"><span>{t.fieldCriterionTypeLabel}</span><select aria-label={groupLabel + t.fieldCriterionTypeAriaSuffix} value={custom ? 'custom' : 'fixed'} onChange={e => { if (e.target.value === 'custom') { setCustomCriteria(current => ({ ...current, [item.id]: '' })); setUnknownAllowed(current => current.filter(id => id !== item.id)) } else setCustomCriteria(current => { const next = { ...current }; delete next[item.id]; return next }) }}><option value="fixed">{t.optionCriterionFixed}</option><option value="custom">{t.optionCriterionCustom}</option></select></label>{custom ? <label className="field"><span>{t.fieldCustomQuestionLabel}</span><textarea required rows={3} value={customCriteria[item.id]} onChange={e => setCustomCriteria(current => ({ ...current, [item.id]: e.target.value }))} placeholder={t.fieldCustomQuestionPlaceholder}/><small>{t.fieldCustomQuestionHint}</small></label> : <><p>{(item.requested_field_ids || []).map(id => getFieldLabel(id, lang)).join(listSeparator)}</p><details><summary>{t.summaryViewLockedQuestion}</summary><p className="criterion-text">{displayCriterionText(item, lang)}</p></details></>}</> : <><p>{t.boundaryCriterionDesc}</p><details><summary>{t.summaryViewDisclosureReq}</summary><p className="criterion-text">{displayCriterionText(item, lang)}</p></details></>}{((demoMode && item.id !== 'limitations') || (evidence && !custom)) && <label className="criterion-unknown"><input type="checkbox" checked={unknownAllowed.includes(item.id)} onChange={e => setUnknownAllowed(current => e.target.checked ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))}/> {t.checkboxAllowUnknown}</label>}</li> })}</ol><p>{t.policyLockNotice}</p><small>{t.policyLockSubNotice}</small></div><div className="fields-grid"><label className="field span-two"><span>{t.fieldOrderTitleLabel} <b>*</b></span><input required maxLength={120} placeholder={t.fieldOrderTitlePlaceholder} value={orderDraft.title} onChange={e => setOrderDraft({ ...orderDraft, title: e.target.value })}/><small>{t.fieldOrderTitleHint}</small></label><label className="field"><span>{t.fieldProtocolLabel} <b>*</b></span><input required placeholder={t.fieldProtocolPlaceholder} value={orderDraft.protocol} onChange={e => setOrderDraft({ ...orderDraft, protocol: e.target.value })}/></label><label className="field"><span>{t.fieldChainLabel} <b>*</b></span><input required placeholder={t.fieldChainPlaceholder} value={orderDraft.chain} onChange={e => setOrderDraft({ ...orderDraft, chain: e.target.value })}/></label><label className="field"><span>{t.fieldAsOfLabel} <b>*</b></span><input required type="date" value={orderDraft.asOf} onChange={e => setOrderDraft({ ...orderDraft, asOf: e.target.value })}/><small>{t.fieldAsOfHint}</small></label><label className="field"><span>{t.fieldAuthorLabel} {demoMode ? '' : <b>*</b>}</span><input required={!demoMode} placeholder={demoMode ? 'demo-author' : t.fieldAuthorPlaceholderLive} value={orderDraft.author} onChange={e => setOrderDraft({ ...orderDraft, author: e.target.value })}/><small>{t.fieldAuthorHint}</small></label><label className="field span-two"><span>{t.fieldHostsLabel} <b>*</b></span><textarea required rows={3} placeholder={t.fieldHostsPlaceholder} value={orderDraft.hosts} onChange={e => setOrderDraft({ ...orderDraft, hosts: e.target.value })}/><small>{t.fieldHostsHint}</small></label><label className="field span-two"><span>{t.fieldRootsLabel}</span><textarea required={!demoMode} rows={2} placeholder={'raw.githubusercontent.com/aave/aave-v3-core/'} value={orderDraft.roots} onChange={e => setOrderDraft({ ...orderDraft, roots: e.target.value })}/><small>{t.fieldRootsHint}</small></label></div><div className="form-bottom"><p><Icon name="shield" size={16}/> {demoMode ? t.createFootDemo : t.createFootLive}</p><div><button type="button" className="outline-button" onClick={() => setPage('workspace')}>{t.btnCancel}</button><button type="submit" className="primary" disabled={!!busy || (!demoMode && (!wallet || !compat.writable))}>{t.btnSubmitCreateOrder} <Icon name="arrow" size={15}/></button></div></div></form></section>}

        {page === 'records' && <section className="records-page"><div className="form-header"><div className="eyebrow"><span className="eyebrow-line"/> RESEARCH ARCHIVE</div><h1>{t.recordsPageTitle}<span className="title-dot">.</span></h1><p>{t.recordsPageSubtitle}</p></div><div className="records-card panel"><div className="records-head"><div><h2>{t.recordsCardTitle}</h2><span>{t.recordsCountLabel(displayOrders.length)}</span></div><button className="primary" onClick={() => setPage('create')}><Icon name="plus" size={16}/> {t.btnEmptyCreate}</button></div>{displayOrders.length ? <div className="records-table"><div className="records-header"><span>{t.recordsColOrder}</span><span>{t.recordsColTarget}</span><span>{t.recordsColDate}</span><span>{t.recordsColVerdict}</span><span/></div>{displayOrders.map(order => <button className="record-row" key={order.id} onClick={() => chooseOrder(order)}><span><strong>{order.title}</strong><small>RR-{String(order.id).padStart(3, '0')} · {t.recordsRevisionsCount(order.revisions.length)}</small></span><span>{order.protocol}<small>{order.chain}</small></span><span>{displayDate(order.asOf)}</span><span><Chip text={humanStatusI18n(latest(order)?.assessment?.verdict, lang)} kind={statusClass(latest(order)?.assessment?.verdict || '')}/></span><Icon name="chevron" size={15}/></button>)}</div> : <Empty title={t.emptyRecordsTitle} body={demoMode ? t.emptyRecordsBodyDemo : t.emptyRecordsBodyLive}/>}</div></section>}

        {page === 'settings' && <section className="form-page"><div className="form-header"><div className="eyebrow"><span className="eyebrow-line"/> CONNECTION SETTINGS</div><h1>{t.settingsPageTitle}<span className="title-dot">.</span></h1><p>{t.settingsPageSubtitle}</p></div><form className="form-card settings-card" onSubmit={applySettings}><div className="form-card-head"><div className="form-step"><Icon name="settings" size={20}/></div><div><h2>{t.settingsCardTitle}</h2><p>{t.settingsCardSub}</p></div></div>{deployment.verified && deployment.publicChainDeploymentVerified && <button type="button" className="outline-button template-button" onClick={() => setSettingsDraft({ mode: 'live', rpcUrl: deployment.rpcUrl, contractAddress: deployment.contractAddress })}>{t.btnUseVerifiedBradbury}</button>}<div className="mode-options"><label className={`mode-option ${settingsDraft.mode === 'demo' ? 'chosen' : ''}`}><input type="radio" name="mode" checked={settingsDraft.mode === 'demo'} onChange={() => setSettingsDraft({ ...settingsDraft, mode: 'demo' })}/><span className="option-icon"><Icon name="spark" size={20}/></span><span><strong>{t.modeOptionDemoTitle}</strong><small>{t.modeOptionDemoDesc}</small></span><span className="radio-check"/></label><label className={`mode-option ${settingsDraft.mode === 'live' ? 'chosen' : ''}`}><input type="radio" name="mode" checked={settingsDraft.mode === 'live'} onChange={() => setSettingsDraft({ ...settingsDraft, mode: 'live' })}/><span className="option-icon"><Icon name="link" size={20}/></span><span><strong>{t.modeOptionLiveTitle}</strong><small>{t.modeOptionLiveDesc}</small></span><span className="radio-check"/></label></div>{settingsDraft.mode === 'live' && <div className="fields-grid live-fields"><label className="field span-two"><span>{t.fieldRpcLabel} <b>*</b></span><input required type="url" placeholder="https://studio.genlayer.com/api" value={settingsDraft.rpcUrl} onChange={e => setSettingsDraft({ ...settingsDraft, rpcUrl: e.target.value })}/><small>{t.fieldRpcHint}</small></label><label className="field span-two"><span>{t.fieldContractLabel} <b>*</b></span><input required placeholder="0x…" value={settingsDraft.contractAddress} onChange={e => setSettingsDraft({ ...settingsDraft, contractAddress: e.target.value })}/><small>{t.fieldContractHint}</small></label></div>}<div className="form-bottom"><p><Icon name="shield" size={16}/> {t.settingsFootNote}</p><div><button type="button" className="outline-button" onClick={() => setPage('workspace')}>{t.btnCancel}</button><button type="submit" className="primary">{t.btnSaveSettings} <Icon name="arrow" size={15}/></button></div></div></form></section>}
      </div>
    </main>
    {showSubmission && selected && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setShowSubmission(false) }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="submission-title"><div className="modal-header"><div><div className="section-kicker">NEW REVISION · RR-{String(selected.id).padStart(3, '0')}</div><h2 id="submission-title">{t.modalHeaderTitle}</h2><p>{t.modalHeaderSub}</p></div><button type="button" className="icon-button" aria-label={t.btnCloseModalAria} onClick={() => setShowSubmission(false)}><Icon name="close" size={18}/></button></div><form onSubmit={handleSubmit}><div className="modal-content">{(error || busy || notice) && <div className={`alert ${error ? 'alert-error' : ''}`} role={error ? 'alert' : 'status'}><Icon name={error ? 'warning' : busy ? 'refresh' : 'check'} size={15}/><span>{activeAlertText}</span></div>}<div className="modal-intro"><Icon name="shield" size={17}/><span>{t.modalIntroWarning}</span>{demoMode && <button type="button" onClick={() => { demoSubmission(lang).then(input => setSubmission({ ...input, reportBody: input.claims.map(claim => claim.text).join('\n') })).catch(e => setError(e instanceof Error ? e.message : String(e))) }}>{t.btnFillDemoSample}</button>}{!demoMode && selectedV6 && V6_CRITERIA.every(defaultItem => rawSelectedCriteria.some(item => item.id === defaultItem.id && JSON.stringify(item.allowed_claim_types) === JSON.stringify(defaultItem.allowed_claim_types) && JSON.stringify(item.requested_field_ids) === JSON.stringify(defaultItem.requested_field_ids))) && <button type="button" onClick={() => { setSubmission(publicV6ExampleSubmission(Boolean(rawSelected?.revisions.length), rawSelectedCriteria, lang)); setNotice('已填入固定 OpenZeppelin 代码材料的研究样例；请确认委托已允许该仓库。') }}>{t.btnFillPublicSample}</button>}</div>{!demoMode && <div className="draft-note" role="status">{t.draftNotePrefix}{!canSubmit && <> {submitBlockReason}</>}</div>}<div className="form-section-title"><span>01</span><div><strong>{t.modalSec01Title}</strong><small>{t.modalSec01Sub}</small></div></div><div className="fields-grid"><label className="field"><span>{t.fieldReportTitleLabel} <b>*</b></span><input required value={submission.reportTitle} onChange={e => setSubmission({ ...submission, reportTitle: e.target.value })} placeholder={t.fieldReportTitlePlaceholder}/></label><label className="field"><span>{t.fieldReportUrlLabel}</span><input type="url" value={submission.reportUrl} onChange={e => setSubmission({ ...submission, reportUrl: e.target.value })} placeholder="https://…"/></label><label className="field span-two"><span>{t.fieldReportBodyLabel} <b>*</b></span><textarea readOnly rows={5} value={localizedReportDisplay} placeholder={t.fieldReportBodyPlaceholder}/><small>{t.fieldReportBodyHint}</small></label></div><div className="form-section-title"><span>02</span><div><strong>{t.modalSec02Title}</strong><small>{t.modalSec02Sub}</small></div><button type="button" onClick={addSource} disabled={submission.sources.length >= 3}><Icon name="plus" size={14}/> {t.btnAddSource}</button></div>{submission.sources.map((source, i) => <div className="repeat-card" key={i}><div className="repeat-head"><strong>{t.sourceCardHeader(String(i + 1).padStart(2, '0'))}</strong>{submission.sources.length > 1 && <button type="button" onClick={() => deleteSource(i)}>{t.btnRemove}</button>}</div><div className="fields-grid"><label className="field"><span>{t.fieldSourceLabel}</span><input value={source.label} onChange={e => changeSource(i, { label: e.target.value })} placeholder={t.fieldSourceLabelPlaceholder}/></label><label className="field"><span>{t.fieldSourceDate}</span><input type="date" value={source.publishedAt} onChange={e => changeSource(i, { publishedAt: e.target.value })}/></label><label className="field span-two"><span>{t.fieldSourceUrl} <b>*</b></span><input required type="url" value={source.url} onChange={e => changeSource(i, { url: e.target.value })} placeholder={t.fieldSourceUrlPlaceholder}/><button type="button" className="hash-button" disabled={!!busy} onClick={() => hashSource(i)}>{t.btnHashSource}</button></label><label className="field"><span>SHA-256 <b>*</b></span><input required pattern="[a-fA-F0-9]{64}" value={source.sha256} onChange={e => changeSource(i, { sha256: e.target.value })} placeholder={t.fieldSourceShaPlaceholder}/></label><label className="field"><span>{t.fieldSourceBytes} <b>*</b></span><input required type="number" min="1" max="16384" value={source.byteLength || ''} onChange={e => changeSource(i, { byteLength: Number(e.target.value) })} placeholder={t.fieldSourceBytesPlaceholder}/></label></div></div>)}<div className="form-section-title"><span>03</span><div><strong>{t.modalSec03Title}</strong><small>{t.modalSec03Sub}</small></div><button type="button" disabled={submission.claims.length >= Math.min(selectedV6 ? 6 : 4, rawSelectedCriteria.length)} onClick={() => setSubmission(current => { const remaining = rawSelectedCriteria.find(option => !current.claims.some(claim => claim.criterion === option.id)); return remaining ? { ...current, claims: [...current.claims, newClaim(remaining, selectedV6)] } : current })}><Icon name="plus" size={14}/> {t.btnAddClaim}</button></div>{submission.claims.map((claim, i) => { const rawCriterion = rawSelectedCriteria.find(item => item.id === claim.criterion); const unknown = claim.claimType === 'unknown_disclosure'; const listSeparator = lang === 'en' ? ', ' : '、'; return <div className="repeat-card" key={i}><div className="repeat-head"><strong>{t.claimCardHeader(String(i + 1).padStart(2, '0'))}</strong>{submission.claims.length > 1 && <button type="button" onClick={() => setSubmission(current => ({ ...current, claims: current.claims.filter((_, j) => i !== j) }))}>{t.btnRemove}</button>}</div><div className="fields-grid"><label className="field span-two"><span>{t.fieldCriterionSelect} <b>*</b></span><select required value={claim.criterion} onChange={e => { const next = rawSelectedCriteria.find(item => item.id === e.target.value); if (next) { changeClaim(i, newClaim(next, selectedV6)); setNotice('切换标准已清空原声明，请重新填写。') } }}>{rawSelectedCriteria.map(option => <option key={option.id} value={option.id} disabled={submission.claims.some((other, index) => index !== i && other.criterion === option.id)}>{getCriterionGroupLabel(option.id, lang)}</option>)}</select></label>{selectedV6 && rawCriterion && <><p className="criterion-text span-two">{displayCriterionText(rawCriterion, lang)}</p><label className="field span-two"><span>{t.fieldDeliveryType}</span><select value={claim.claimType || ''} onChange={e => { const type = e.target.value as ClaimType; const next = { ...claim, claimType: type, text: '', sourceIndexes: type === 'unknown_disclosure' ? [] : [0], disclosureVersion: undefined, scope: undefined }; if (type === 'unknown_disclosure') next.text = renderClaimStatement(next, rawSelectedCriteria); changeClaim(i, next); setNotice(type === 'unknown_disclosure' ? '已替换原声明并清空自选来源；未知披露覆盖本次全部锁定来源。' : '已清空原声明，请填写实际内容并选择核查材料。') }}>{rawCriterion.allowed_claim_types?.map(type => <option key={type} value={type}>{type === 'unknown_disclosure' ? t.optionClaimUnknown : type === 'boundary_disclosure' ? t.optionClaimBoundary : t.optionClaimFact}</option>)}</select></label></>}<label className="field span-two"><span>{t.fieldClaimText} <b>*</b></span><textarea required rows={3} readOnly={unknown} value={unknown ? displayClaimText(claim, rawSelectedCriteria, lang) : claim.text} onChange={e => changeClaim(i, { text: e.target.value })} placeholder={t.fieldClaimTextPlaceholder}/>{unknown && <small>{t.claimUnknownHint}</small>}</label>{unknown ? <div className="field span-two"><span>{t.claimUnknownScopeLabel}</span><small>{submission.sources.map((source, index) => source.label || t.sourceFallbackLabel(index + 1)).join(listSeparator)}</small></div> : <div className="field span-two"><span>{t.fieldClaimSourcesLabel} <b>*</b></span><div className="source-checks">{submission.sources.map((source, sourceIndex) => <label key={sourceIndex}><input type="checkbox" checked={claim.sourceIndexes.includes(sourceIndex)} onChange={e => changeClaim(i, { sourceIndexes: e.target.checked ? [...claim.sourceIndexes, sourceIndex].sort((a, b) => a - b) : claim.sourceIndexes.filter(x => x !== sourceIndex) })}/>{source.label || t.sourceFallbackLabel(sourceIndex + 1)}</label>)}</div></div>}</div></div> })}</div><div className="modal-footer"><button type="button" className="outline-button" onClick={() => setShowSubmission(false)}>{t.btnCancel}</button><button type="submit" className="primary" disabled={!!busy || !canSubmit || !!reportError}>{t.modalHeaderTitle} <Icon name="arrow" size={15}/></button></div></form></div></div>}
  </div>
}

function ClaimRow({ claim, index, assessment, v6 = false, lang, compact = false }: { claim: Claim, index: number, assessment?: Assessment, v6?: boolean, lang: Language, compact?: boolean }) {
  const t = UI_TEXT[lang]
  const item = assessment?.items.find(result => result.claimId === claim.id)
  const label = findingLabelI18n(item?.status, v6, lang)
  const listSeparator = lang === 'en' ? ', ' : '、'
  const colon = lang === 'en' ? ': ' : '：'
  const formatParens = (inner: string) => lang === 'en' ? ` (${inner})` : `（${inner}）`
  return <div className={`claim-row ${compact ? 'compact' : ''}`}><span className="claim-index">{String(index + 1).padStart(2, '0')}</span><div className="claim-content"><strong>{claim.text}</strong>{!compact && <><p>{getCriterionGroupLabel(claim.criterion, lang)}</p>{v6 && claim.claimType === 'unknown_disclosure' && item && <p>{item.status === 'SOURCE_UNAVAILABLE' ? t.claimRowPendingScope : t.claimRowVerifiedScope}{colon}{(item.scopeSourceIndexes || []).map(i => t.sourceFallbackLabel(i + 1)).join(listSeparator) || t.claimRowAllLockedSources}</p>}{v6 && !!item?.basisScopeSourceIndexes?.length && <p>{t.claimRowAuthorSelectedScope}{colon}{item.basisScopeSourceIndexes.map(i => t.sourceFallbackLabel(i + 1)).join(listSeparator)}</p>}{v6 && item?.fieldChecks?.map(field => <p key={field.field_id}>{getFieldLabel(field.field_id, lang)}{colon}{field.state === 'FOUND' ? t.fieldCheckFound : t.fieldCheckNotEstablished}{field.evidence_indices.length > 0 && formatParens(field.evidence_indices.map(i => t.sourceFallbackLabel(i + 1)).join(listSeparator))}</p>)}<div className="claim-sources">{(v6 ? item?.sourceIndexes || [] : claim.sourceIndexes).map(i => <span key={i}><Icon name="link" size={12}/> {t.sourceFallbackLabel(i + 1)}</span>)}</div>{item?.reason && <div className="finding"><b title={t.findingTitleTooltip}>{assessment?.mode === 'demo' ? t.findingBadgeDemo : item.status === 'SOURCE_UNAVAILABLE' || item.status === 'MISSING' ? t.findingBadgeSourceOrDelivery : t.findingBadgeModel}</b> {item.reason}</div>}</>}</div><div className="finding-status"><Chip text={label} kind={statusClass(item?.status || '')}/>{item?.deliveryStatus && <small>{humanStatusI18n(item.deliveryStatus, lang)}</small>}</div></div>
}

export default App
