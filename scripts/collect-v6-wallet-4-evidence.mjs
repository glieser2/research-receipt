// 针对子 VM 异常捕获加固方案（v6-wallet-4 + compact_v3 部署工件）的只读证据收集器。
// 严禁接触私钥、签名、广播、增补资金、调用模型或使用重放式 trace；
// 保持原 33 笔历史交易（0x29eb...）、v6-wallet-2 回滚证据（0xfa5156...）与 v6-wallet-3 中止归档（0x39b4178d...）完整隔离并逐字节核验。
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT, safeError } from './bradbury-client.mjs';
import {
  COLLECT_ACK,
  DEPLOYMENT_SOURCE_SHA256 as V1_COMPACT_SOURCE_SHA256,
  HISTORICAL_METADATA_SHA256,
  HISTORICAL_TRANSACTIONS,
  HISTORICAL_UNDETERMINED,
  PLAN_SHA256 as ORIGINAL_PLAN_SHA256,
  collectV6Evidence,
  loadV6Inputs,
  notCollectedEvidence,
  validateV6Ledger,
} from './collect-v6-evidence.mjs';

export const WALLET_4_PLAN_FILE = 'docs/evidence/v6-wallet-4-validation-plan.json';
export const WALLET_4_PLAN_SHA256 = 'e65905d24990f7f1bc0fd20ae8b172d57c3290f7ae531b9711077205a46839d0';
export const WALLET_4_FIXTURE_SHA256 = '0c851377287cfe46476fdb11d2dfd9f4ca29cdf94adbc6cf41cd956582648f0e';
export const WALLET_4_CANONICAL_SOURCE_SHA256 = 'ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f';
export const WALLET_4_DEPLOYMENT_SOURCE_SHA256 = '5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf';
export const WALLET_4_OWNER = '0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd';

export const WALLET_1_SUPERSEDED_PLAN_SHA256 = '04dbef08dc757f7457808d04f320b8cade446ca507596388e9f275e830753f77';
export const WALLET_1_SUPERSEDED_OWNER = '0xfdb942f537095d8e0c36b97a3b0324de81db9c3f';
export const WALLET_2_SUPERSEDED_PLAN_SHA256 = '306f742ac1b8bbdb8c01f0125c565dafe2c059ff1627cc1ed4f62c5804924b89';
export const WALLET_2_REVERT_EVIDENCE_SHA256 = '2e568bbf60856e864fc78f9d799d1a78505933675c61f8c7daad4b52effb496d';
export const WALLET_2_REVERTED_ENVELOPE_HASH = '0xfa51562ff02e0e19346723c3ba2687654b2c4682d86d28104851c62b7db6ba23';
export const WALLET_3_SUPERSEDED_PLAN_SHA256 = '76c2583b393255b241e670e5ba418a7517003d56afdfd1316f0c5c746c8a1b1a';
export const WALLET_3_SUPERSEDED_DEPLOYMENT_SOURCE_SHA256 = '2af33b26424a8bc2399d71cdb6a2ccdbd53acb0e4fc06de1ede14bb7791e42e2';
export const WALLET_3_ATTEMPT_EVIDENCE_SHA256 = '86367e7adf8d92db20725069697077063622cc2c93854d1e28f1913135b14e00';
export const WALLET_3_HALTED_CONTRACT = '0xc7d9a5e9fa776f76b1348c7009ea23de6d873885';
export const WALLET_3_SUPERSEDED_DEPLOYMENT_HASH = '0xb779bee838ba50edfaeadab383a243f380f47bcabbe8a6c7fd2fcf6aca6bd97d';
export const WALLET_3_SUPERSEDED_DEPLOYMENT_ENVELOPE_HASH = '0x060712d44799b13273cf0cc1fb7954e3c860de332d35be7bb4b0077d318ff2c5';
export const WALLET_3_HALTED_TX_ID = '0x39b4178dff177c52a319270efafe9618d944606421c30210e53a38c0d52b80a9';
export const HISTORICAL_OWNER = '0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70';

export const WALLET_4_LEDGER_FILE = 'artifacts/bradbury/v6-wallet-4-execution-ledger.json';
export const WALLET_4_OUTPUT_FILE = 'docs/evidence/bradbury-v6-wallet-4-e2e.json';
export const WALLET_4_COLLECT_ACK = 'READ_ONLY_V6_WALLET_4_PUBLIC_EVIDENCE';

const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function localBytes(name, root = PROJECT_ROOT) {
  ensure(typeof name === 'string' && !isAbsolute(name), 'Input must be project-relative');
  const base = await realpath(root);
  const path = await realpath(resolve(base, name.replaceAll('\\', '/')));
  const rel = relative(base, path);
  ensure(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Input escapes project');
  const details = await stat(path);
  ensure(details.isFile() && details.size < 32 * 1024 * 1024, 'Invalid or oversized evidence file');
  return readFile(path);
}

export async function loadV6Wallet4Inputs({ root = PROJECT_ROOT, requireArchivedEvidence = false } = {}) {
  const inputs = await loadV6Inputs({
    root,
    requireArchivedEvidence,
    planFile: WALLET_4_PLAN_FILE,
    planSha256: WALLET_4_PLAN_SHA256,
    deploymentSourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
  });
  ensure(
    inputs.plan.executionAuthority === 'user-controlled-wallet' &&
      inputs.plan.executionRun === 'v6-wallet-4' &&
      inputs.owner === WALLET_4_OWNER &&
      inputs.plan.fixtureSha256 === WALLET_4_FIXTURE_SHA256 &&
      inputs.plan.sourceCommitment?.sha256 === WALLET_4_CANONICAL_SOURCE_SHA256 &&
      inputs.deploymentSourceSha256 === WALLET_4_DEPLOYMENT_SOURCE_SHA256,
    'Frozen v6-wallet-4 plan identity mismatch',
  );
  ensure(
    inputs.plan.supersedesExecutionPlan?.sha256 === ORIGINAL_PLAN_SHA256 &&
      inputs.plan.supersedesWallet1Plan?.sha256 === WALLET_1_SUPERSEDED_PLAN_SHA256 &&
      inputs.plan.supersedesWallet1Plan?.supersededOwner === WALLET_1_SUPERSEDED_OWNER &&
      inputs.plan.supersedesWallet2Plan?.sha256 === WALLET_2_SUPERSEDED_PLAN_SHA256 &&
      inputs.plan.supersedesWallet2Plan?.revertedDeploymentEvidenceSha256 === WALLET_2_REVERT_EVIDENCE_SHA256 &&
      inputs.plan.supersedesWallet2Plan?.revertedEnvelopeHash === WALLET_2_REVERTED_ENVELOPE_HASH &&
      inputs.plan.supersedesWallet2Plan?.supersededDeploymentSourceSha256 === V1_COMPACT_SOURCE_SHA256 &&
      inputs.plan.supersedesWallet3Plan?.sha256 === WALLET_3_SUPERSEDED_PLAN_SHA256 &&
      inputs.plan.supersedesWallet3Plan?.supersededDeploymentSourceSha256 === WALLET_3_SUPERSEDED_DEPLOYMENT_SOURCE_SHA256 &&
      inputs.plan.supersedesWallet3Plan?.attemptEvidenceSha256 === WALLET_3_ATTEMPT_EVIDENCE_SHA256 &&
      inputs.plan.supersedesWallet3Plan?.supersededContractAddress?.toLowerCase() === WALLET_3_HALTED_CONTRACT &&
      inputs.plan.supersedesWallet3Plan?.haltedProtocolTxId?.toLowerCase() === WALLET_3_HALTED_TX_ID &&
      inputs.plan.supersedesWallet3Plan?.haltedCaseSequence === 47,
    'Frozen v6-wallet-4 lineage commitment mismatch',
  );
  return inputs;
}

export function validateV6Wallet4Ledger(ledger, inputs) {
  ensure(
    ledger?.planSha256 !== ORIGINAL_PLAN_SHA256 &&
      ledger?.planSha256 !== WALLET_1_SUPERSEDED_PLAN_SHA256 &&
      ledger?.planSha256 !== WALLET_2_SUPERSEDED_PLAN_SHA256 &&
      ledger?.planSha256 !== WALLET_3_SUPERSEDED_PLAN_SHA256,
    'Superseded or historical plan ledger cannot be used for v6-wallet-4',
  );
  ensure(
    !ledger?.transportAddendum,
    'User-wallet run uses the locked wallet owner for all 51 cases; transport addendum is forbidden',
  );
  if (ledger?.executionRun !== undefined) {
    ensure(ledger.executionRun === 'v6-wallet-4', 'Ledger executionRun mismatch');
  }
  if (ledger?.release?.contractAddress !== undefined) {
    ensure(
      ledger.release.contractAddress.toLowerCase() !== WALLET_3_HALTED_CONTRACT,
      'Superseded v6-wallet-3 contract address cannot be reused for v6-wallet-4',
    );
  }
  const forbiddenHashes = new Set([
    WALLET_2_REVERTED_ENVELOPE_HASH,
    WALLET_3_SUPERSEDED_DEPLOYMENT_HASH,
    WALLET_3_SUPERSEDED_DEPLOYMENT_ENVELOPE_HASH,
    WALLET_3_HALTED_TX_ID,
  ]);
  if (typeof ledger?.release?.deploymentHash === 'string') {
    ensure(
      !forbiddenHashes.has(ledger.release.deploymentHash.toLowerCase()),
      'Superseded historical deployment/halted hash cannot be used in v6-wallet-4 release',
    );
  }
  if (Array.isArray(ledger?.attempts)) {
    for (const row of ledger.attempts) {
      ensure(
        row?.hash?.toLowerCase() !== WALLET_2_REVERTED_ENVELOPE_HASH &&
          row?.envelopeHash?.toLowerCase() !== WALLET_2_REVERTED_ENVELOPE_HASH,
        'Reverted v6-wallet-2 deployment envelope cannot appear in v6-wallet-4 case attempts',
      );
      ensure(
        !forbiddenHashes.has(row?.hash?.toLowerCase()) &&
          !forbiddenHashes.has(row?.envelopeHash?.toLowerCase()),
        'Halted or superseded v6-wallet-3 transaction cannot appear in v6-wallet-4 case attempts',
      );
    }
  }
  validateV6Ledger(ledger, inputs);
}

export function notCollectedWallet4Evidence() {
  return notCollectedEvidence({
    planFile: WALLET_4_PLAN_FILE,
    planSha256: WALLET_4_PLAN_SHA256,
    executionRun: 'v6-wallet-4',
    owner: WALLET_4_OWNER,
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function withRpcRetry(fn, label, timeoutMs = 20000, maxAttempts = 5) {
  return async (...args) => {
    let lastError;
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await Promise.race([
          fn(...args),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`RPC timeout (${label})`)), timeoutMs),
          ),
        ]);
      } catch (err) {
        lastError = err;
        if (i + 1 < maxAttempts) await sleep(1500 * (i + 1));
      }
    }
    throw lastError;
  };
}

function wrapResilientConnection(connection, ledger) {
  const rawClient = connection.client;
  const rawPublic = connection.publicClient;
  let txFetchedCount = 0;
  const client = {
    ...rawClient,
    getTransaction: withRpcRetry(async (...args) => {
      txFetchedCount += 1;
      if (txFetchedCount === 1 || txFetchedCount % 10 === 0 || txFetchedCount === 84) {
        process.stderr.write(`[collector-progress] fetched ${txFetchedCount}/84 protocol txs\n`);
      }
      return rawClient.getTransaction(...args);
    }, 'client.getTransaction'),
    readContract: withRpcRetry(rawClient.readContract.bind(rawClient), 'client.readContract'),
  };
  const receiptCache = new Map();
  const getCachedReceipt = withRpcRetry(async args => {
    const key = String(args?.hash || '').toLowerCase();
    if (key && receiptCache.has(key)) return receiptCache.get(key);
    const receipt = await rawPublic.getTransactionReceipt(args);
    if (key && receipt) receiptCache.set(key, receipt);
    return receipt;
  }, 'publicClient.getTransactionReceipt');
  const publicClient = {
    ...rawPublic,
    getBlockNumber: withRpcRetry(rawPublic.getBlockNumber.bind(rawPublic), 'publicClient.getBlockNumber'),
    getBlock: withRpcRetry(rawPublic.getBlock.bind(rawPublic), 'publicClient.getBlock'),
    getTransaction: withRpcRetry(rawPublic.getTransaction.bind(rawPublic), 'publicClient.getTransaction'),
    getTransactionReceipt: getCachedReceipt,
    getLogs: withRpcRetry(rawPublic.getLogs.bind(rawPublic), 'publicClient.getLogs'),
    request: withRpcRetry(rawPublic.request.bind(rawPublic), 'publicClient.request'),
  };
  const envelopeByTxId = new Map();
  for (const row of ledger?.attempts || []) {
    if (typeof row?.hash === 'string' && typeof row?.envelopeHash === 'string') {
      envelopeByTxId.set(row.hash.toLowerCase(), row.envelopeHash.toLowerCase());
    }
  }
  const coreAddr = connection.metadata?.addresses?.ConsensusMain?.toLowerCase();
  let historicalLogsLoaded = false;
  const fastInclusion = async (conn, txId, fromBlock) => {
    const { decodeEventLog, parseAbiItem } = await import('viem');
    const newTxEvent = parseAbiItem(
      'event NewTransaction(bytes32 indexed txId,address indexed recipient,address indexed activator)',
    );
    const key = String(txId).toLowerCase();
    if (!envelopeByTxId.has(key) && !historicalLogsLoaded && coreAddr) {
      historicalLogsLoaded = true;
      const logs = await conn.publicClient.getLogs({
        address: connection.metadata.addresses.ConsensusMain,
        event: newTxEvent,
        fromBlock: 216418n,
        toBlock: 217900n,
      });
      for (const l of logs) {
        if (!l.removed && l.topics?.[1] && l.transactionHash) {
          envelopeByTxId.set(l.topics[1].toLowerCase(), l.transactionHash.toLowerCase());
        }
      }
    }
    const knownEnvelope = envelopeByTxId.get(key);
    if (knownEnvelope && coreAddr) {
      const receipt = await conn.publicClient.getTransactionReceipt({ hash: knownEnvelope });
      const log = receipt?.logs?.find(item => {
        if (
          item.removed ||
          item.address?.toLowerCase() !== coreAddr ||
          item.topics?.[1]?.toLowerCase() !== key
        ) {
          return false;
        }
        try {
          const decoded = decodeEventLog({
            abi: [newTxEvent],
            data: item.data,
            topics: item.topics,
            strict: true,
          });
          return decoded.eventName === 'NewTransaction' && decoded.args?.txId?.toLowerCase() === key;
        } catch {
          return false;
        }
      });
      if (log && receipt.status === 'success') {
        return {
          verified: true,
          protocolTxId: txId,
          envelopeHash: receipt.transactionHash,
          blockHash: receipt.blockHash,
          blockNumber: receipt.blockNumber.toString(),
          event: 'NewTransaction',
          logIndex: log.logIndex,
        };
      }
    }
    const { protocolInclusion } = await import('./bradbury-client.mjs');
    return protocolInclusion(conn, txId, fromBlock);
  };
  return {
    connection: { ...connection, client, publicClient },
    inclusion: fastInclusion,
  };
}

export async function collectV6Wallet4Evidence(ledger, options = {}, dependencies = {}) {
  ensure(
    options.ack === WALLET_4_COLLECT_ACK,
    'Read-only wallet-4 network collection requires explicit WALLET_4_COLLECT_ACK',
  );
  const inputs =
    dependencies.inputs || (await loadV6Wallet4Inputs({ requireArchivedEvidence: true }));
  validateV6Wallet4Ledger(ledger, inputs);
  let effectiveDeps = { ...dependencies, inputs };
  if (!dependencies.connection) {
    const { connectBradbury } = await import('./bradbury-client.mjs');
    const rawConn = await connectBradbury();
    const wrapped = wrapResilientConnection(rawConn, ledger);
    effectiveDeps = {
      ...effectiveDeps,
      connection: wrapped.connection,
      inclusion: dependencies.inclusion || wrapped.inclusion,
    };
  }
  return collectV6Evidence(
    ledger,
    {
      ...options,
      ack: COLLECT_ACK,
      planFile: WALLET_4_PLAN_FILE,
      planSha256: WALLET_4_PLAN_SHA256,
      deploymentSourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
    },
    effectiveDeps,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--collect')) {
    const inputs = await loadV6Wallet4Inputs();
    console.log(
      JSON.stringify(
        {
          ...notCollectedWallet4Evidence(),
          deploymentSourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
          dependenciesComplete: inputs.dependenciesComplete,
          missingArchivedEvidence: inputs.missingArchivedEvidence,
          commitments: inputs.commitments,
          selfTest: args.includes('--self-test')
            ? inputs.dependenciesComplete
              ? 'LOCAL_WALLET_4_COMMITMENTS_VERIFIED'
              : 'AVAILABLE_LOCAL_WALLET_4_COMMITMENTS_VERIFIED'
            : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }
  ensure(
    process.env.RESEARCH_RECEIPT_V6_WALLET_4_COLLECT_ACK === WALLET_4_COLLECT_ACK,
    'Set explicit RESEARCH_RECEIPT_V6_WALLET_4_COLLECT_ACK for read-only wallet-4 collection',
  );
  const option = name => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const ledger = JSON.parse(await localBytes(option('--ledger') || WALLET_4_LEDGER_FILE));
  const evidence = await collectV6Wallet4Evidence(ledger, { ack: WALLET_4_COLLECT_ACK });
  ensure(
    evidence.status === 'COLLECTED' &&
      evidence.ready === true &&
      evidence.allRequiredCasesPassed === true,
    `Refusing to write incomplete v6-wallet-4 evidence (status=${evidence.status}, passed=${evidence.cases.filter(r => r.passed).length}/51, history=${evidence.historicalTransactions.filter(r => r.historicalVerified).length}/33, failures=${JSON.stringify(evidence.failures)})`,
  );
  const output = resolve(PROJECT_ROOT, WALLET_4_OUTPUT_FILE);
  await mkdir(dirname(output), { recursive: true });
  const handle = await open(output, 'wx');
  try {
    await handle.writeFile(JSON.stringify(evidence, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  console.log(
    JSON.stringify({
      output: WALLET_4_OUTPUT_FILE,
      executionRun: 'v6-wallet-4',
      owner: WALLET_4_OWNER,
      deploymentSourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
      status: evidence.status,
      ready: evidence.ready,
      passed: evidence.cases.filter(row => row.passed).length,
      required: 51,
      retainedHistory: evidence.historicalTransactions.length,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}

export {
  HISTORICAL_METADATA_SHA256,
  HISTORICAL_TRANSACTIONS,
  HISTORICAL_UNDETERMINED,
  V1_COMPACT_SOURCE_SHA256,
};
