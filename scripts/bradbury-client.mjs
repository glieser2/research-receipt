import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createClient, createFeesDistribution } from 'genlayer-js';
import { consensusAccepted, executionSucceeded } from '../src/lib/protocol-outcome.mjs';
import { testnetBradbury } from 'genlayer-js/chains';
import { createPublicClient, getAddress, http, parseAbi, parseAbiItem } from 'viem';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BRADBURY = Object.freeze({
  rpcUrl: 'https://rpc-bradbury.genlayer.com',
  chainId: 4221,
  genesisHash: '0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4',
  addressManager: '0x3F71AE080BD6270A91dBcc7960d88797828538E0',
  manifestUrl: 'https://docs.genlayer.com/validators/bradbury.protocol-manifest.json',
  explorerUrl: 'https://scan.bradbury.genlayer.com',
});
const ADDRESS_MANAGER_ABI = parseAbi(['function getAddress(string) view returns (address)']);
// These are the exact names consumed by SDK rc.2, not nearby similarly named
// contracts such as Rounds or ConsensusManager.
export const REQUIRED_NAMES = Object.freeze([
  'ConsensusMain', 'ConsensusData', 'Staking', 'FeeManager', 'RoundsStorage',
  'Appeals', 'ConsensusDataBigRounds', 'TransactionManager',
]);
const FIELD_NAMES = Object.freeze({
  consensusMainContract: 'ConsensusMain', consensusDataContract: 'ConsensusData',
  stakingContract: 'Staking', feeManagerContract: 'FeeManager',
  roundsStorageContract: 'RoundsStorage', appealsContract: 'Appeals',
});
const ZERO = '0x0000000000000000000000000000000000000000';
export const publicJson = value => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
export const safeError = error => {
  // RPC errors can embed a signed envelope in message/details/request bodies.
  // Keep only a short summary and redact hex that could contain key material.
  const summary = error?.shortMessage || (error?.name === 'Error' ? error.message : 'RPC or local operation failed.');
  return String(summary || 'Operation failed.').split('\n')[0].replace(/0x[0-9a-fA-F]{64,}/g, '[redacted hex]').slice(0, 500);
};
export function verifyTrackedOperation(transaction, operation, actorAddress) {
  const senderVerified = !!operation && typeof actorAddress === 'string' && transaction.sender?.toLowerCase() === actorAddress.toLowerCase();
  const sourceVerification = { required: operation?.operation === 'deploy', verified: false };
  if (sourceVerification.required && typeof transaction.txDataDecoded?.code === 'string') {
    sourceVerification.sourceSha256 = createHash('sha256').update(transaction.txDataDecoded.code, 'utf8').digest('hex');
    sourceVerification.verified = transaction.txDataDecoded.type === 'deploy' && sourceVerification.sourceSha256 === operation.sourceSha256;
  }
  return { senderVerified, sourceVerification, operationVerified: senderVerified && (!sourceVerification.required || sourceVerification.verified) };
}

export function validateManifest(manifest) {
  if (!manifest || String(manifest.chainId) !== String(BRADBURY.chainId) || String(manifest.registry).toLowerCase() !== BRADBURY.addressManager.toLowerCase()) throw new Error('Official manifest does not identify the expected Bradbury Phase 2 deployment.');
  if (!Array.isArray(manifest.entries)) throw new Error('Manifest has no address entries.');
  const addresses = {};
  for (const name of REQUIRED_NAMES) {
    const found = manifest.entries.filter(item => item?.key === name);
    if (found.length !== 1 || !/^0x[0-9a-fA-F]{40}$/.test(found[0].addr) || found[0].addr.toLowerCase() === ZERO) throw new Error(`Missing, duplicate, or invalid manifest address: ${name}`);
    addresses[name] = getAddress(found[0].addr);
  }
  return addresses;
}

export function overrideChain(addresses) {
  const chain = {
    ...testnetBradbury,
    id: BRADBURY.chainId, isStudio: false, name: 'GenLayer Bradbury Phase 2',
    rpcUrls: { default: { http: [BRADBURY.rpcUrl] } },
    blockExplorers: { default: { name: 'GenLayer Bradbury Phase 2 Explorer', url: BRADBURY.explorerUrl } },
  };
  for (const [field, name] of Object.entries(FIELD_NAMES)) {
    if (!addresses[name] || !testnetBradbury[field]?.abi) throw new Error(`SDK rc.2 lacks the expected ABI for ${field}.`);
    chain[field] = { ...testnetBradbury[field], address: addresses[name] };
  }
  return chain;
}

export async function connectBradbury({ account, fetchImpl = fetch } = {}) {
  const manifestResponse = await fetchImpl(BRADBURY.manifestUrl, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!manifestResponse.ok) throw new Error(`Official manifest HTTP ${manifestResponse.status}`);
  const manifestText = await manifestResponse.text();
  const manifest = JSON.parse(manifestText);
  const expected = validateManifest(manifest);
  const publicClient = createPublicClient({ transport: http(BRADBURY.rpcUrl, { retryCount: 0, timeout: 20000 }) });
  const [chainId, genesis, snapshot] = await Promise.all([
    publicClient.getChainId(), publicClient.getBlock({ blockNumber: 0n }), publicClient.getBlockNumber(),
  ]);
  if (chainId !== BRADBURY.chainId || genesis.hash?.toLowerCase() !== BRADBURY.genesisHash) throw new Error('RPC network identity mismatch. Refusing old Phase 1 or unknown chain even if chain ID is 4221.');
  const addresses = {};
  for (const name of REQUIRED_NAMES) {
    const resolved = getAddress(await publicClient.readContract({ address: BRADBURY.addressManager, abi: ADDRESS_MANAGER_ABI, functionName: 'getAddress', args: [name], blockNumber: snapshot }));
    if (resolved.toLowerCase() !== expected[name].toLowerCase()) throw new Error(`On-chain ${name} differs from the official sealed manifest. No transaction submitted.`);
    const code = await publicClient.getCode({ address: resolved, blockNumber: snapshot });
    if (!code || code === '0x') throw new Error(`${name} has no deployed code at the verified snapshot.`);
    addresses[name] = resolved;
  }
  const dataRegistry = await publicClient.readContract({ address: addresses.ConsensusData, abi: parseAbi(['function addressManager() view returns (address)']), functionName: 'addressManager', blockNumber: snapshot });
  if (dataRegistry.toLowerCase() !== BRADBURY.addressManager.toLowerCase()) throw new Error('ConsensusData points at an unexpected AddressManager.');
  const chain = overrideChain(addresses);
  const client = createClient({ chain, endpoint: BRADBURY.rpcUrl, ...(account ? { account } : {}) });
  const metadata = {
    network: 'bradbury-phase-2', rpcUrl: BRADBURY.rpcUrl, chainId,
    genesisHash: genesis.hash, addressManager: BRADBURY.addressManager,
    checkedAt: new Date().toISOString(), snapshotBlock: snapshot.toString(),
    manifestUrl: BRADBURY.manifestUrl,
    manifestSha256: createHash('sha256').update(manifestText).digest('hex'), addresses,
  };
  return { client, publicClient, chain, metadata };
}

const FEE_QUOTE_ABI = parseAbi([
  'function GENPerTimeUnit() view returns (uint256)',
  'function storageUnitPrice() view returns (uint256)',
  'function quoteGasPrice() view returns (uint256)',
  'function useChainDerivedReceiptPrice() view returns (bool)',
  'function calculateRoundFees((uint256 leaderTimeunitsAllocation,uint256 validatorTimeunitsAllocation,uint256 appealRounds,uint256 executionBudgetPerRound,uint256 executionConsumed,uint256 totalMessageFees,uint256[] rotations,uint256 maxPriceGenPerTimeUnit,uint256 storageFeeMaxGasPrice,uint256 receiptFeeMaxGasPrice),uint256,uint256) view returns (uint256)',
]);

export function developmentDistribution(options, policy, chain) {
  // Same rc.2 cap and rotation rules. The profile explicitly supplies the
  // execution budget, so the SDK's unused default-budget eth_call is omitted.
  const cap = value => value === 0n ? 0n : (value * 12000n + 9999n) / 10000n;
  const rounds = Number(options.appealRounds + 1n);
  if (!Number.isSafeInteger(rounds) || rounds > 8) throw new Error('Development profile has too many appeal rounds.');
  return createFeesDistribution({ ...options,
    rotations: Array.from({ length: rounds }, () => BigInt(chain.defaultConsensusMaxRotations)),
    maxPriceGenPerTimeUnit: cap(policy.genPerTimeUnit),
    storageFeeMaxGasPrice: cap(policy.storageUnitPrice),
    receiptFeeMaxGasPrice: cap(policy.receiptGasPrice),
  });
}

export async function quoteDevelopmentProfile(client) {
  const profile = JSON.parse(await readFile(resolve(PROJECT_ROOT, 'src/fee-profile.json'), 'utf8'));
  const options = {};
  for (const key of ['leaderTimeunitsAllocation', 'validatorTimeunitsAllocation', 'executionBudgetPerRound', 'appealRounds']) {
    if (!/^\d+$/.test(String(profile[key]))) throw new Error(`Invalid fee profile field ${key}`);
    options[key] = BigInt(profile[key]);
  }
  const chain = client.chain;
  if (chain?.id !== BRADBURY.chainId || chain.isStudio || !chain.feeManagerContract?.address) throw new Error('Expected verified public Bradbury client.');
  const reader = createPublicClient({ transport: http(BRADBURY.rpcUrl, { retryCount: 0, timeout: 20000 }) });
  const address = chain.feeManagerContract.address;
  const read = functionName => reader.readContract({ address, abi: FEE_QUOTE_ABI, functionName });
  const [genPerTimeUnit, storageUnitPrice, quotedGasPrice, derived, gasPrice] = await Promise.all([
    read('GENPerTimeUnit'), read('storageUnitPrice'), read('quoteGasPrice'), read('useChainDerivedReceiptPrice'), reader.getGasPrice(),
  ]);
  const enabled = derived || genPerTimeUnit > 0n || storageUnitPrice > 0n || quotedGasPrice > 0n;
  const receiptGasPrice = quotedGasPrice > (enabled ? gasPrice : 0n) ? quotedGasPrice : (enabled ? gasPrice : 0n);
  if (enabled && receiptGasPrice === 0n) throw new Error('Enabled fee policy quoted zero receipt gas price.');
  const policy = { enabled, genPerTimeUnit, storageUnitPrice, receiptGasPrice };
  const distribution = developmentDistribution(options, policy, chain);
  const roundFees = await reader.readContract({ address, abi: FEE_QUOTE_ABI, functionName: 'calculateRoundFees', args: [distribution, BigInt(chain.defaultNumberOfInitialValidators), 0n] });
  const quote = { distribution, feeValue: roundFees + distribution.totalMessageFees, policy };
  return { quote, profile, scope: 'Development allocation quoted at current public-chain prices; protocol deposit only, excluding the L2 envelope gas. Not a measured Bradbury worst-case certification.' };
}

export async function protocolInclusion(connection, txId, fromBlock) {
  // SDK deployment returns a GenLayer protocol ID. Locate its indexed event;
  // only that event's EVM hash can be used for an Ethereum receipt lookup.
  const reader = connection.publicClient;
  const start = BigInt(fromBlock);
  const latest = await reader.getBlockNumber();
  if (start < 0n || start > latest) throw new Error('Inclusion search requires a known starting block range.');
  // 从提交前区块向后最多扫描 20,000 个区块，兼顾历史交易归档校验与日志查询有界性。
  const end = start + 20000n < latest ? start + 20000n : latest;
  const events = [
    { address: connection.metadata.addresses.ConsensusMain, event: parseAbiItem('event NewTransaction(bytes32 indexed txId,address indexed recipient,address indexed activator)') },
    { address: connection.metadata.addresses.TransactionManager, event: parseAbiItem('event CreatedTransaction(bytes32 indexed txId,uint256 txSlot)') },
  ];
  for (let lower = start; lower <= end; lower += 1000n) {
    const upper = lower + 999n < end ? lower + 999n : end;
    for (const spec of events) {
      const logs = await reader.getLogs({ ...spec, args: { txId }, fromBlock: lower, toBlock: upper, strict: true });
      for (const log of logs) {
        if (log.removed || log.args.txId?.toLowerCase() !== txId.toLowerCase() || !log.transactionHash) continue;
        const receipt = await reader.getTransactionReceipt({ hash: log.transactionHash });
        const matched = receipt.logs.some(item => item.logIndex === log.logIndex && item.address.toLowerCase() === log.address.toLowerCase() && item.topics[1]?.toLowerCase() === txId.toLowerCase());
        if (matched && receipt.status === 'success' && receipt.transactionHash.toLowerCase() === log.transactionHash.toLowerCase() && receipt.blockHash && receipt.blockHash === log.blockHash && log.address.toLowerCase() === spec.address.toLowerCase()) return { verified: true, protocolTxId: txId, envelopeHash: receipt.transactionHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString(), event: spec.event.name, logIndex: log.logIndex };
      }
    }
  }
  return { verified: false, protocolTxId: txId, searchedFromBlock: start.toString(), searchedToBlock: end.toString(), reason: 'No matching protocol event and successful EVM receipt observed in this bounded range.' };
}

// Independent read-only verifier: usable from a second process even while an
// older in-memory session retains the only copy of its temporary signing keys.
export async function verifyDeploymentEvidence(connection, { hash, actorAddress, sourceSha256, fromBlock, readback }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '') || !/^0x[0-9a-fA-F]{40}$/.test(actorAddress || '') || !/^[0-9a-f]{64}$/.test(sourceSha256 || '')) throw new Error('A public protocol ID, actor address and source SHA256 are required.');
  if (!readback || typeof readback.method !== 'string' || !Object.hasOwn(readback, 'expected')) throw new Error('An explicit expected final-state readback is required.');
  const transaction = await connection.client.getTransaction({ hash });
  const operationProof = verifyTrackedOperation(transaction, { operation: 'deploy', sourceSha256 }, actorAddress);
  const decodedAddress = transaction.txDataDecoded?.contractAddress;
  const recipient = transaction.recipient;
  const candidate = decodedAddress || recipient;
  const addressConsistent = /^0x[0-9a-fA-F]{40}$/.test(candidate || '') && (!decodedAddress || !recipient || decodedAddress.toLowerCase() === recipient.toLowerCase());
  const finalized = transaction.statusName === 'FINALIZED';
  const executionSuccessful = executionSucceeded(transaction);
  const blockEvidence = await protocolInclusion(connection, hash, fromBlock);
  let finalReadback = { verified: false, observed: false };
  if (addressConsistent && executionSuccessful) {
    const value = await connection.client.readContract({ address: candidate, functionName: readback.method, args: readback.args || [], transactionHashVariant: 'latest-final' });
    finalReadback = { verified: publicJson(value) === publicJson(readback.expected), observed: true, variant: 'latest-final', address: candidate, method: readback.method, value, expected: readback.expected };
  }
  return { protocolTxId: hash, actorAddress, contractAddress: candidate || null, addressConsistent, status: transaction.statusName, execution: transaction.txExecutionResultName, finalized, consensusAccepted: consensusAccepted(transaction), consensusOutcome: transaction.lifecycle?.outcome || null, consensusResult: transaction.resultName || transaction.result || null, executionSuccessful, ...operationProof, blockEvidence, readback: finalReadback, fullyVerified: !!(addressConsistent && operationProof.operationVerified && executionSuccessful && blockEvidence.verified && finalReadback.verified) };
}

export async function projectFile(name, extension) {
  if (typeof name !== 'string' || !name || isAbsolute(name)) throw new Error('Use a project-relative input path.');
  const root = await realpath(PROJECT_ROOT);
  const file = await realpath(resolve(root, name));
  const rel = relative(root, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || (extension && !file.endsWith(extension))) throw new Error('Input must stay within this project with the expected extension.');
  const details = await stat(file);
  if (!details.isFile() || details.size > 131072) throw new Error('Input must be a regular file under 128 KiB.');
  return file;
}

export async function contractSource(name = 'contracts/research_receipt.py') {
  const file = await projectFile(name, '.py');
  const bytes = await readFile(file);
  const code = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!code.trim()) throw new Error('Contract source is empty.');
  return { code, file, sourceSha256: createHash('sha256').update(bytes).digest('hex') };
}
