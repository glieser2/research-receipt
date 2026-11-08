import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import { encodeEventTopics, parseAbi } from 'viem';
import { BRADBURY, REQUIRED_NAMES, validateBradburyManifest, verifiedBradburyChain, quoteBradburyFees, recoverBradburyEnvelope } from './bradbury';

const addresses = Object.fromEntries(REQUIRED_NAMES.map((name, index) => [name, `0x${(index + 1).toString(16).padStart(40, '0')}`]));
const manifest = () => ({ chainId: '4221', registry: BRADBURY.addressManager, entries: REQUIRED_NAMES.map(key => ({ key, addr: addresses[key] })) });
function fixture() {
  const readContract = vi.fn(async (args: { functionName: string; args?: string[] }) => args.functionName === 'addressManager' ? BRADBURY.addressManager : addresses[args.args![0]]);
  const rpc = { getChainId: vi.fn(async () => 4221), getBlock: vi.fn(async () => ({ hash: BRADBURY.genesisHash as string })), getBlockNumber: vi.fn(async () => 10n), readContract, getCode: vi.fn(async () => '0x01') };
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(manifest()))) as unknown as typeof fetch;
  return { rpc, reader: rpc as unknown as PublicClient, fetchImpl };
}
describe('public Bradbury identity', () => {
  it('rejects wrong registry, duplicate alias and missing rounds storage', () => {
    expect(() => validateBradburyManifest({ ...manifest(), registry: addresses.Staking })).toThrow('身份');
    const duplicate = manifest(); duplicate.entries.push(duplicate.entries[0]);
    expect(() => validateBradburyManifest(duplicate)).toThrow('重复');
    const missing = manifest(); missing.entries = missing.entries.filter(item => item.key !== 'RoundsStorage');
    expect(() => validateBradburyManifest(missing)).toThrow('RoundsStorage');
  });
  it('replaces every SDK Phase 1 address with the verified Phase 2 snapshot', async () => {
    const setup = fixture(); const result = await verifiedBradburyChain(setup);
    expect(result.chain.roundsStorageContract.address).toBe(addresses.RoundsStorage);
    expect(result.chain.feeManagerContract.address).toBe(addresses.FeeManager);
    expect(result.chain.consensusMainContract.address).toBe(addresses.ConsensusMain);
    expect(result.chain.isStudio).toBe(false);
    expect(setup.fetchImpl).toHaveBeenCalledWith(BRADBURY.browserManifestUrl, expect.objectContaining({ redirect: 'error' }));
    expect(setup.rpc.readContract).toHaveBeenCalledTimes(9);
    expect(setup.rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'addressManager', blockNumber: 10n }));
  });
  it('rejects Phase 1 even when its chain ID also equals 4221', async () => {
    const setup = fixture(); setup.rpc.getBlock.mockResolvedValue({ hash: `0x${'1'.repeat(64)}` });
    await expect(verifiedBradburyChain(setup)).rejects.toThrow('genesis');
    expect(setup.rpc.readContract).not.toHaveBeenCalled();
  });
  it('fails closed on changed registry addresses or missing protocol code', async () => {
    const changed = fixture(); changed.rpc.readContract.mockResolvedValue(addresses.Staking);
    await expect(verifiedBradburyChain(changed)).rejects.toThrow('不一致');
    const empty = fixture(); empty.rpc.getCode.mockResolvedValue('0x');
    await expect(verifiedBradburyChain(empty)).rejects.toThrow('无合约代码');
  });
  it('quotes the explicit profile with the authoritative live FeeManager', async () => {
    const result = await verifiedBradburyChain(fixture());
    const rpc = { getGasPrice: vi.fn(async () => 250000000n), readContract: vi.fn(async ({ functionName }: { functionName: string }) => ({ GENPerTimeUnit: 1n, storageUnitPrice: 250000000n, quoteGasPrice: 250000000n, useChainDerivedReceiptPrice: true, calculateRoundFees: 40000000000033882n })[functionName]) };
    const quote = await quoteBradburyFees({ chain: result.chain } as unknown as Parameters<typeof quoteBradburyFees>[0], rpc as unknown as PublicClient);
    expect(quote.feeValue).toBe(40000000000033882n);
    expect(quote.distribution).toMatchObject({ leaderTimeunitsAllocation: 600n, executionBudgetPerRound: 10000000000000000n, rotations: [3n], maxPriceGenPerTimeUnit: 2n, receiptFeeMaxGasPrice: 300000000n });
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: addresses.FeeManager, functionName: 'calculateRoundFees', args: [quote.distribution, 5n, 0n] }));
    expect(rpc.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: 'estimateProposeReceiptGas' }));
  });
});

describe('known-envelope protocol recovery', () => {
  function envelopeFixture() {
    const setup = fixture();
    const hash = `0x${'a'.repeat(64)}` as const; const envelopeHash = `0x${'b'.repeat(64)}` as const;
    const context = { envelopeHash, account: addresses.Staking, contractAddress: addresses.Appeals, method: 'evaluate', args: [1, 1] };
    const topics = (txId = hash) => encodeEventTopics({ abi: parseAbi(['event NewTransaction(bytes32 indexed txId,address indexed recipient,address indexed activator)']), eventName: 'NewTransaction', args: { txId, recipient: context.contractAddress as `0x${string}`, activator: context.account as `0x${string}` } });
    const receipt = { transactionHash: envelopeHash, from: context.account, to: addresses.ConsensusMain, blockHash: `0x${'c'.repeat(64)}`, blockNumber: '0xa', status: '0x1', logs: [{ address: addresses.ConsensusMain, topics: topics(), data: '0x', removed: false }] };
    const request = vi.fn(async (): Promise<unknown> => receipt);
    const reader = { ...setup.rpc, request } as unknown as PublicClient;
    const transaction = { sender: context.account, recipient: context.contractAddress, txDataDecoded: { type: 'call', callData: new Map<string, unknown>([['', context.method], ['args', [1n, 1n]]]) } };
    const getTransaction = vi.fn(async () => transaction);
    const client = { getTransaction } as unknown as Parameters<typeof recoverBradburyEnvelope>[0];
    return { ...setup, reader, request, receipt, transaction, client, context, hash, topics, getTransaction };
  }
  it('keeps the intent when no EVM receipt exists yet', async () => {
    const setup = envelopeFixture(); setup.request.mockResolvedValue(null);
    expect((await recoverBradburyEnvelope(setup.client, setup.context, setup)).kind).toBe('pending');
    expect(setup.getTransaction).not.toHaveBeenCalled();
  });
  it('recovers only a matching event and independently matching protocol call', async () => {
    const setup = envelopeFixture();
    expect(await recoverBradburyEnvelope(setup.client, setup.context, setup)).toMatchObject({ kind: 'protocol', hash: setup.hash });
    setup.transaction.txDataDecoded.callData.set('', 'create_order');
    expect((await recoverBradburyEnvelope(setup.client, setup.context, setup)).kind).toBe('pending');
  });
  it('does not accept another sender or an ambiguous pair of protocol IDs', async () => {
    const wrong = envelopeFixture(); wrong.receipt.from = addresses.Appeals;
    expect((await recoverBradburyEnvelope(wrong.client, wrong.context, wrong)).kind).toBe('pending');
    const ambiguous = envelopeFixture(); ambiguous.receipt.logs.push({ ...ambiguous.receipt.logs[0], topics: ambiguous.topics(`0x${'d'.repeat(64)}`) });
    expect((await recoverBradburyEnvelope(ambiguous.client, ambiguous.context, ambiguous)).kind).toBe('pending');
    expect(ambiguous.getTransaction).not.toHaveBeenCalled();
  });
  it('recognizes a reverted envelope only after matching receipt ownership and destination', async () => {
    const setup = envelopeFixture(); setup.receipt.status = '0x0';
    expect((await recoverBradburyEnvelope(setup.client, setup.context, setup)).kind).toBe('reverted');
    setup.receipt.to = addresses.Appeals;
    expect((await recoverBradburyEnvelope(setup.client, setup.context, setup)).kind).toBe('pending');
  });
});
