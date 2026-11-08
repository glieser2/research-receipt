import { beforeEach, describe, it, expect, vi } from 'vitest';
const mock = vi.hoisted(()=>({ createClient:vi.fn(), getTransaction:vi.fn(), readContract:vi.fn(), estimateTransactionFeesForWrite:vi.fn(), estimateTransactionFees:vi.fn(), writeContract:vi.fn() }));
const bradbury = vi.hoisted(()=>({ createClient:vi.fn(), quote:vi.fn(), recover:vi.fn() }));
const release = vi.hoisted(() => ({ verified:true, sourceVerified:true, policyVersion:'research-receipt/6', sourceSha256:'1'.repeat(64), rpcUrl:'https://studio-dev.genlayer.com/api', contractAddress:'0x'+'a'.repeat(40), chainId:4221, genesisHash:'0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4', catalogHash:'' }));
vi.mock('../deployment.json', () => ({ default: release }));
vi.mock('genlayer-js', async importOriginal => {
  const actual = await importOriginal<typeof import('genlayer-js')>();
  return { ...actual, createClient: (options: unknown) => { mock.createClient(options); return mock; }, isSuccessful: (r: { txExecutionResultName: string }) => r.txExecutionResultName === 'FINISHED_WITH_RETURN' };
});
vi.mock('./bradbury',()=>({BRADBURY:{rpcUrl:'https://rpc-bradbury.genlayer.com',chainId:4221,genesisHash:'0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4'},createVerifiedBradburyClient:bradbury.createClient,quoteBradburyFees:bradbury.quote,recoverBradburyEnvelope:bradbury.recover}));
import { abi } from 'genlayer-js';
import { studioDevnet, testnetBradbury } from 'genlayer-js/chains';
import { encodeFunctionData, parseAbi } from 'viem';
import { checkV6WriteCompatibility, connectDevSession, getPendingTransaction, read, resumePendingTransaction, watchTransactions, withReadSession, write, type SessionRead } from './live';
import { FIELD_CATALOG, POLICY_V6 } from './field-catalog.mjs';
import { hashEvidenceJson } from './evidence-snapshot.mjs';
class MemoryStorage { values = new Map<string,string>(); getItem(k:string){return this.values.get(k)??null} setItem(k:string,v:string){this.values.set(k,v)} removeItem(k:string){this.values.delete(k)} }
const config={mode:'live' as const,rpcUrl:'https://studio-dev.genlayer.com/api',contractAddress:'0x'+'a'.repeat(40)};
const hash='0x'+'b'.repeat(64);
const key=`rr:pending:v1:${config.rpcUrl}:${config.contractAddress}`;
function pending(){localStorage.setItem(key,JSON.stringify({hash,functionName:'create_order',submittedAt:'2026-11-05',clientRef:'recover-this-order'}));}
beforeEach(async()=>{vi.resetAllMocks();vi.stubGlobal('localStorage',new MemoryStorage());release.rpcUrl=config.rpcUrl;release.sourceVerified=true;release.catalogHash=await hashEvidenceJson(FIELD_CATALOG);mock.readContract.mockImplementation(async ({functionName}:{functionName:string}) => functionName==='get_policy_version'?POLICY_V6:functionName==='get_field_catalog'?JSON.stringify(FIELD_CATALOG):undefined);});
describe('V6 release and catalog write gate', () => {
  const reader = async (name: string) => name === 'get_policy_version' ? POLICY_V6 : JSON.stringify(FIELD_CATALOG);
  async function releaseFor(selected = config) { return { verified:true,sourceVerified:true,policyVersion:POLICY_V6,sourceSha256:'1'.repeat(64),rpcUrl:selected.rpcUrl,contractAddress:selected.contractAddress,catalogHash:await hashEvidenceJson(FIELD_CATALOG) }; }
  it('requires independent source release verification beyond matching getters', async () => {
    expect((await checkV6WriteCompatibility(config,reader,{})).writable).toBe(false);
    const release = await releaseFor();
    expect((await checkV6WriteCompatibility(config,reader,release)).writable).toBe(true);
    expect((await checkV6WriteCompatibility({...config,contractAddress:'0x'+'f'.repeat(40)},reader,release)).writable).toBe(false);
    expect((await checkV6WriteCompatibility(config,reader,{...release,sourceVerified:false})).writable).toBe(false);
  });
  it('rejects missing getters, added fields and question drift with the same catalog version', async () => {
    const release = await releaseFor();
    expect((await checkV6WriteCompatibility(config,async()=>{throw new Error('missing');},release)).writable).toBe(false);
    const drift = structuredClone(FIELD_CATALOG);drift.fields[0].question += ' Guarantee safe.';
    expect((await checkV6WriteCompatibility(config,async name => name==='get_policy_version'?POLICY_V6:JSON.stringify(drift),release)).reason).toContain('完整目录');
    expect((await checkV6WriteCompatibility(config,async name => name==='get_policy_version'?POLICY_V6:JSON.stringify({...FIELD_CATALOG,extra:true}),release)).writable).toBe(false);
  });
  it('checks each invocation afresh without sharing trust across network or address', async () => {
    const release = await releaseFor();let current = POLICY_V6 as string;
    const changing = vi.fn(async (name:string) => name==='get_policy_version'?current:JSON.stringify(FIELD_CATALOG));
    expect((await checkV6WriteCompatibility(config,changing,release)).writable).toBe(true);
    current='research-receipt/5';
    expect((await checkV6WriteCompatibility(config,changing,release)).writable).toBe(false);
    expect(changing).toHaveBeenCalledTimes(4);
  });
});
describe('transaction recovery fails closed',()=>{
  it('clears a confirmed cancellation rather than blocking all future writes',async()=>{pending();mock.getTransaction.mockResolvedValue({statusName:'CANCELED'});await expect(resumePendingTransaction(config)).rejects.toThrow('取消');expect(getPendingTransaction(config)).toBeNull();});
  it('preserves the transaction ID and client ref after a network error',async()=>{pending();mock.getTransaction.mockRejectedValue(new Error('offline'));await expect(resumePendingTransaction(config)).rejects.toThrow('offline');expect(getPendingTransaction(config)).toMatchObject({hash,clientRef:'recover-this-order'});});
  it('clears only a consensus-accepted finalized execution error',async()=>{pending();mock.getTransaction.mockResolvedValue({statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_ERROR',lifecycle:{outcome:'accepted'},result:1});await expect(resumePendingTransaction(config)).rejects.toThrow('FINISHED_WITH_ERROR');expect(getPendingTransaction(config)).toBeNull();});
  it('retains a finalized NO_MAJORITY transaction without claiming successful execution or rollback',async()=>{pending();mock.getTransaction.mockResolvedValue({statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:{outcome:'undetermined'},result:5,resultName:'NO_MAJORITY'});await expect(resumePendingTransaction(config)).rejects.toThrow('未形成共识');expect(getPendingTransaction(config)).toMatchObject({hash,clientRef:'recover-this-order'});expect(mock.readContract).not.toHaveBeenCalled();expect(localStorage.getItem(key+':completed')).toBeNull();});
  it('fails closed when public consensus metadata is absent',async()=>{const publicKey=`rr:pending:v1:https://rpc-bradbury.genlayer.com:${config.contractAddress}`;localStorage.setItem(publicKey,JSON.stringify({hash,functionName:'evaluate',submittedAt:'now'}));bradbury.createClient.mockResolvedValue(mock);mock.getTransaction.mockResolvedValue({statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:undefined});await expect(resumePendingTransaction({...config,rpcUrl:'https://rpc-bradbury.genlayer.com'})).rejects.toThrow('未形成可确认的协议共识');expect(localStorage.getItem(publicKey)).not.toBeNull();});
  it('recovers the precise order ID only after finalized successful execution',async()=>{pending();mock.getTransaction.mockResolvedValue({statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:{outcome:'accepted'},result:1});mock.readContract.mockResolvedValue(17);await expect(resumePendingTransaction(config)).resolves.toBe(hash);expect(mock.readContract).toHaveBeenCalledWith(expect.objectContaining({functionName:'get_order_id',args:['recover-this-order']}));expect(getPendingTransaction(config)).toBeNull();expect(JSON.parse(localStorage.getItem(key+':completed')!)).toMatchObject({clientRef:'recover-this-order'});});
  it('never duplicates a state change while a transaction is unresolved',async()=>{pending();await expect(write(config,'create_order',['{}'])).rejects.toThrow('恢复追踪');expect(mock.writeContract).not.toHaveBeenCalled();});
  it('requires a matching wallet chain before estimating or signing',async()=>{vi.stubGlobal('window',{ethereum:{request:vi.fn(async({method}:{method:string})=>method==='eth_requestAccounts'?['0x'+'c'.repeat(40)]:'0x1')}});await expect(write(config,'evaluate',[1,1])).rejects.toThrow('切换');expect(mock.estimateTransactionFeesForWrite).not.toHaveBeenCalled();});
  it('reads finalized state rather than accepted nonfinal state',async()=>{mock.readContract.mockResolvedValue('record');await read(config,'get_order',[1]);expect(mock.readContract).toHaveBeenCalledWith(expect.objectContaining({transactionHashVariant:'latest-final'}));});
  it('uses a capped development profile and never simulates the user write to quote fees',async()=>{vi.stubGlobal('window',{ethereum:{request:vi.fn(async({method}:{method:string})=>method==='eth_requestAccounts'?['0x'+'c'.repeat(40)]:'0xf22d')}});mock.estimateTransactionFees.mockResolvedValue({distribution:{},feeValue:1n});mock.writeContract.mockResolvedValue(hash);mock.getTransaction.mockResolvedValue({statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:{outcome:'accepted'},result:1});await expect(write(config,'evaluate',[1,1],{orderId:1})).resolves.toBe(hash);expect(mock.estimateTransactionFees).toHaveBeenCalledWith(expect.objectContaining({leaderTimeunitsAllocation:600n,appealRounds:0n}));expect(mock.estimateTransactionFeesForWrite).not.toHaveBeenCalled();});
  it('does not create temporary accounts on other networks',async()=>{await expect(connectDevSession({...config,rpcUrl:'https://studio.genlayer.com/api'})).rejects.toThrow('仅支持');await expect(connectDevSession({...config,mode:'demo'})).rejects.toThrow('仅支持');});
  it('awaits public Phase 2 verification before finalized reads',async()=>{bradbury.createClient.mockResolvedValue(mock);mock.readContract.mockResolvedValue('public record');await read({...config,rpcUrl:'https://rpc-bradbury.genlayer.com'},'get_order',[1]);expect(bradbury.createClient).toHaveBeenCalledOnce();expect(mock.readContract).toHaveBeenCalledWith(expect.objectContaining({transactionHashVariant:'latest-final'}));});
  it('uses the verified public chain and injected wallet with the scoped public quote',async()=>{release.rpcUrl='https://rpc-bradbury.genlayer.com';const wallet={request:vi.fn(async({method}:{method:string})=>method==='eth_requestAccounts'?['0x'+'c'.repeat(40)]:method==='eth_getBlockByNumber'?{hash:'0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4'}:'0x107d')};vi.stubGlobal('window',{ethereum:wallet});bradbury.createClient.mockResolvedValue(mock);bradbury.quote.mockResolvedValue({distribution:{},feeValue:1n});mock.writeContract.mockResolvedValue(hash);mock.getTransaction.mockResolvedValue({statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:{outcome:'accepted'},result:1});await expect(write({...config,rpcUrl:'https://rpc-bradbury.genlayer.com'},'evaluate',[1,1])).resolves.toBe(hash);expect(bradbury.createClient).toHaveBeenCalledWith({account:'0x'+'c'.repeat(40),provider:{request:expect.any(Function)}});expect(bradbury.quote).toHaveBeenCalledWith(mock);expect(mock.estimateTransactionFees).not.toHaveBeenCalled();});
  it('refuses wrong wallet network before public client construction or a signature',async()=>{vi.stubGlobal('window',{ethereum:{request:vi.fn(async({method}:{method:string})=>method==='eth_requestAccounts'?['0x'+'c'.repeat(40)]:'0x1')}});await expect(write({...config,rpcUrl:'https://rpc-bradbury.genlayer.com'},'evaluate',[1,1])).rejects.toThrow('4221');expect(bradbury.createClient).not.toHaveBeenCalled();expect(mock.writeContract).not.toHaveBeenCalled();await expect(connectDevSession({...config,rpcUrl:'https://rpc-bradbury.genlayer.com'})).rejects.toThrow('仅支持');});
  it('refuses a wallet on old Phase 1 even when chain ID is 4221',async()=>{vi.stubGlobal('window',{ethereum:{request:vi.fn(async({method}:{method:string})=>method==='eth_requestAccounts'?['0x'+'c'.repeat(40)]:method==='eth_getBlockByNumber'?{hash:'0x'+'0'.repeat(64)}:'0x107d')}});await expect(write({...config,rpcUrl:'https://rpc-bradbury.genlayer.com'},'evaluate',[1,1])).rejects.toThrow('genesis');expect(bradbury.createClient).not.toHaveBeenCalled();expect(mock.writeContract).not.toHaveBeenCalled();});
});

const publicConfig = { ...config, rpcUrl: 'https://rpc-bradbury.genlayer.com' };
const phase2Genesis = '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4';
const actor = '0x' + 'c'.repeat(40);
const envelope = '0x' + 'd'.repeat(64);
describe('action-scoped verified reads', () => {
  it('verifies once within an action, pins finalized reads and verifies the next action afresh', async () => {
    bradbury.createClient.mockResolvedValue(mock); mock.readContract.mockResolvedValue('record');
    await withReadSession(publicConfig, async reader => {
      await reader('get_order', [1]);
      await Promise.all([reader('get_revision', [1, 1]), reader('get_assessment', [1, 1])]);
    });
    expect(bradbury.createClient).toHaveBeenCalledTimes(1);
    expect(mock.readContract).toHaveBeenCalledTimes(3);
    expect(mock.readContract.mock.calls.every(([request]) => request.transactionHashVariant === 'latest-final')).toBe(true);
    await read(publicConfig, 'get_order', [2]);
    expect(bradbury.createClient).toHaveBeenCalledTimes(2);
  });
  it('binds the contract snapshot and prevents retaining a reader after the action ends', async () => {
    bradbury.createClient.mockResolvedValue(mock); mock.readContract.mockResolvedValue('record');
    const selected = { ...publicConfig }; let retained!: SessionRead;
    await withReadSession(selected, async reader => {
      retained = reader;
      selected.contractAddress = '0x' + 'e'.repeat(40);
      await reader('get_order', [1]);
    });
    expect(mock.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: publicConfig.contractAddress }));
    await expect(retained('get_order', [1])).rejects.toThrow('只读会话已结束');
    expect(mock.readContract).toHaveBeenCalledTimes(1);
  });
  it('closes a failed action and preserves the existing missing-contract translation', async () => {
    bradbury.createClient.mockResolvedValue(mock); mock.readContract.mockRejectedValue(new Error('contract not found'));
    let retained!: SessionRead;
    await expect(withReadSession(publicConfig, async reader => { retained = reader; return reader('get_order', [1]); })).rejects.toThrow('当前网络未找到此合约');
    await expect(retained('get_order', [1])).rejects.toThrow('只读会话已结束');
  });
  it('never reuses a read-session verification for a subsequent write', async () => {
    const setup = actualProviderSetup(); mock.readContract.mockImplementation(async ({functionName}:{functionName:string})=>functionName==='get_order'?'record':functionName==='get_policy_version'?POLICY_V6:JSON.stringify(FIELD_CATALOG));
    await withReadSession(publicConfig, reader => reader('get_order', [1]));
    expect(bradbury.createClient).toHaveBeenCalledTimes(1);
    await write(publicConfig, 'evaluate', [1, 1]);
    expect(bradbury.createClient).toHaveBeenCalledTimes(2);
    expect(setup.send).toHaveBeenCalledOnce();
  });
});
const TEST_ADD_TX_ABI = parseAbi([
  'function addTransaction((address sender,address recipient,uint256 numOfInitialValidators,uint256 maxRotations,uint256 validUntil,uint256 saltNonce,uint256 userValue,(uint256 leaderTimeunitsAllocation,uint256 validatorTimeunitsAllocation,uint256 appealRounds,uint256 executionBudgetPerRound,uint256 executionConsumed,uint256 totalMessageFees,uint256[] rotations,uint256 maxPriceGenPerTimeUnit,uint256 storageFeeMaxGasPrice,uint256 receiptFeeMaxGasPrice) feesDistribution,bytes txCalldata,(uint8 messageType,bool onAcceptance,uint256 parentIndex,address recipient,bytes32 callKey,uint256 budget,bytes feeParams)[] messageAllocations) _params) payable',
]);
function encodeTestEnvelope(options: { sender?: string; recipient?: string; functionName?: string; args?: (string | number)[]; kwargs?: Record<string, unknown>; leaderOnly?: boolean; userValue?: bigint } = {}) {
  const pendingIntent = getPendingTransaction(publicConfig) || getPendingTransaction(config);
  const fn = options.functionName ?? pendingIntent?.functionName ?? 'evaluate';
  const callArgs = options.args ?? pendingIntent?.args ?? [1, 1];
  const txCalldata = abi.transactions.serialize([abi.calldata.encode(abi.calldata.makeCalldataObject(fn, callArgs, options.kwargs as Parameters<typeof abi.calldata.makeCalldataObject>[2])), options.leaderOnly ?? false]);
  return encodeFunctionData({
    abi: TEST_ADD_TX_ABI,
    functionName: 'addTransaction',
    args: [{
      sender: (options.sender ?? actor) as `0x${string}`,
      recipient: (options.recipient ?? publicConfig.contractAddress) as `0x${string}`,
      numOfInitialValidators: 5n,
      maxRotations: 3n,
      validUntil: 9999999999n,
      saltNonce: 0n,
      userValue: options.userValue ?? 0n,
      feesDistribution: {
        leaderTimeunitsAllocation: 600n,
        validatorTimeunitsAllocation: 600n,
        appealRounds: 0n,
        executionBudgetPerRound: 10000000000000000n,
        executionConsumed: 0n,
        totalMessageFees: 0n,
        rotations: [3n],
        maxPriceGenPerTimeUnit: 0n,
        storageFeeMaxGasPrice: 0n,
        receiptFeeMaxGasPrice: 12000000n,
      },
      txCalldata,
      messageAllocations: [],
    }],
  });
}
function actualProviderSetup() {
  release.rpcUrl=publicConfig.rpcUrl;
  const state = { genesis: phase2Genesis, activeAccount: actor };
  const send = vi.fn(async (): Promise<unknown> => envelope);
  const wallet = { request: vi.fn(async ({ method }: { method: string }) => {
    if (method === 'eth_requestAccounts') return [actor];
    if (method === 'eth_accounts') return [state.activeAccount];
    if (method === 'eth_chainId') return '0x107d';
    if (method === 'eth_getBlockByNumber') return { hash: state.genesis };
    if (method === 'eth_sendTransaction') return send();
    throw new Error(`Unexpected wallet method ${method}`);
  }) };
  let injected!: { request: (request: { method: string; params?: unknown[] }) => Promise<unknown> };
  vi.stubGlobal('window', { ethereum: wallet });
  bradbury.createClient.mockImplementation(async options => { if (options?.provider) injected = options.provider; return mock; });
  bradbury.quote.mockResolvedValue({ distribution: {}, feeValue: 1n });
  bradbury.recover.mockResolvedValue({ kind: 'pending', reason: '发送结果尚未确认。' });
  const sendViaSdk = (overrides: { from?: string; to?: string; data?: string; value?: string; gas?: string; omitGas?: boolean; chainId?: string } = {}) => injected.request({
    method: 'eth_sendTransaction',
    params: [{
      from: overrides.from ?? actor,
      to: overrides.to ?? testnetBradbury.consensusMainContract!.address,
      data: overrides.data ?? encodeTestEnvelope(),
      value: 'value' in overrides ? overrides.value : '0x1',
      ...(overrides.omitGas ? {} : { gas: overrides.gas ?? '0x98968' }),
      chainId: overrides.chainId ?? '0x107d',
    }],
  });
  mock.writeContract.mockImplementation(async () => { await sendViaSdk(); return hash; });
  mock.getTransaction.mockResolvedValue({ statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', lifecycle: { outcome: 'accepted' }, result: 1 });
  return { state, send, wallet, sendViaSdk };
}
describe('actual wallet send boundary and ambiguous submission', () => {
  it('does not expose an ungated write path when optional context is omitted', async () => {
    const setup = actualProviderSetup();release.sourceVerified=false;
    await expect(write(publicConfig,'evaluate',[1,1])).rejects.toThrow('独立源码验证');
    expect(setup.send).not.toHaveBeenCalled();expect(mock.writeContract).not.toHaveBeenCalled();expect(getPendingTransaction(publicConfig)).toBeNull();
  });
  it('blocks the real send when the wallet switches to same-ID Phase 1 during quotation', async () => {
    const setup = actualProviderSetup();
    bradbury.quote.mockImplementation(async () => { setup.state.genesis = '0x' + '0'.repeat(64); return { distribution: {}, feeValue: 1n }; });
    await expect(write(publicConfig, 'create_order', ['{}'], { clientRef: 'must-not-send' })).rejects.toThrow('genesis');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
  });
  it('blocks the real send if the active wallet account changes after connection', async () => {
    const setup = actualProviderSetup();
    bradbury.quote.mockImplementation(async () => { setup.state.activeAccount = '0x' + 'e'.repeat(40); return { distribution: {}, feeValue: 1n }; });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('账户已变化');
    expect(setup.send).not.toHaveBeenCalled();
  });
  it('retains the EVM envelope and client reference when the SDK receipt wait fails', async () => {
    const setup = actualProviderSetup();
    mock.writeContract.mockImplementation(async () => { await setup.sendViaSdk(); throw new Error('receipt timeout'); });
    await expect(write(publicConfig, 'create_order', ['{}'], { clientRef: 'recover-created-order' })).rejects.toThrow('receipt timeout');
    expect(getPendingTransaction(publicConfig)).toMatchObject({ kind: 'envelope', hash: envelope, envelopeHash: envelope, clientRef: 'recover-created-order' });
    await expect(write(publicConfig, 'create_order', ['{}'])).rejects.toThrow('恢复追踪');
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('发送结果尚未确认');
    expect(mock.getTransaction).not.toHaveBeenCalled();
    expect(setup.send).toHaveBeenCalledOnce();
  });
  it('blocks retries after a send transport error even when no hash was returned', async () => {
    const setup = actualProviderSetup(); setup.send.mockRejectedValue(new Error('connection lost'));
    await expect(write(publicConfig, 'create_order', ['{}'], { clientRef: 'possibly-broadcast' })).rejects.toThrow('connection lost');
    expect(getPendingTransaction(publicConfig)).toMatchObject({ kind: 'submission-uncertain', hash: '', clientRef: 'possibly-broadcast' });
    await expect(write(publicConfig, 'create_order', ['{}'])).rejects.toThrow('恢复追踪');
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('仍可能已经广播');
    expect(mock.getTransaction).not.toHaveBeenCalled();
    expect(setup.send).toHaveBeenCalledOnce();
  });
  it('clears an external-wallet preparation intent when the SDK fails before entering its only send route', async () => {
    const setup = actualProviderSetup();
    mock.writeContract.mockRejectedValue(new Error('SDK preflight failed'));
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('SDK preflight failed');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
  });
  it('clears the intent for an explicit EIP-1193 user rejection', async () => {
    const setup = actualProviderSetup(); setup.send.mockRejectedValue(Object.assign(new Error('User rejected'), { code: 4001 }));
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('User rejected');
    expect(getPendingTransaction(publicConfig)).toBeNull();
  });
  it('does not let an SDK retry send a second envelope after an uncertain attempt', async () => {
    const setup = actualProviderSetup(); setup.send.mockRejectedValue(new Error('connection lost'));
    mock.writeContract.mockImplementation(async () => { try { await setup.sendViaSdk(); } catch { /* emulate a transport retry */ } return setup.sendViaSdk(); });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('不会再次');
    expect(setup.send).toHaveBeenCalledOnce();
    expect(getPendingTransaction(publicConfig)).not.toBeNull();
  });
  it('recovers a proven envelope protocol ID before entering the normal finality tracker', async () => {
    const setup = actualProviderSetup();
    mock.writeContract.mockImplementation(async () => { await setup.sendViaSdk(); throw new Error('receipt timeout'); });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('receipt timeout');
    bradbury.recover.mockResolvedValue({ kind: 'protocol', hash, evidence: { envelopeHash: envelope, blockHash: '0x' + '1'.repeat(64), blockNumber: '0xa' } });
    await expect(resumePendingTransaction(publicConfig)).resolves.toBe(hash);
    expect(mock.getTransaction).toHaveBeenCalledWith({ hash });
    expect(getPendingTransaction(publicConfig)).toBeNull();
    expect(setup.send).toHaveBeenCalledOnce();
  });
  it('archives and clears only a matching envelope proven reverted by the recovery helper', async () => {
    const setup = actualProviderSetup();
    mock.writeContract.mockImplementation(async () => { await setup.sendViaSdk(); throw new Error('receipt timeout'); });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('receipt timeout');
    bradbury.recover.mockResolvedValue({ kind: 'reverted', evidence: { envelopeHash: envelope, blockHash: '0x' + '1'.repeat(64), blockNumber: '0xa' } });
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('已确认此 EVM 交易回滚');
    expect(getPendingTransaction(publicConfig)).toBeNull();
    expect(mock.getTransaction).not.toHaveBeenCalled();
  });
  it('rejects a direct send to contractAddress bypassing ConsensusMain', async () => {
    const setup = actualProviderSetup();
    mock.writeContract.mockImplementation(async () => { await setup.sendViaSdk({ to: publicConfig.contractAddress }); return hash; });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('共识入口合约');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
  });
  it('rejects a ConsensusMain envelope targeting another recipient or mutating call arguments', async () => {
    const setup = actualProviderSetup();
    mock.writeContract.mockImplementation(async () => {
      await setup.sendViaSdk({ data: encodeTestEnvelope({ recipient: '0x' + 'f'.repeat(40), functionName: 'evaluate', args: [1, 1] }) });
      return hash;
    });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('目标合约或方法参数');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
    mock.writeContract.mockImplementation(async () => {
      await setup.sendViaSdk({ data: encodeTestEnvelope({ recipient: publicConfig.contractAddress, functionName: 'evaluate', args: [1, 2] }) });
      return hash;
    });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('目标合约或方法参数');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
  });
  it('rejects a ConsensusMain envelope carrying unexpected non-zero userValue', async () => {
    const setup = actualProviderSetup();
    mock.writeContract.mockImplementation(async () => {
      await setup.sendViaSdk({ data: encodeTestEnvelope({ userValue: 1n }) });
      return hash;
    });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('目标合约或方法参数');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
  });
  it('rejects Bradbury missing gas, SDK 200,000 fallback gas, >32,000,000 gas, mismatched value, kwargs or leaderOnly before signing', async () => {
    const setup = actualProviderSetup();
    mock.writeContract.mockImplementation(async () => { await setup.sendViaSdk({ omitGas: true }); return hash; });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('缺少显式 gas');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
    mock.writeContract.mockImplementation(async () => { await setup.sendViaSdk({ gas: '0x30d40' }); return hash; });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('32,000,000');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
    mock.writeContract.mockImplementation(async () => { await setup.sendViaSdk({ gas: '0x1e84801' }); return hash; });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('32,000,000');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
    mock.writeContract.mockImplementation(async () => { await setup.sendViaSdk({ value: '0x2' }); return hash; });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('已报价协议费用不一致');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
    mock.writeContract.mockImplementation(async () => {
      await setup.sendViaSdk({ data: encodeTestEnvelope({ kwargs: { extra: 'unexpected' } }) });
      return hash;
    });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('目标合约或方法参数');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
    mock.writeContract.mockImplementation(async () => {
      await setup.sendViaSdk({ data: encodeTestEnvelope({ leaderOnly: true }) });
      return hash;
    });
    await expect(write(publicConfig, 'evaluate', [1, 1])).rejects.toThrow('目标合约或方法参数');
    expect(setup.send).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).toBeNull();
  });
});
describe('canonical pending keys', () => {
  it('migrates a legacy trailing-slash record and blocks writes through either spelling', async () => {
    const legacy = `rr:pending:v1:${config.rpcUrl}/:${config.contractAddress}`;
    localStorage.setItem(legacy, JSON.stringify({ hash, functionName: 'create_order', submittedAt: 'old', clientRef: 'legacy-ref' }));
    expect(getPendingTransaction(config)).toMatchObject({ hash, clientRef: 'legacy-ref' });
    expect(localStorage.getItem(legacy)).toBeNull();
    expect(localStorage.getItem(key)).not.toBeNull();
    await expect(write({ ...config, rpcUrl: config.rpcUrl + '/' }, 'create_order', ['{}'])).rejects.toThrow('恢复追踪');
    expect(mock.writeContract).not.toHaveBeenCalled();
  });
  it('preserves conflicting legacy and canonical records rather than overwriting either', async () => {
    pending();
    const legacy = `rr:pending:v1:${config.rpcUrl}/:${config.contractAddress}`;
    const other = JSON.stringify({ hash: envelope, functionName: 'evaluate', submittedAt: 'other' });
    localStorage.setItem(legacy, other);
    expect(getPendingTransaction(config)?.conflict).toBe(true);
    expect(localStorage.getItem(legacy)).toBe(other);
    expect(JSON.parse(localStorage.getItem(key)!).hash).toBe(hash);
    await expect(resumePendingTransaction(config)).rejects.toThrow('冲突');
    expect(mock.getTransaction).not.toHaveBeenCalled();
  });
  it('explains a confirmed contract-not-found RPC error without substituting another network', async () => {
    mock.readContract.mockRejectedValue(new Error('contract not found'));
    await expect(read(config, 'get_order', [1])).rejects.toThrow('当前网络未找到此合约');
  });
});

describe('Studio wallet receipt recovery', () => {
  it('tracks the wallet hash as a Studio protocol ID even when SDK receipt waiting throws', async () => {
    const send = vi.fn(async () => envelope);
    const wallet = { request: vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [actor];
      if (method === 'eth_chainId') return '0xf22d';
      if (method === 'eth_sendTransaction') return send();
      throw new Error(`Unexpected Studio wallet method ${method}`);
    }) };
    vi.stubGlobal('window', { ethereum: wallet });
    mock.estimateTransactionFees.mockResolvedValue({ distribution: {}, feeValue: 1n });
    mock.writeContract.mockImplementation(async () => {
      const options = mock.createClient.mock.calls.at(-1)?.[0] as { provider: { request: (arg: { method: string; params: unknown[] }) => Promise<unknown> } };
      await options.provider.request({ method: 'eth_sendTransaction', params: [{ from: actor, chainId: '0xf22d', to: studioDevnet.consensusMainContract!.address, value: '0x1', data: encodeTestEnvelope({ recipient: config.contractAddress, functionName: 'create_order', args: ['{}'] }) }] });
      throw new Error('Studio receipt timeout');
    });
    await expect(write(config, 'create_order', ['{}'], { clientRef: 'studio-recover-reference' })).rejects.toThrow('Studio receipt timeout');
    expect(getPendingTransaction(config)).toMatchObject({ kind: 'protocol', hash: envelope, clientRef: 'studio-recover-reference' });
    expect(getPendingTransaction(config)?.envelopeHash).toBeUndefined();
    await expect(write(config, 'create_order', ['{}'])).rejects.toThrow('恢复追踪');
    mock.getTransaction.mockResolvedValue({ statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', lifecycle: { outcome: 'accepted' }, result: 1 });
    mock.readContract.mockResolvedValue(17);
    await expect(resumePendingTransaction(config)).resolves.toBe(envelope);
    expect(mock.getTransaction).toHaveBeenCalledWith({ hash: envelope });
    expect(bradbury.recover).not.toHaveBeenCalled();
    expect(getPendingTransaction(config)).toBeNull();
    expect(send).toHaveBeenCalledOnce();
  });
});

describe('finalized-undetermined operation recovery', () => {
  const publicKey = `rr:pending:v1:${publicConfig.rpcUrl}:${publicConfig.contractAddress}`;
  function terminalFixture(functionName = 'evaluate', args: (string | number)[] = [1, 1], context: Record<string, unknown> = { orderId: 1, revision: 1 }) {
    const record = { hash, kind: 'protocol', functionName, args, account: actor, submittedAt: 'now', intentId: 'owned-terminal-intent', ...context };
    localStorage.setItem(publicKey, JSON.stringify(record));
    bradbury.createClient.mockResolvedValue(mock);
    const transaction = { txId: hash, sender: actor, recipient: publicConfig.contractAddress, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', lifecycle: { outcome: 'undetermined' }, result: 5, resultName: 'NO_MAJORITY', txDataDecoded: { type: 'call', callData: new Map<string, unknown>([['', functionName], ['args', args.map(value => typeof value === 'number' ? BigInt(value) : value)]]) } };
    mock.getTransaction.mockResolvedValue(transaction);
    mock.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => functionName === 'get_order' ? JSON.stringify({ id: 1, revision_count: 1, status: 'SUBMITTED' }) : functionName === 'get_assessment' ? '' : 0);
    return { record, transaction };
  }
  it('archives a matching evaluate only when latest-final assessment is absent and current revision remains submitted', async () => {
    terminalFixture();
    const events: { stage: string; message: string }[] = [];
    const unsubscribe = watchTransactions(event => events.push(event));
    try { await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('再次操作将创建新交易'); } finally { unsubscribe(); }
    expect(getPendingTransaction(publicConfig)).toBeNull();
    const evidence = JSON.parse(localStorage.getItem(`${publicKey}:terminal:${hash}`)!);
    expect(evidence.terminal).toMatchObject({ consensusOutcome: 'undetermined', consensusResult: 'NO_MAJORITY', identityVerified: true, confirmedNotApplied: true });
    expect(mock.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'get_assessment', transactionHashVariant: 'latest-final' }));
    expect(mock.writeContract).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ stage: 'attention', message: expect.stringContaining('不会自动重试') });
    expect(events.some(event => event.stage === 'finalized')).toBe(false);
  });
  it('clears an uncommitted create only after its exact client reference maps to zero', async () => {
    terminalFixture('create_order', [JSON.stringify({ client_ref: 'reference-not-applied' })], { clientRef: 'reference-not-applied' });
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('重新支付');
    expect(getPendingTransaction(publicConfig)).toBeNull();
    expect(mock.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'get_order_id', args: ['reference-not-applied'] }));
  });
  it('clears an uncommitted submission only when the final count is exactly the prior revision', async () => {
    terminalFixture('submit_revision', [1, '{}'], { orderId: 1, revision: 2 });
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('确认对应操作未落盘');
    expect(getPendingTransaction(publicConfig)).toBeNull();
  });
  it('retains a final-undetermined lock when state has advanced or an assessment already exists', async () => {
    terminalFixture(); mock.readContract.mockResolvedValue(JSON.stringify({ id: 1, revision_count: 1, status: 'ACCEPTED' }));
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('最终状态已变化');
    expect(getPendingTransaction(publicConfig)).toMatchObject({ kind: 'final-undetermined', hash });
    expect(localStorage.getItem(`${publicKey}:terminal:${hash}`)).toBeNull();
  });
  it('handles MAJORITY_DISAGREE plus VM error as undetermined rather than a consensus-confirmed revert', async () => {
    const setup = terminalFixture();
    setup.transaction.result = 2; setup.transaction.resultName = 'MAJORITY_DISAGREE'; setup.transaction.txExecutionResultName = 'FINISHED_WITH_ERROR';
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('未形成协议共识');
    const evidence = JSON.parse(localStorage.getItem(`${publicKey}:terminal:${hash}`)!);
    expect(evidence.terminal).toMatchObject({ consensusOutcome: 'undetermined', consensusResult: 'MAJORITY_DISAGREE', execution: 'FINISHED_WITH_ERROR', confirmedNotApplied: true });
    expect(mock.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'get_assessment' }));
    expect(localStorage.getItem(`${publicKey}:completed`)).toBeNull();
  });
  it('does not treat a view RPC error as proof that an assessment is absent', async () => {
    terminalFixture(); mock.readContract.mockRejectedValue(new Error('offline'));
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('最终状态读取失败');
    expect(getPendingTransaction(publicConfig)).toMatchObject({ kind: 'final-undetermined', hash });
  });
  it('does not read or unlock for a different transaction sender', async () => {
    const setup = terminalFixture(); setup.transaction.sender = '0x' + 'e'.repeat(40);
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('身份、方法或参数');
    expect(mock.readContract).not.toHaveBeenCalled();
    expect(getPendingTransaction(publicConfig)).not.toBeNull();
  });
  it('preserves a replacement intent if a failed asynchronous read races with a record change', async () => {
    const setup = terminalFixture();
    mock.readContract.mockImplementation(async () => { localStorage.setItem(publicKey, JSON.stringify({ ...setup.record, hash: envelope, intentId: 'another-intent' })); throw new Error('offline'); });
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('最终状态读取失败');
    expect(getPendingTransaction(publicConfig)).toMatchObject({ hash: envelope, intentId: 'another-intent' });
  });
  it.each(['research-receipt/5','research-receipt/6'])('archives %s verify_evidence only after matching identity and an empty latest-final snapshot',async policy=>{
    terminalFixture('verify_evidence');
    mock.readContract.mockImplementation(async({functionName}:{functionName:string})=>functionName==='get_order'?JSON.stringify({id:1,revision_count:1,status:'SUBMITTED',policy_version:policy}):'');
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('确认对应操作未落盘');
    expect(getPendingTransaction(publicConfig)).toBeNull();
    expect(mock.readContract).toHaveBeenCalledWith(expect.objectContaining({functionName:'get_evidence_snapshot',args:[1,1],transactionHashVariant:'latest-final'}));
    expect(mock.writeContract).not.toHaveBeenCalled();
  });
  it.each(['research-receipt/5','research-receipt/6'])('retains a %s verify lock when any immutable snapshot already exists, including a failed snapshot',async policy=>{
    terminalFixture('verify_evidence');
    mock.readContract.mockImplementation(async({functionName}:{functionName:string})=>functionName==='get_order'?JSON.stringify({id:1,revision_count:1,status:'SUBMITTED',policy_version:policy}):'{"source_checks":[{"status":"HASH_MISMATCH"}]}');
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('已有对应记录');
    expect(getPendingTransaction(publicConfig)).toMatchObject({kind:'final-undetermined',functionName:'verify_evidence'});
    expect(localStorage.getItem(`${publicKey}:terminal:${hash}`)).toBeNull();
  });
  it('does not infer snapshot absence from an RPC error or invalid protocol-call identity',async()=>{
    terminalFixture('verify_evidence');
    mock.readContract.mockImplementation(async({functionName}:{functionName:string})=>{if(functionName==='get_order')return JSON.stringify({id:1,revision_count:1,status:'SUBMITTED',policy_version:'research-receipt/5'});throw new Error('snapshot offline');});
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('最终状态读取失败');
    expect(getPendingTransaction(publicConfig)).not.toBeNull();
    const setup=terminalFixture('verify_evidence');setup.transaction.txDataDecoded.callData.set('args',[1n,2n]);mock.readContract.mockClear();
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('身份、方法或参数');
    expect(mock.readContract).not.toHaveBeenCalled();
  });
  it.each([{revision_count:2,status:'SUBMITTED',policy_version:'research-receipt/5'},{revision_count:1,status:'ACCEPTED',policy_version:'research-receipt/5'},{revision_count:1,status:'SUBMITTED',policy_version:'research-receipt/4'}])('retains verify lock when final order context drifted: %o',async context=>{
    terminalFixture('verify_evidence');mock.readContract.mockResolvedValue(JSON.stringify({id:1,...context}));
    await expect(resumePendingTransaction(publicConfig)).rejects.toThrow('最终状态已变化');
    expect(getPendingTransaction(publicConfig)).not.toBeNull();
    expect(mock.readContract).not.toHaveBeenCalledWith(expect.objectContaining({functionName:'get_evidence_snapshot'}));
  });
});
