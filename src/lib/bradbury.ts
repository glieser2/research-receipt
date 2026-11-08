import { createClient, createFeesDistribution } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { createPublicClient, decodeEventLog, getAddress, http, parseAbi } from 'viem';
import type { Address, PublicClient } from 'viem';
import feeProfile from '../fee-profile.json';

export const BRADBURY = Object.freeze({
  rpcUrl: 'https://rpc-bradbury.genlayer.com', chainId: 4221,
  genesisHash: '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4',
  addressManager: '0x3F71AE080BD6270A91dBcc7960d88797828538E0' as Address,
  manifestUrl: 'https://docs.genlayer.com/validators/bradbury.protocol-manifest.json',
  // The docs host omits CORS headers. This official repository commit serves
  // the identical sealed manifest with CORS=* (SHA256 6389bfdfe4756600c1074265
  // 749018191fca1c0caa2f774392f1607252d3c466, verified 2026-11-05).
  browserManifestUrl: 'https://raw.githubusercontent.com/genlayerlabs/genlayer-docs/65d920c1403b3c8ed98b16b4279b0e015e544535/content/validators/bradbury.protocol-manifest.json',
});
export const REQUIRED_NAMES = ['ConsensusMain', 'ConsensusData', 'Staking', 'FeeManager', 'RoundsStorage', 'Appeals', 'ConsensusDataBigRounds', 'TransactionManager'] as const;
type RegistryName = typeof REQUIRED_NAMES[number];
type Registry = Record<RegistryName, Address>;
const REGISTRY_ABI = parseAbi(['function getAddress(string) view returns (address)']);
const DATA_REGISTRY_ABI = parseAbi(['function addressManager() view returns (address)']);
interface Manifest { chainId?: unknown; registry?: unknown; entries?: { key?: unknown; addr?: unknown }[] }
export function validateBradburyManifest(value: unknown): Registry {
  const manifest = value as Manifest;
  if (!manifest || String(manifest.chainId) !== '4221' || String(manifest.registry).toLowerCase() !== BRADBURY.addressManager.toLowerCase() || !Array.isArray(manifest.entries)) throw new Error('Bradbury Phase 2 官方清单身份不匹配。');
  const addresses = {} as Registry;
  for (const name of REQUIRED_NAMES) {
    const matches = manifest.entries.filter(entry => entry?.key === name);
    if (matches.length !== 1 || typeof matches[0].addr !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(matches[0].addr) || /^0x0{40}$/i.test(matches[0].addr)) throw new Error(`Bradbury 清单地址缺失、重复或无效：${name}`);
    addresses[name] = getAddress(matches[0].addr);
  }
  return addresses;
}
function reader() { return createPublicClient({ transport: http(BRADBURY.rpcUrl, { retryCount: 0, timeout: 20000 }) }); }

export async function verifiedBradburyChain(options: { reader?: PublicClient; fetchImpl?: typeof fetch } = {}) {
  const publicClient = options.reader || reader();
  const response = await (options.fetchImpl || fetch)(BRADBURY.browserManifestUrl, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('无法读取 Bradbury 官方 Phase 2 清单，已停止接入。');
  const expected = validateBradburyManifest(await response.json());
  const [chainId, genesis, blockNumber] = await Promise.all([publicClient.getChainId(), publicClient.getBlock({ blockNumber: 0n }), publicClient.getBlockNumber()]);
  if (chainId !== BRADBURY.chainId || genesis.hash?.toLowerCase() !== BRADBURY.genesisHash) throw new Error('Bradbury genesis 不匹配，拒绝旧 Phase 1 或未知网络。');
  const addresses = {} as Registry;
  await Promise.all(REQUIRED_NAMES.map(async name => {
    const resolved = getAddress(await publicClient.readContract({ address: BRADBURY.addressManager, abi: REGISTRY_ABI, functionName: 'getAddress', args: [name], blockNumber }));
    if (resolved.toLowerCase() !== expected[name].toLowerCase()) throw new Error(`Bradbury 链上地址与官方清单不一致：${name}`);
    if (!await publicClient.getCode({ address: resolved, blockNumber }).then(code => !!code && code !== '0x')) throw new Error(`Bradbury 协议地址无合约代码：${name}`);
    addresses[name] = resolved;
  }));
  const registry = await publicClient.readContract({ address: addresses.ConsensusData, abi: DATA_REGISTRY_ABI, functionName: 'addressManager', blockNumber });
  if (registry.toLowerCase() !== BRADBURY.addressManager.toLowerCase()) throw new Error('Bradbury ConsensusData registry 不匹配。');
  const replace = <T extends { address: Address }>(definition: T | null | undefined, address: Address): T => {
    if (!definition || !('abi' in definition) || !Array.isArray(definition.abi)) throw new Error('SDK 缺少 Bradbury 所需协议 ABI。');
    return { ...definition, address };
  };
  const chain = { ...testnetBradbury, rpcUrls: { default: { http: [BRADBURY.rpcUrl] } },
    consensusMainContract: replace(testnetBradbury.consensusMainContract, addresses.ConsensusMain),
    consensusDataContract: replace(testnetBradbury.consensusDataContract, addresses.ConsensusData),
    stakingContract: replace(testnetBradbury.stakingContract, addresses.Staking),
    feeManagerContract: replace(testnetBradbury.feeManagerContract, addresses.FeeManager),
    roundsStorageContract: replace(testnetBradbury.roundsStorageContract, addresses.RoundsStorage),
    appealsContract: replace(testnetBradbury.appealsContract, addresses.Appeals),
  };
  return { chain, publicClient, addresses, blockNumber, manifestSource: BRADBURY.browserManifestUrl };
}

type ClientOptions = NonNullable<Parameters<typeof createClient>[0]>;
export async function createVerifiedBradburyClient(options: Pick<ClientOptions, 'account' | 'provider'> = {}) {
  // No cached validation: reconnect and every write must observe current identity.
  const { chain } = await verifiedBradburyChain();
  return createClient({ chain, endpoint: BRADBURY.rpcUrl, ...options });
}

const PROTOCOL_EVENTS = parseAbi([
  'event NewTransaction(bytes32 indexed txId,address indexed recipient,address indexed activator)',
  'event CreatedTransaction(bytes32 indexed txId,uint256 txSlot)',
]);
interface EnvelopeContext { envelopeHash: `0x${string}`; account: string; contractAddress: string; method: string; args: (string | number)[] }
export async function recoverBradburyEnvelope(client: ReturnType<typeof createClient>, context: EnvelopeContext, options: Parameters<typeof verifiedBradburyChain>[0] = {}) {
  const { publicClient, addresses } = await verifiedBradburyChain(options);
  const receipt = await publicClient.request({ method: 'eth_getTransactionReceipt', params: [context.envelopeHash] });
  if (!receipt) return { kind: 'pending' as const, reason: 'EVM 回执尚未出现。' };
  if (receipt.transactionHash.toLowerCase() !== context.envelopeHash.toLowerCase() || receipt.from.toLowerCase() !== context.account.toLowerCase() || receipt.to?.toLowerCase() !== addresses.ConsensusMain.toLowerCase() || !receipt.blockHash || receipt.blockNumber === null) return { kind: 'pending' as const, reason: 'EVM 回执与已记录的发送者、目标或区块证据不匹配。' };
  const evidence = { envelopeHash: receipt.transactionHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber };
  if (receipt.status === '0x0') return { kind: 'reverted' as const, evidence };
  if (receipt.status !== '0x1') return { kind: 'pending' as const, reason: 'EVM 回执状态尚未确认。' };
  const candidates = new Set<`0x${string}`>();
  for (const log of receipt.logs) {
    if (log.removed) continue;
    try {
      const event = decodeEventLog({ abi: PROTOCOL_EVENTS, topics: log.topics, data: log.data, strict: true });
      if (event.eventName === 'NewTransaction' && log.address.toLowerCase() === addresses.ConsensusMain.toLowerCase() && event.args.recipient.toLowerCase() === context.contractAddress.toLowerCase()) candidates.add(event.args.txId);
      if (event.eventName === 'CreatedTransaction' && log.address.toLowerCase() === addresses.TransactionManager.toLowerCase()) candidates.add(event.args.txId);
    } catch { /* Unrelated or malformed receipt logs cannot establish this operation. */ }
  }
  if (candidates.size !== 1) return { kind: 'pending' as const, reason: '未找到唯一且匹配的协议交易事件。' };
  const hash = [...candidates][0];
  const transaction = await client.getTransaction({ hash: hash as Parameters<typeof client.getTransaction>[0]['hash'] });
  const data = transaction.txDataDecoded;
  const call = data?.type === 'call' && 'callData' in data ? data.callData : null;
  const method = call instanceof Map ? call.get('') : (call as Record<string, unknown> | null)?.[''];
  const args = call instanceof Map ? call.get('args') : (call as Record<string, unknown> | null)?.args;
  const sameArgs = Array.isArray(args) && args.length === context.args.length && context.args.every((expected, index) => typeof expected === 'number' ? (typeof args[index] === 'bigint' ? args[index] === BigInt(expected) : args[index] === expected) : args[index] === expected);
  if (transaction.sender?.toLowerCase() !== context.account.toLowerCase() || transaction.recipient?.toLowerCase() !== context.contractAddress.toLowerCase() || method !== context.method || !sameArgs) return { kind: 'pending' as const, reason: '协议交易与已记录的账户、合约、方法或参数不匹配。' };
  return { kind: 'protocol' as const, hash, evidence };
}

const FEE_ABI = parseAbi([
  'function GENPerTimeUnit() view returns (uint256)',
  'function storageUnitPrice() view returns (uint256)',
  'function quoteGasPrice() view returns (uint256)',
  'function useChainDerivedReceiptPrice() view returns (bool)',
  'function calculateRoundFees((uint256 leaderTimeunitsAllocation,uint256 validatorTimeunitsAllocation,uint256 appealRounds,uint256 executionBudgetPerRound,uint256 executionConsumed,uint256 totalMessageFees,uint256[] rotations,uint256 maxPriceGenPerTimeUnit,uint256 storageFeeMaxGasPrice,uint256 receiptFeeMaxGasPrice),uint256,uint256) view returns (uint256)',
]);
export async function quoteBradburyFees(client: ReturnType<typeof createClient>, publicClient: PublicClient = reader()) {
  const chain = client.chain;
  if (chain?.id !== BRADBURY.chainId || chain.isStudio || !chain.feeManagerContract?.address) throw new Error('费用报价需要已验证的 Bradbury Phase 2 客户端。');
  const address = chain.feeManagerContract.address;
  const [genPerTimeUnit, storageUnitPrice, quotedGasPrice, derived, networkGasPrice] = await Promise.all([
    publicClient.readContract({ address, abi: FEE_ABI, functionName: 'GENPerTimeUnit' }),
    publicClient.readContract({ address, abi: FEE_ABI, functionName: 'storageUnitPrice' }),
    publicClient.readContract({ address, abi: FEE_ABI, functionName: 'quoteGasPrice' }),
    publicClient.readContract({ address, abi: FEE_ABI, functionName: 'useChainDerivedReceiptPrice' }), publicClient.getGasPrice(),
  ]);
  const enabled = derived || genPerTimeUnit > 0n || storageUnitPrice > 0n || quotedGasPrice > 0n;
  const receiptGasPrice = quotedGasPrice > (enabled ? networkGasPrice : 0n) ? quotedGasPrice : (enabled ? networkGasPrice : 0n);
  if (enabled && receiptGasPrice === 0n) throw new Error('Bradbury 活跃费用策略返回零价格。');
  const cap = (value: bigint) => value === 0n ? 0n : (value * 12000n + 9999n) / 10000n;
  // Exact rc.2 explicit-budget profile math. Its default-budget floor call is
  // unused for this profile and incorrectly omits from while setting gasPrice.
  const distribution = createFeesDistribution({
    leaderTimeunitsAllocation: BigInt(feeProfile.leaderTimeunitsAllocation), validatorTimeunitsAllocation: BigInt(feeProfile.validatorTimeunitsAllocation),
    executionBudgetPerRound: BigInt(feeProfile.executionBudgetPerRound), appealRounds: BigInt(feeProfile.appealRounds),
    rotations: Array.from({ length: Number(BigInt(feeProfile.appealRounds) + 1n) }, () => BigInt(chain.defaultConsensusMaxRotations)),
    maxPriceGenPerTimeUnit: cap(genPerTimeUnit), storageFeeMaxGasPrice: cap(storageUnitPrice), receiptFeeMaxGasPrice: cap(receiptGasPrice),
  });
  const roundFees = await publicClient.readContract({ address, abi: FEE_ABI, functionName: 'calculateRoundFees', args: [distribution, BigInt(chain.defaultNumberOfInitialValidators), 0n] });
  return { distribution, feeValue: roundFees + distribution.totalMessageFees };
}
