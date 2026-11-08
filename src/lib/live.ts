import { createAccount, createClient, decodeInputData } from 'genlayer-js';
import { studionet, studioDevnet, testnetBradbury } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
import { decodeFunctionData, parseAbi } from 'viem';
import type { Config } from './domain';
import feeProfile from '../fee-profile.json';
import { BRADBURY, createVerifiedBradburyClient, quoteBradburyFees, recoverBradburyEnvelope } from './bradbury';
import { consensusAccepted, executionSucceeded, executionReverted, finalizedUndetermined } from './protocol-outcome.mjs';
import deployment from '../deployment.json';
import { FIELD_CATALOG, CATALOG_VERSION, POLICY_V6 } from './field-catalog.mjs';
import { canonicalEvidenceJson, hashEvidenceJson } from './evidence-snapshot.mjs';
type Hex = `0x${string}`;
type Client = ReturnType<typeof createClient>;
type Wallet = { request: (arg: { method: string; params?: unknown[] }) => Promise<unknown> };
export interface TxEvent { hash?: string; stage: string; message: string }
const listeners = new Set<(event: TxEvent) => void>();
export const watchTransactions = (fn: (event: TxEvent) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const emit = (event: TxEvent) => listeners.forEach(fn => fn(event));
const RPCS = { 'https://studio.genlayer.com/api': studionet, 'https://studio-dev.genlayer.com/api': studioDevnet };
let devSession: { account: ReturnType<typeof createAccount>; client: Client } | null = null;
export const getDevSessionAddress = () => devSession?.account.address || null;
export async function connectDevSession(config: Config): Promise<string> {
  if (config.mode !== 'live' || config.rpcUrl.replace(/\/$/, '') !== 'https://studio-dev.genlayer.com/api') throw new Error('临时测试账户仅支持官方 Studio-dev，不支持主网或自定义网络。');
  if (devSession) return devSession.account.address;
  const account = createAccount();
  const client = createClient({ chain: studioDevnet, endpoint: 'https://studio-dev.genlayer.com/api', account });
  if (await client.getChainId() !== 61997) throw new Error('开发网身份不匹配，已停止。');
  emit({ stage: 'funding', message: '正在为独立临时账户领取官方 Studio 测试 GEN。' });
  const response = await fetch('https://studio-dev.genlayer.com/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sim_fundAccount', params: [account.address, 10000000000000000000] }), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error('开发水龙头暂不可用，请稍后重试或连接自己的测试钱包。');
  if (await client.getBalance({ address: account.address }) <= 0n) throw new Error('未确认测试余额，未启用临时账户。');
  devSession = { account, client };
  emit({ stage: 'ready', message: '临时开发账户已就绪。密钥仅在本页内存中，刷新后将丢失写入权限。' });
  return account.address;
}
function network(config: Config) {
  const chain = RPCS[config.rpcUrl.replace(/\/$/, '') as keyof typeof RPCS];
  if (!chain) throw new Error('仅支持官方 Studionet、Studio-dev 或经过 Phase 2 验证的 Bradbury RPC。');
  return chain;
}
function provider() {
  const value = (window as unknown as { ethereum?: { request: (arg: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!value) throw new Error('未检测到浏览器钱包。示例演练无需钱包；链上写入需安装并连接 EIP-1193 钱包。');
  return value;
}
export async function connectWallet(): Promise<string> {
  const accounts = await provider().request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts?.[0]) throw new Error('钱包未返回账户。');
  devSession = null;
  return accounts[0];
}
export async function getClient(config: Config): Promise<Client> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(config.contractAddress)) throw new Error('请在接入设置填写已部署的 ResearchReceipt 合约地址。');
  if (config.rpcUrl.replace(/\/$/, '') === BRADBURY.rpcUrl) return createVerifiedBradburyClient();
  return createClient({ chain: network(config), endpoint: config.rpcUrl });
}
const ADD_TRANSACTION_ABI = parseAbi([
  'function addTransaction((address sender,address recipient,uint256 numOfInitialValidators,uint256 maxRotations,uint256 validUntil,uint256 saltNonce,uint256 userValue,(uint256 leaderTimeunitsAllocation,uint256 validatorTimeunitsAllocation,uint256 appealRounds,uint256 executionBudgetPerRound,uint256 executionConsumed,uint256 totalMessageFees,uint256[] rotations,uint256 maxPriceGenPerTimeUnit,uint256 storageFeeMaxGasPrice,uint256 receiptFeeMaxGasPrice) feesDistribution,bytes txCalldata,(uint8 messageType,bool onAcceptance,uint256 parentIndex,address recipient,bytes32 callKey,uint256 budget,bytes feeParams)[] messageAllocations) _params) payable',
]);
const BRADBURY_FALLBACK_GAS = 200000n;
const BRADBURY_MAX_TX_GAS = 32000000n;
const BRADBURY_MAX_FEE_VALUE_WEI = 50000000000000000n;
interface SendState { attempted: boolean; guardRejected: boolean; userRejected: boolean; providerOnlyRoute: boolean; consensusMainAddress?: string; expectedFeeValue?: bigint; envelopeHash?: Hex; protocolHash?: Hex; intentId?: string }
function matchesCallPayload(decoded: ReturnType<typeof decodeInputData>, functionName: string, expectedArgs: (string | number)[]) {
  if (!decoded || decoded.type !== 'call' || decoded.leaderOnly !== false || !('callData' in decoded) || !decoded.callData) return false;
  const call = decoded.callData;
  const keys = call instanceof Map ? [...call.keys()] : Object.keys(call as Record<string, unknown>);
  if (!keys.every(key => key === '' || key === 'args' || key === 'kwargs')) return false;
  const field = (key: string) => call instanceof Map ? call.get(key) : (call as Record<string, unknown>)[key];
  const kwargs = field('kwargs');
  const emptyKwargs = kwargs === undefined || (kwargs instanceof Map ? kwargs.size === 0 : typeof kwargs === 'object' && kwargs !== null && !Array.isArray(kwargs) && Object.keys(kwargs).length === 0);
  if (!emptyKwargs) return false;
  const args = field('args') || [];
  return field('') === functionName && Array.isArray(args) && args.length === expectedArgs.length && expectedArgs.every((expected, index) => typeof expected === 'number' ? Number.isSafeInteger(expected) && (typeof args[index] === 'bigint' ? args[index] === BigInt(expected) : args[index] === expected) : args[index] === expected);
}
async function walletIdentity(wallet: Wallet, account: string, chainId: number, bradbury: boolean) {
  if (Number(await wallet.request({ method: 'eth_chainId' })) !== chainId) throw new Error(`请在钱包中切换到正确测试网络（Chain ID ${chainId}）后重试。`);
  if (bradbury) {
    const genesis = await wallet.request({ method: 'eth_getBlockByNumber', params: ['0x0', false] }) as { hash?: string } | null;
    if (genesis?.hash?.toLowerCase() !== BRADBURY.genesisHash) throw new Error('钱包所连 Bradbury genesis 不匹配，可能仍为旧 Phase 1。请核对官方 Phase 2 RPC。');
  }
  const accounts = await wallet.request({ method: 'eth_accounts' }) as string[];
  if (!Array.isArray(accounts) || accounts[0]?.toLowerCase() !== account.toLowerCase()) throw new Error('钱包当前账户已变化，未发送交易。请重新连接并核对账户。');
}
function guardedProvider(wallet: Wallet, config: Config, account: string, chainId: number, state: SendState): Wallet {
  return { request: async request => {
    if (!['eth_sendTransaction', 'eth_signTransaction'].includes(request.method)) return wallet.request(request);
    try {
      if (state.attempted) throw new Error('本次发送结果尚未确认，不会再次请求钱包发送或签名。');
      const bradbury = canonicalRpc(config) === BRADBURY.rpcUrl;
      await walletIdentity(wallet, account, chainId, bradbury);
      const intent = getPendingTransaction(config);
      if (!intent || intent.conflict || intent.intentId !== state.intentId || intent.account?.toLowerCase() !== account.toLowerCase() || !intent.args) throw new Error('缺少可核对的发送意图，未发送交易。');
      if (intent.envelopeHash) throw new Error('钱包已返回 EVM 交易哈希，不会重复发送。请恢复追踪。');
      const tx = request.params?.[0] as { from?: string; to?: string; data?: string; value?: string | number | bigint; gas?: string | number | bigint; chainId?: string | number } | undefined;
      if (!state.consensusMainAddress || tx?.from?.toLowerCase() !== account.toLowerCase() || tx.to?.toLowerCase() !== state.consensusMainAddress.toLowerCase() || (tx.chainId !== undefined && Number(tx.chainId) !== chainId) || typeof tx.data !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(tx.data)) throw new Error('钱包发送参数与已连接账户、共识入口合约或网络不一致。');
      let txValue: bigint;
      try { txValue = tx.value === undefined ? 0n : BigInt(tx.value); }
      catch { throw new Error('钱包发送金额格式无效。'); }
      if (state.expectedFeeValue === undefined || txValue !== state.expectedFeeValue || (bradbury && txValue > BRADBURY_MAX_FEE_VALUE_WEI)) throw new Error('钱包发送金额与已报价协议费用不一致或超出测试费用上限。');
      let envelopeParams: { sender: string; recipient: string; userValue: bigint; txCalldata: Hex };
      try {
        const parsed = decodeFunctionData({ abi: ADD_TRANSACTION_ABI, data: tx.data as Hex });
        if (parsed.functionName !== 'addTransaction') throw new Error('unexpected selector');
        envelopeParams = parsed.args[0];
      } catch { throw new Error('钱包发送载荷不是合法的 GenLayer addTransaction 调用。'); }
      const decodedApp = decodeInputData(envelopeParams.txCalldata, envelopeParams.recipient as Hex);
      if (envelopeParams.sender.toLowerCase() !== account.toLowerCase() || envelopeParams.recipient.toLowerCase() !== config.contractAddress.toLowerCase() || envelopeParams.userValue !== 0n || !matchesCallPayload(decodedApp, intent.functionName, intent.args)) throw new Error('钱包发送参数与已连接账户、目标合约或方法参数不一致。');
      if (bradbury) {
        if (tx.gas === undefined) throw new Error('Bradbury 交易缺少显式 gas 上限，已阻止发送。');
        let gas: bigint;
        try { gas = BigInt(tx.gas); }
        catch { throw new Error('Bradbury 交易 gas 格式无效，已阻止发送。'); }
        if (gas <= BRADBURY_FALLBACK_GAS || gas > BRADBURY_MAX_TX_GAS) throw new Error('Bradbury 交易气费估算异常或超出单笔上限（32,000,000 gas），已阻止发送。');
      }
    } catch (error) { state.guardRejected = true; throw error; }
    state.attempted = true;
    try {
      const result = await wallet.request(request);
      if (request.method === 'eth_sendTransaction' && typeof result === 'string' && /^0x[0-9a-fA-F]{64}$/.test(result)) {
        // Studio uses the wallet's returned hash as its protocol transaction ID.
        // Public Bradbury returns a distinct EVM envelope hash instead.
        const studio = !!RPCS[canonicalRpc(config) as keyof typeof RPCS];
        if (studio) state.protocolHash = result as Hex;
        else state.envelopeHash = result as Hex;
        const intent = getPendingTransaction(config);
        if (intent && !intent.conflict && intent.intentId === state.intentId) savePending(config, { ...intent, kind: studio ? 'protocol' : 'envelope', hash: result, ...(studio ? {} : { envelopeHash: result as Hex }) });
        emit({ hash: result, stage: studio ? 'submitted' : 'attention', message: studio ? 'Studio 已返回协议交易 ID，正在等待最终状态。请勿重复提交。' : '钱包已返回 EVM 交易哈希，正在等待协议交易 ID。请勿重复提交。' });
      }
      return result;
    } catch (error) { if (isUserRejection(error)) state.userRejected = true; throw error; }
  } };
}
async function writable(config: Config) {
  const sendState: SendState = { attempted: false, guardRejected: false, userRejected: false, providerOnlyRoute: false };
  if (devSession && config.mode === 'live' && config.rpcUrl.replace(/\/$/, '') === 'https://studio-dev.genlayer.com/api') return { client: devSession.client, account: devSession.account.address, sendState };
  const wallet = provider();
  const account = await connectWallet();
  // In pinned rc.2, a string account signs/sends exclusively through this
  // injected provider. Local Studio keys can broadcast raw RPC transactions,
  // so their untouched sendState cannot prove that nothing was submitted.
  sendState.providerOnlyRoute = true;
  const chainId = await wallet.request({ method: 'eth_chainId' });
  if (config.rpcUrl.replace(/\/$/, '') === BRADBURY.rpcUrl) {
    if (Number(chainId) !== BRADBURY.chainId) throw new Error('请在钱包中切换到 Bradbury Phase 2（Chain ID 4221）后重试。');
    const walletGenesis = await wallet.request({ method: 'eth_getBlockByNumber', params: ['0x0', false] }) as { hash?: string } | null;
    if (walletGenesis?.hash?.toLowerCase() !== BRADBURY.genesisHash) throw new Error('钱包所连 Bradbury genesis 不匹配，可能仍为旧 Phase 1。请核对官方 Phase 2 RPC。');
    const guarded = guardedProvider(wallet, config, account, BRADBURY.chainId, sendState);
    const client = await createVerifiedBradburyClient({ account: account as Hex, provider: guarded as unknown as NonNullable<Parameters<typeof createClient>[0]>['provider'] });
    sendState.consensusMainAddress = client.chain?.consensusMainContract?.address || testnetBradbury.consensusMainContract?.address;
    return { client, account, sendState };
  }
  const chain = network(config);
  if (Number(chainId) !== chain.id) throw new Error(`请在钱包中切换到 ${chain.name}（Chain ID ${chain.id}）后重试。应用不会自动添加未知网络。`);
  sendState.consensusMainAddress = chain.consensusMainContract?.address;
  const guarded = guardedProvider(wallet, config, account, chain.id, sendState);
  const client = createClient({ chain, endpoint: config.rpcUrl, account: account as Hex, provider: guarded as unknown as NonNullable<Parameters<typeof createClient>[0]>['provider'] });
  return { client, account, sendState };
}
function readError(error: unknown): never {
  if (/contract not found/i.test(String((error as { shortMessage?: string; message?: string })?.shortMessage || (error as Error)?.message || error))) throw new Error('当前网络未找到此合约，请核对网络和合约地址。');
  throw error;
}
export type SessionRead = (functionName: string, args?: (string | number)[]) => Promise<unknown>;
export async function withReadSession<T>(config: Config, operation: (read: SessionRead) => Promise<T>): Promise<T> {
  // One action gets one freshly verified client. No client or verification is
  // cached between actions, and the callback never receives a writable client.
  const snapshot = { ...config };
  const client = await getClient(snapshot).catch(readError);
  let active = true;
  const sessionRead: SessionRead = async (functionName, args = []) => {
    if (!active) throw new Error('只读会话已结束，请重新读取以核验当前网络。');
    try { return await client.readContract({ address: snapshot.contractAddress as Hex, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL }); }
    catch (error) { return readError(error); }
  };
  try { return await operation(sessionRead); }
  finally { active = false; }
}
export async function read(config: Config, functionName: string, args: (string | number)[] = []) {
  return withReadSession(config, reader => reader(functionName, args));
}
export interface WriteCompatibility { writable: boolean; reason: string; policyVersion?: string; catalogVersion?: string; catalogHash?: string; releaseId?: string }
type VerifiedRelease = { verified?: boolean; policyVersion?: string; sourceVerified?: boolean; sourceSha256?: string; rpcUrl?: string; contractAddress?: string; chainId?: number; genesisHash?: string; catalogHash?: string };
export async function checkV6WriteCompatibility(config: Config, reader: SessionRead, release: VerifiedRelease = deployment): Promise<WriteCompatibility> {
  let policyVersion: unknown, catalog: unknown;
  try {
    const results = await Promise.all([reader('get_policy_version'), reader('get_field_catalog')]);
    policyVersion = results[0];
    catalog = typeof results[1] === 'string' ? JSON.parse(results[1]) : results[1];
  } catch { return { writable: false, reason: '合约缺少可核验的 V6 政策或字段目录；当前仅可读取。' }; }
  if (policyVersion !== POLICY_V6) return { writable: false, reason: '此合约政策不是本客户端支持的 V6；当前仅可读取。', ...(typeof policyVersion === 'string' ? { policyVersion } : {}) };
  try { if (canonicalEvidenceJson(catalog) !== canonicalEvidenceJson(FIELD_CATALOG)) throw new Error('catalog mismatch'); }
  catch { return { writable: false, reason: '合约字段目录与客户端完整目录不一致；当前仅可读取。', policyVersion }; }
  const catalogHash = await hashEvidenceJson(catalog);
  const result = { policyVersion, catalogVersion: CATALOG_VERSION, catalogHash };
  const publicNetwork = canonicalRpc(config) === BRADBURY.rpcUrl;
  if (release.verified !== true || release.sourceVerified !== true || release.policyVersion !== POLICY_V6 || !/^[a-f0-9]{64}$/.test(release.sourceSha256 || '') || release.rpcUrl?.replace(/\/+$/, '') !== canonicalRpc(config) || release.contractAddress?.toLowerCase() !== config.contractAddress.toLowerCase() || release.catalogHash !== catalogHash || (publicNetwork && (release.chainId !== BRADBURY.chainId || release.genesisHash?.toLowerCase() !== BRADBURY.genesisHash))) return { ...result, writable: false, reason: 'V6 接口匹配，但此网络与地址尚未绑定独立源码验证的发布记录；当前仅可读取。' };
  return { ...result, writable: true, reason: 'V6 政策、完整字段目录及独立源码验证发布记录匹配。', releaseId: release.sourceSha256 };
}
export async function getWriteCompatibility(config: Config): Promise<WriteCompatibility> {
  if (config.mode !== 'live') return { writable: false, reason: '本地演练不发送链上交易。' };
  try { return await withReadSession(config, reader => checkV6WriteCompatibility(config, reader)); }
  catch (error) { return { writable: false, reason: error instanceof Error ? error.message : '无法核验合约，当前仅可读取。' }; }
}
const canonicalRpc = (config: Config) => config.rpcUrl.replace(/\/+$/, '');
const keyForRpc = (config: Config, rpc: string) => `rr:pending:v1:${rpc}:${config.contractAddress.toLowerCase()}`;
const pendingKey = (config: Config) => keyForRpc(config, canonicalRpc(config));
const pendingKeys = (config: Config) => [...new Set([pendingKey(config), keyForRpc(config, `${canonicalRpc(config)}/`), keyForRpc(config, config.rpcUrl)])];
interface Operation { clientRef?: string; orderId?: number; revision?: number; policyVersion?: string; catalogHash?: string; releaseId?: string }
export interface Pending extends Operation { hash: string; functionName: string; submittedAt: string; kind?: 'protocol' | 'envelope' | 'submission-uncertain' | 'final-undetermined'; envelopeHash?: Hex; account?: string; conflict?: boolean; intentId?: string; args?: (string | number)[]; envelopeEvidence?: { envelopeHash: Hex; blockHash: Hex; blockNumber: Hex }; terminalEvidence?: Record<string, unknown> }
const savePending = (config: Config, pending: Pending) => localStorage.setItem(pendingKey(config), JSON.stringify(pending));
const clearPending = (config: Config) => pendingKeys(config).forEach(key => localStorage.removeItem(key));
const isUserRejection = (error: unknown): boolean => {
  let item = error as { code?: number; cause?: unknown } | null;
  for (let depth = 0; item && depth < 8; depth++, item = item.cause as typeof item) if (item.code === 4001) return true;
  return false;
};
export const getPendingTransaction = (config: Config): Pending | null => {
  const blocked: Pending = { hash: '', kind: 'submission-uncertain', functionName: 'unknown', submittedAt: '', conflict: true };
  try {
    const records = pendingKeys(config).map(key => ({ key, raw: localStorage.getItem(key) })).filter(item => item.raw !== null).map(item => ({ key: item.key, value: JSON.parse(item.raw!) as Pending }));
    if (!records.length) return null;
    if (records.some(({ value }) => !value || typeof value.hash !== 'string' || typeof value.functionName !== 'string')) return blocked;
    const first = records[0].value;
    const conflict = records.some(({ value }) => value.hash !== first.hash || (value.kind || 'protocol') !== (first.kind || 'protocol') || value.clientRef !== first.clientRef || value.functionName !== first.functionName || value.account !== first.account || value.intentId !== first.intentId || (!value.hash && value.submittedAt !== first.submittedAt));
    if (conflict) return { ...first, conflict: true };
    // Persist before removing a legacy key. Conflicting records are never overwritten.
    savePending(config, first);
    records.filter(item => item.key !== pendingKey(config)).forEach(item => localStorage.removeItem(item.key));
    return first;
  } catch { return blocked; }
};
async function settleUndetermined(client: Client, config: Config, result: Awaited<ReturnType<Client['getTransaction']>>, hash: Hex): Promise<never> {
  const pending = getPendingTransaction(config);
  const terminal: Record<string, unknown> = { protocolTxId: hash, status: result.statusName, consensusOutcome: (result.lifecycle as { outcome?: string } | undefined)?.outcome, consensusResult: result.resultName || result.result, execution: result.txExecutionResultName, observedAt: new Date().toISOString(), identityVerified: false, confirmedNotApplied: false };
  const retained = (reason: string): never => { throw Object.assign(new Error(`此交易已最终结束但未形成共识。${reason}已保留交易 ID，禁止自动重发；请恢复追踪或核对最终状态。`), { consensusUnconfirmed: true }); };
  if (!pending || pending.conflict || pending.hash.toLowerCase() !== hash.toLowerCase()) return retained('待处理记录缺失或冲突。');
  const stillOwnsIntent = () => { const current = getPendingTransaction(config); return !!current && !current.conflict && current.hash === pending.hash && current.intentId === pending.intentId; };
  savePending(config, { ...pending, kind: 'final-undetermined', terminalEvidence: terminal });
  if (!pending.account || !pending.args) return retained('原记录缺少验证发送者或参数所需的上下文。');
  const tx = result as unknown as { txId?: string; hash?: string; tx_id?: string; sender?: string; recipient?: string; txDataDecoded?: { type?: string; callData?: unknown }; tx_data?: string };
  const observedHash = tx.txId || tx.hash || tx.tx_id;
  let decoded = tx.txDataDecoded;
  if (!decoded && typeof tx.tx_data === 'string') decoded = decodeInputData((tx.tx_data.startsWith('0x') ? tx.tx_data : `0x${tx.tx_data}`) as Hex, tx.recipient as Hex) ?? undefined;
  const call = decoded?.type === 'call' ? decoded.callData : null;
  const field = (key: string) => call instanceof Map ? call.get(key) : (call as Record<string, unknown> | null)?.[key];
  const args = field('args') || [];
  const sameArgs = Array.isArray(args) && args.length === pending.args.length && pending.args.every((expected, index) => typeof expected === 'number' ? Number.isSafeInteger(expected) && (typeof args[index] === 'bigint' ? args[index] === BigInt(expected) : args[index] === expected) : args[index] === expected);
  if (observedHash?.toLowerCase() !== hash.toLowerCase() || tx.sender?.toLowerCase() !== pending.account.toLowerCase() || tx.recipient?.toLowerCase() !== config.contractAddress.toLowerCase() || field('') !== pending.functionName || !sameArgs) return retained('协议交易身份、方法或参数尚未核对一致。');
  terminal.identityVerified = true;
  const readbacks: { method: string; args: (string | number)[]; value: unknown }[] = [];
  const view = async (method: string, args: (string | number)[]) => {
    const value = await client.readContract({ address: config.contractAddress as Hex, functionName: method, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
    readbacks.push({ method, args, value }); return value;
  };
  let notApplied = false;
  try {
    if (pending.functionName === 'create_order') {
      const submitted = JSON.parse(String(pending.args[0]));
      if (!pending.clientRef || submitted.client_ref !== pending.clientRef) return retained('创建引用缺少或不匹配。');
      notApplied = await view('get_order_id', [pending.clientRef]) === 0;
    } else if (pending.functionName === 'submit_revision' || pending.functionName === 'evaluate' || pending.functionName === 'verify_evidence') {
      const orderId = pending.orderId; const revision = pending.revision;
      if (!orderId || !revision || pending.args[0] !== orderId || (pending.functionName !== 'submit_revision' && pending.args[1] !== revision)) return retained('订单或目标版本上下文不足。');
      const rawOrder = await view('get_order', [orderId]);
      const order = typeof rawOrder === 'string' ? JSON.parse(rawOrder) : rawOrder as { id?: number; revision_count?: number; status?: string };
      if (order?.id !== orderId) return retained('最终订单身份不匹配。');
      if (pending.functionName === 'submit_revision') notApplied = order.revision_count === revision - 1;
      else if (pending.functionName === 'verify_evidence') notApplied = ['research-receipt/5', POLICY_V6].includes(order.policy_version) && order.revision_count === revision && order.status === 'SUBMITTED' && await view('get_evidence_snapshot', [orderId, revision]) === '';
      else notApplied = order.revision_count === revision && order.status === 'SUBMITTED' && await view('get_assessment', [orderId, revision]) === '';
    }
  } catch (error) {
    if (error instanceof Error && 'consensusUnconfirmed' in error) throw error;
    terminal.readbacks = readbacks;
    if (stillOwnsIntent()) savePending(config, { ...pending, kind: 'final-undetermined', terminalEvidence: terminal });
    return retained('最终状态读取失败或返回了无法验证的数据。');
  }
  terminal.readbacks = readbacks;
  terminal.confirmedNotApplied = notApplied;
  const current = getPendingTransaction(config);
  if (!current || current.conflict || current.hash !== pending.hash || current.intentId !== pending.intentId) return retained('读取期间待处理记录发生冲突。');
  if (!notApplied) { savePending(config, { ...pending, kind: 'final-undetermined', terminalEvidence: terminal }); return retained('最终状态已变化、已有对应记录或无法证明本次操作未落盘。请先读取当前状态，不能将已有记录归因于此交易。'); }
  localStorage.setItem(`${pendingKey(config)}:terminal:${hash}`, JSON.stringify({ pending, terminal }));
  clearPending(config);
  throw Object.assign(new Error('此交易未形成协议共识。已独立核对最新最终状态，确认对应操作未落盘，并归档终态证据。再次操作将创建新交易并重新支付测试网费用；应用不会自动重试。'), { consensusUnconfirmed: true });
}
async function finalize(client: Client, config: Config, hash: Hex) {
  emit({ hash, stage: 'submitted', message: '交易已提交。等待协议最终状态，请勿重复发起。' });
  try {
    let result;
    for (let attempt = 0; attempt < 80; attempt++) {
      result = await client.getTransaction({ hash: hash as Parameters<Client['getTransaction']>[0]['hash'] });
      if (result.statusName === 'CANCELED') {
        clearPending(config);
        throw new Error('交易已确认取消，没有执行。可检查原因后重新发起。');
      }
      if (result.statusName === 'FINALIZED') break;
      result = undefined;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    if (!result) throw new Error('等待最终状态超时，请恢复追踪此交易。');
    if (!consensusAccepted(result)) {
      if (finalizedUndetermined(result)) return await settleUndetermined(client, config, result, hash);
      throw Object.assign(new Error(`交易已最终结束，但未形成可确认的协议共识（${(result.lifecycle as { outcome?: string } | undefined)?.outcome || 'unknown'} / ${result.resultName || result.result || 'unknown'}）。不能视为执行成功或已确认回滚；已保留交易 ID，禁止自动重发。`), { consensusUnconfirmed: true });
    }
    if (!executionSucceeded(result)) {
      if (executionReverted(result)) clearPending(config);
      throw new Error(`交易未成功执行：${result.statusName} / ${result.txExecutionResultName}${getPendingTransaction(config) ? '。执行结果尚未确认，已保留交易 ID，禁止重发。' : ''}`);
    }
    const operation = getPendingTransaction(config);
    localStorage.setItem(`${pendingKey(config)}:completed`, JSON.stringify(operation));
    clearPending(config);
    let orderId = operation?.orderId;
    if (operation?.clientRef) {
      try { orderId = Number(await client.readContract({ address: config.contractAddress as Hex, functionName: 'get_order_id', args: [operation.clientRef], transactionHashVariant: TransactionHashVariant.LATEST_FINAL })); } catch { /* The completed operation keeps its reference for manual recovery. */ }
    }
    emit({ hash, stage: 'finalized', message: orderId ? `已确认执行成功。订单 #${orderId}，请重新读取该订单查看记录。` : `已确认最终状态及执行成功。创建引用：${operation?.clientRef || '无'}。` });
    return hash;
  } catch (error) {
    emit({ hash, stage: 'attention', message: error instanceof Error && 'consensusUnconfirmed' in error ? error.message : getPendingTransaction(config) ? '追踪中断或结果尚未确认。请恢复追踪，不要重复提交。' : String(error) });
    throw error;
  }
}
export async function resumePendingTransaction(config: Config) {
  const pending = getPendingTransaction(config);
  if (!pending) throw new Error('当前网络与合约没有待恢复交易。');
  if (pending.conflict) throw new Error('发现冲突或不可读的待处理记录，已保留原记录并禁止重发。请先人工核对。');
  if (pending.kind === 'envelope' || pending.kind === 'submission-uncertain' || !/^0x[0-9a-fA-F]{64}$/.test(pending.hash)) {
    if (canonicalRpc(config) === BRADBURY.rpcUrl && pending.envelopeHash && pending.account && pending.args) {
      const client = await getClient(config);
      const recovery = await recoverBradburyEnvelope(client, { envelopeHash: pending.envelopeHash, account: pending.account, contractAddress: config.contractAddress, method: pending.functionName, args: pending.args });
      const current = getPendingTransaction(config);
      if (!current || current.conflict || current.intentId !== pending.intentId || current.envelopeHash !== pending.envelopeHash) throw new Error('恢复期间待处理记录发生冲突，已保留原记录，请人工核对。');
      if (recovery.kind === 'protocol') {
        savePending(config, { ...pending, kind: 'protocol', hash: recovery.hash, envelopeEvidence: recovery.evidence });
        return finalize(client, config, recovery.hash);
      }
      if (recovery.kind === 'reverted') {
        localStorage.setItem(`${pendingKey(config)}:reverted`, JSON.stringify({ ...pending, envelopeEvidence: recovery.evidence }));
        clearPending(config);
        throw new Error('已确认此 EVM 交易回滚，未创建协议调用。原记录已归档，可检查原因后重新发起。');
      }
      throw new Error(`${recovery.reason} 已保留 EVM 哈希及发送意图，请稍后恢复追踪，勿重复提交。`);
    }
    emit({ hash: pending.envelopeHash, stage: 'attention', message: '发送结果尚未确认。EVM 哈希不等于协议交易 ID；请核对钱包、区块浏览器及协议事件，确认前禁止重发。' });
    throw new Error(`发送结果尚未确认，已保留记录并禁止重发。${pending.envelopeHash ? ` EVM 哈希：${pending.envelopeHash}` : ' 钱包未返回可追踪哈希，仍可能已经广播。'}请人工核对后恢复协议追踪。`);
  }
  return finalize(await getClient(config), config, pending.hash as Hex);
}
export async function write(config: Config, functionName: string, args: (string | number)[], context: Operation = {}) {
  config = { ...config };
  if (getPendingTransaction(config)) throw new Error('存在尚未确认的交易，请先恢复追踪。');
  const { client, account, sendState } = await writable(config);
  const compatibility = await checkV6WriteCompatibility(config, (functionName, args = []) => client.readContract({ address: config.contractAddress as Hex, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL }));
  if (!compatibility.writable) throw new Error(compatibility.reason);
  if (context.policyVersion !== undefined && context.policyVersion !== POLICY_V6) throw new Error('旧政策订单仅供读取，不能发送新交易。');
  context = { ...context, policyVersion: POLICY_V6, catalogHash: compatibility.catalogHash, releaseId: compatibility.releaseId };
  const call = { address: config.contractAddress as Hex, functionName, args };
  if (!feeProfile.methods.includes(functionName)) throw new Error('此方法没有经过开发费用配置。');
  emit({ stage: 'estimating', message: '正在按开发费用配置与当前网络价格报价；未用预算将在最终结算后退还。' });
  const estimate = config.rpcUrl.replace(/\/$/, '') === BRADBURY.rpcUrl ? await quoteBradburyFees(client) : await client.estimateTransactionFees({ leaderTimeunitsAllocation: BigInt(feeProfile.leaderTimeunitsAllocation), validatorTimeunitsAllocation: BigInt(feeProfile.validatorTimeunitsAllocation), executionBudgetPerRound: BigInt(feeProfile.executionBudgetPerRound), appealRounds: BigInt(feeProfile.appealRounds) });
  emit({ stage: 'signing', message: '请在钱包核对费用并签署此次测试网调用。' });
  if (getPendingTransaction(config)) throw new Error('存在尚未确认的交易，请先恢复追踪。');
  const intent: Pending = { hash: '', kind: 'submission-uncertain', functionName, args, submittedAt: new Date().toISOString(), account, intentId: crypto.randomUUID(), ...context };
  sendState.intentId = intent.intentId;
  sendState.expectedFeeValue = BigInt(estimate.feeValue);
  savePending(config, intent); // Must succeed before SDK signing/broadcast can begin.
  let hash: Hex;
  try {
    hash = await client.writeContract({ ...call, fees: { distribution: estimate.distribution, feeValue: estimate.feeValue } }) as Hex;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('RPC 未返回有效协议交易 ID。');
  } catch (error) {
    const current = getPendingTransaction(config);
    const ownIntent = !!current && !current.conflict && current.intentId === intent.intentId;
    if (ownIntent && ((!sendState.attempted && (sendState.guardRejected || sendState.providerOnlyRoute)) || (sendState.userRejected && !sendState.envelopeHash && !sendState.protocolHash))) clearPending(config);
    else {
      if (!current || ownIntent) savePending(config, { ...intent, ...(sendState.protocolHash ? { kind: 'protocol', hash: sendState.protocolHash } : sendState.envelopeHash ? { kind: 'envelope', hash: sendState.envelopeHash, envelopeHash: sendState.envelopeHash } : {}) });
      emit({ hash: sendState.protocolHash || sendState.envelopeHash, stage: 'attention', message: sendState.protocolHash ? '已取得 Studio 协议交易 ID，回执追踪中断。请恢复追踪，勿重复提交。' : '发送或回执追踪中断，已保留不确定记录。交易可能已经广播，请勿重复提交。' });
    }
    throw error;
  }
  const current = getPendingTransaction(config);
  if (!current || current.conflict || current.intentId !== intent.intentId) {
    emit({ hash, stage: 'attention', message: '已取得协议交易 ID，但待处理记录发生冲突。请保存此 ID 并人工核对，禁止重发。' });
    throw new Error(`待处理记录冲突，协议交易 ID：${hash}。原记录已保留，请人工核对。`);
  }
  savePending(config, { ...intent, hash, kind: 'protocol', ...(sendState.envelopeHash ? { envelopeHash: sendState.envelopeHash } : {}) });
  return finalize(client, config, hash);
}
