// 部署后独立只读核验器（Step 8）：
// 核验真实 L2 EVM 回执、ConsensusMain NewTransaction 事件、实际部署源码字节、
// 发送者、空构造参数、非 leaderOnly、FINALIZED + accepted 共识以及零订单基线，
// 生成 capture-v6-case 所需的独立部署证明并初始化 v6-wallet-4 执行台账第 1 项。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeInputData } from 'genlayer-js';
import { createPublicClient, decodeEventLog, http, parseAbiItem } from 'viem';
import { PROJECT_ROOT, connectBradbury, publicJson, safeError } from './bradbury-client.mjs';
import { canonical, sha256 } from './bradbury-gas-aware-session.mjs';
import { transactionOutcome, validateCaseReadbacks, verifyV6Inclusion } from './collect-v6-evidence.mjs';
import {
  WALLET_4_DEPLOYMENT_SOURCE_SHA256,
  WALLET_4_LEDGER_FILE,
  WALLET_4_OWNER,
  WALLET_4_PLAN_SHA256,
  loadV6Wallet4Inputs,
  validateV6Wallet4Ledger,
} from './collect-v6-wallet-4-evidence.mjs';

export const DEPLOYMENT_PROOF_FILE = 'artifacts/bradbury/v6-wallet-4/deployment-proof.json';
const L2_SECONDARY = 'https://rpc.testnet-chain.genlayer.com';
const NEW_TX_EVENT = parseAbiItem(
  'event NewTransaction(bytes32 indexed txId, address indexed recipient, address indexed activator)',
);

const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const emptyObj = value =>
  value instanceof Map
    ? value.size === 0
    : value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;

export async function verifyWallet4Deployment({
  envelopeHash,
  reviewFile = 'artifacts/wallet-validation/review.json',
  submittedAt,
  maxPollAttempts = 120,
  pollIntervalMs = 3000,
}) {
  assert.match(envelopeHash, /^0x[0-9a-fA-F]{64}$/, 'Valid 32-byte EVM envelopeHash is required');
  const inputs = await loadV6Wallet4Inputs();
  const reviewRaw = await readFile(resolve(PROJECT_ROOT, reviewFile), 'utf8');
  const review = JSON.parse(reviewRaw);
  assert.equal(review.planSha256, WALLET_4_PLAN_SHA256, 'Review bundle planSha256 mismatch');
  assert.equal(review.sourceSha256, WALLET_4_DEPLOYMENT_SOURCE_SHA256, 'Review bundle sourceSha256 mismatch');
  assert.equal(review.actor.toLowerCase(), WALLET_4_OWNER, 'Review bundle actor mismatch');
  assert.equal(review.verified, true, 'Review bundle is not verified');
  assert.equal(
    sha256(canonical(review.deploymentRequest)),
    review.deploymentRequestHash,
    'Review bundle deploymentRequestHash mismatch',
  );

  const connection = await connectBradbury();
  const secondary = createPublicClient({ transport: http(L2_SECONDARY, { retryCount: 0, timeout: 25000 }) });

  let receipt = null;
  for (let i = 0; i < 40; i++) {
    try {
      receipt = await connection.publicClient.getTransactionReceipt({ hash: envelopeHash });
      if (receipt) break;
    } catch {
      // 等待区块打包
    }
    await sleep(2000);
  }
  assert.ok(receipt, 'L2 EVM receipt not yet available; retry read-only verification without resending');

  let secondaryReceipt = null;
  for (let i = 0; i < 20; i++) {
    try {
      secondaryReceipt = await secondary.getTransactionReceipt({ hash: envelopeHash });
      if (secondaryReceipt) break;
    } catch {
      // 等待第二官方 L2 RPC 节点同步最新区块
    }
    await sleep(1500);
  }
  assert.ok(secondaryReceipt, 'Secondary L2 RPC receipt not yet synced; retry verification without resending');

  const [envelopeTx, blockPrimary, blockSecondary] = await Promise.all([
    connection.publicClient.getTransaction({ hash: envelopeHash }),
    connection.publicClient.getBlock({ blockNumber: receipt.blockNumber }),
    secondary.getBlock({ blockNumber: receipt.blockNumber }),
  ]);

  assert.equal(receipt.status, 'success', `L2 EVM deployment envelope reverted (status=${receipt.status})`);
  assert.equal(secondaryReceipt.status, 'success', 'Secondary L2 RPC receipt status mismatch');
  assert.equal(secondaryReceipt.logs.length, receipt.logs.length, 'Secondary L2 RPC receipt log count mismatch');
  assert.equal(blockPrimary.hash, receipt.blockHash);
  assert.equal(blockSecondary.hash, receipt.blockHash);

  const req = review.deploymentRequest;
  assert.equal(envelopeTx.from.toLowerCase(), WALLET_4_OWNER);
  assert.equal(envelopeTx.to?.toLowerCase(), connection.metadata.addresses.ConsensusMain.toLowerCase());
  assert.equal(envelopeTx.to?.toLowerCase(), req.to.toLowerCase());
  assert.equal(String(envelopeTx.nonce), req.nonce);
  assert.equal(envelopeTx.input.toLowerCase(), req.data.toLowerCase());
  assert.equal(String(envelopeTx.value), req.value);
  assert.equal(String(envelopeTx.gas), req.gas);
  assert.equal(String(envelopeTx.gasPrice), req.gasPrice);

  const coreLogs = receipt.logs.filter(
    log => !log.removed && log.address.toLowerCase() === connection.metadata.addresses.ConsensusMain.toLowerCase(),
  );
  const decodedEvents = [];
  for (const log of coreLogs) {
    try {
      const ev = decodeEventLog({ abi: [NEW_TX_EVENT], data: log.data, topics: log.topics, strict: true });
      if (ev.eventName === 'NewTransaction') {
        decodedEvents.push({ log, args: ev.args });
      }
    } catch {
      // 忽略 ConsensusMain 上其他事件（如内部状态日志）
    }
  }
  assert.equal(decodedEvents.length, 1, `Expected exact 1 NewTransaction event, got ${decodedEvents.length}`);
  // 注意：GenLayer ConsensusMain NewTransaction 事件第 3 个索引参数 activator 是被选中的激活验证者地址，
  // 真实交易发起方由外层 envelopeTx.from 与协议层 protocolTx.sender 双重锁定核验。
  const { log: matchedLog, args: eventArgs } = decodedEvents[0];
  const protocolTxId = eventArgs.txId.toLowerCase();
  const contractAddress = eventArgs.recipient.toLowerCase();
  assert.match(eventArgs.activator.toLowerCase(), /^0x[0-9a-f]{40}$/);
  assert.notEqual(eventArgs.activator.toLowerCase(), '0x' + '0'.repeat(40));
  assert.match(contractAddress, /^0x[0-9a-f]{40}$/);
  assert.notEqual(contractAddress, '0x' + '0'.repeat(40));

  const submittedAfterBlock = String(receipt.blockNumber - 1n);
  const rawInclusion = {
    verified: true,
    event: 'NewTransaction',
    protocolTxId,
    envelopeHash: envelopeHash.toLowerCase(),
    blockHash: receipt.blockHash,
    blockNumber: String(receipt.blockNumber),
    logIndex: matchedLog.logIndex,
  };
  const verifiedInclusion = await verifyV6Inclusion(
    connection,
    {
      hash: protocolTxId,
      envelopeHash: envelopeHash.toLowerCase(),
      submittedAfterBlock,
    },
    { contractAddress },
    WALLET_4_OWNER,
    { inclusion: async () => rawInclusion },
  );

  // 等待协议委员会共识进入 FINALIZED（纯只读轮询 gen_getTransactionByHash，容忍瞬时网络抖动）
  let protocolTx = null;
  let transientReadErrors = 0;
  for (let attempt = 0; attempt < maxPollAttempts; attempt++) {
    try {
      const current = await connection.client.getTransaction({ hash: protocolTxId });
      transientReadErrors = 0;
      if (current?.statusName === 'FINALIZED' || current?.statusName === 'CANCELED') {
        protocolTx = current;
        break;
      }
    } catch (pollErr) {
      transientReadErrors += 1;
      if (transientReadErrors >= 5) throw pollErr;
    }
    await sleep(pollIntervalMs);
  }
  assert.ok(protocolTx && protocolTx.statusName === 'FINALIZED', 'Protocol deployment not yet FINALIZED');
  assert.equal(protocolTx.sender?.toLowerCase(), WALLET_4_OWNER, 'Protocol deployment sender mismatch');
  assert.equal(protocolTx.recipient?.toLowerCase(), contractAddress, 'Protocol deployment recipient mismatch');
  const finalizedAt = new Date().toISOString();

  const outcome = transactionOutcome(protocolTx, 'RETURN');
  assert.equal(
    outcome.passed,
    true,
    `Deployment consensus outcome failed: status=${outcome.status} consensus=${outcome.consensusOutcome}/${outcome.consensusResult} exec=${outcome.execution}`,
  );

  const decodedDeploy =
    protocolTx.txDataDecoded ||
    (typeof protocolTx.tx_data === 'string'
      ? decodeInputData(
          protocolTx.tx_data.startsWith('0x') ? protocolTx.tx_data : '0x' + protocolTx.tx_data,
          protocolTx.recipient,
        )
      : null);
  assert.ok(decodedDeploy && decodedDeploy.type === 'deploy', 'Decoded protocol tx is not deploy');
  assert.equal(decodedDeploy.contractAddress.toLowerCase(), contractAddress);
  assert.equal(decodedDeploy.leaderOnly, false);
  assert.equal(emptyObj(decodedDeploy.constructorArgs), true);
  assert.equal(
    sha(Buffer.from(decodedDeploy.code, 'utf8')),
    WALLET_4_DEPLOYMENT_SOURCE_SHA256,
    'On-chain deployed code SHA-256 mismatch',
  );

  // 读取零订单基线与政策/目录 getters（均在 finalizedAt 之后采样）
  await sleep(10);
  const afterReads = [];
  for (const [method, args] of [
    ['get_order_count', []],
    ['get_policy_version', []],
    ['get_field_catalog', []],
  ]) {
    const value = await connection.client.readContract({
      address: contractAddress,
      functionName: method,
      args,
      transactionHashVariant: 'latest-final',
    });
    afterReads.push({
      method,
      args,
      variant: 'latest-final',
      value,
      observedAt: new Date().toISOString(),
    });
  }

  const case1Attempt = {
    sequence: 1,
    name: 'deployment',
    intentId: `wallet-4-case-1-${review.deploymentRequestHash.slice(0, 12)}`,
    state: 'confirmed',
    hash: protocolTxId,
    envelopeHash: envelopeHash.toLowerCase(),
    submittedAfterBlock,
    submittedAt: submittedAt || review.verifiedAt,
    finalizedAt,
    beforeReads: [],
    afterReads,
  };

  const baselineVerification = await validateCaseReadbacks(
    inputs,
    inputs.plan.cases[0],
    case1Attempt,
  );
  assert.equal(baselineVerification.deploymentZeroBaselineVerified, true);

  const deploymentProof = {
    format: 'research-receipt/v6-capture-deployment-proof/1',
    planSha256: WALLET_4_PLAN_SHA256,
    contractAddress,
    sourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
    protocolTxId,
    envelopeHash: envelopeHash.toLowerCase(),
    actorAddress: WALLET_4_OWNER,
    deploymentSourceVerified: true,
    finalized: true,
    consensusAccepted: true,
    execution: 'FINISHED_WITH_RETURN',
    constructorArgs: [],
    leaderOnly: false,
    zeroBaselineVerified: true,
    verifiedAt: new Date().toISOString(),
    inclusion: verifiedInclusion,
    network: {
      chainId: connection.metadata.chainId,
      genesisHash: connection.metadata.genesisHash,
      addressManager: connection.metadata.addressManager,
    },
  };

  const proofAbs = resolve(PROJECT_ROOT, DEPLOYMENT_PROOF_FILE);
  await mkdir(dirname(proofAbs), { recursive: true });
  const proofHandle = await open(proofAbs, 'wx');
  try {
    await proofHandle.writeFile(publicJson(deploymentProof) + '\n');
    await proofHandle.sync();
  } finally {
    await proofHandle.close();
  }

  const ledger = {
    format: 'research-receipt/v6-execution-ledger/1',
    executionRun: 'v6-wallet-4',
    planSha256: WALLET_4_PLAN_SHA256,
    fixtureSha256: inputs.plan.fixtureSha256,
    release: {
      contractAddress,
      deploymentHash: protocolTxId,
      sourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
      actorAddress: WALLET_4_OWNER,
    },
    attempts: [case1Attempt],
    transportFailures: [],
  };
  validateV6Wallet4Ledger(ledger, inputs);

  const ledgerAbs = resolve(PROJECT_ROOT, WALLET_4_LEDGER_FILE);
  await mkdir(dirname(ledgerAbs), { recursive: true });
  const ledgerHandle = await open(ledgerAbs, 'wx');
  try {
    await ledgerHandle.writeFile(publicJson(ledger) + '\n');
    await ledgerHandle.sync();
  } finally {
    await ledgerHandle.close();
  }

  return {
    verified: true,
    executionRun: 'v6-wallet-4',
    envelopeHash: envelopeHash.toLowerCase(),
    protocolTxId,
    contractAddress,
    blockNumber: String(receipt.blockNumber),
    gasUsed: String(receipt.gasUsed),
    consensusResult: outcome.consensusResult,
    zeroBaselineVerified: true,
    deploymentProofFile: DEPLOYMENT_PROOF_FILE,
    ledgerFile: WALLET_4_LEDGER_FILE,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = name => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  if (!args.includes('--verify')) {
    console.log(
      publicJson({
        started: false,
        networkRequests: 0,
        usage: '--verify --envelope-hash 0x... [--review-file artifacts/wallet-validation/review.json] [--submitted-at ISO]',
      }),
    );
    return;
  }
  const result = await verifyWallet4Deployment({
    envelopeHash: opt('--envelope-hash'),
    reviewFile: opt('--review-file') || 'artifacts/wallet-validation/review.json',
    submittedAt: opt('--submitted-at'),
  });
  console.log(publicJson(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
