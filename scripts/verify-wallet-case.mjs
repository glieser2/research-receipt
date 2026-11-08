// 用例（2..51）发送后独立只读核验器与台账推进器。
// 严禁调用 gen_dbg_traceTransaction（会重跑模型），ERROR 用例仅使用 gen_getTransactionData 读取已存储输出。
// 任何共识或语义不符立即停止并保留完整证据，严禁重采样掩盖失败。
import assert from 'node:assert/strict';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPublicClient, decodeEventLog, decodeFunctionData, http, parseAbiItem } from 'viem';
import { PROJECT_ROOT, connectBradbury, publicJson, safeError } from './bradbury-client.mjs';
import { canonical, sha256 } from './bradbury-gas-aware-session.mjs';
import { saveV6Capture } from './capture-v6-case.mjs';
import {
  runtimeTransactionDatetime,
  transactionOutcome,
  validateCaseReadbacks,
  validateExpectedGuardError,
  verifyTransactionIdentity,
  verifyV6Inclusion,
} from './collect-v6-evidence.mjs';
import {
  WALLET_4_DEPLOYMENT_SOURCE_SHA256,
  WALLET_4_LEDGER_FILE,
  WALLET_4_OWNER,
  WALLET_4_PLAN_FILE,
  WALLET_4_PLAN_SHA256,
  loadV6Wallet4Inputs,
  validateV6Wallet4Ledger,
} from './collect-v6-wallet-4-evidence.mjs';
import { CASE_REVIEW_FORMAT, CASE_REVIEW_OUTPUT, buildCaseCallRequest } from './prepare-wallet-case.mjs';
import { DEPLOYMENT_PROOF_FILE } from './verify-wallet-deployment.mjs';

const L2_SECONDARY = 'https://rpc.testnet-chain.genlayer.com';
const NEW_TX_EVENT = parseAbiItem(
  'event NewTransaction(bytes32 indexed txId, address indexed recipient, address indexed activator)',
);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function durableWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const file = await open(path, 'w');
  try {
    await file.writeFile(publicJson(value) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
}

export async function verifyWallet3Case() {
  throw new Error('v6-wallet-3 is halted and archived; use verifyWallet4Case / run-wallet-4-cases.mjs');
}

export async function verifyWallet4Case({
  sequence,
  envelopeHash,
  submittedAt,
  caseReviewFile = CASE_REVIEW_OUTPUT,
  ledgerFile = WALLET_4_LEDGER_FILE,
  deploymentProofFile = DEPLOYMENT_PROOF_FILE,
  maxPollAttempts = 160,
  pollIntervalMs = 3000,
}) {
  const seq = Number(sequence);
  assert.ok(Number.isInteger(seq) && seq >= 2 && seq <= 51, 'Sequence must be in 2..51');
  assert.match(envelopeHash, /^0x[0-9a-fA-F]{64}$/, 'Valid 32-byte EVM envelopeHash is required');

  const inputs = await loadV6Wallet4Inputs();
  const ledgerAbs = resolve(PROJECT_ROOT, ledgerFile);
  const ledger = JSON.parse(await readFile(ledgerAbs, 'utf8'));
  validateV6Wallet4Ledger(ledger, inputs);
  assert.equal(ledger.attempts.length, seq - 1, `Ledger attempts=${ledger.attempts.length} != ${seq - 1}`);

  const review = JSON.parse(await readFile(resolve(PROJECT_ROOT, caseReviewFile), 'utf8'));
  assert.equal(review.format, CASE_REVIEW_FORMAT);
  assert.equal(review.verified, true);
  assert.equal(review.planSha256, WALLET_4_PLAN_SHA256);
  assert.equal(review.sequence, seq);
  assert.equal(sha256(canonical(review.callRequest)), review.callRequestHash, 'Case callRequestHash mismatch');
  const planned = inputs.plan.cases[seq - 1];
  assert.equal(review.caseName, planned.name);

  const beforeDoc = JSON.parse(await readFile(resolve(PROJECT_ROOT, review.beforeCaptureFile), 'utf8'));
  assert.equal(beforeDoc.captureComplete, true, 'Missing complete before capture');

  const effectiveSubmittedAt = submittedAt || review.verifiedAt;
  assert.ok(
    beforeDoc.rawReads.every(r => Date.parse(r.observedAt) <= Date.parse(effectiveSubmittedAt)),
    'Before capture timestamp exceeds submittedAt',
  );
  assert.ok(
    Date.parse(effectiveSubmittedAt) >= Date.parse(ledger.attempts[seq - 2].finalizedAt),
    'Case submittedAt predates previous case finalizedAt',
  );
  if (seq === 14) {
    assert.ok(
      ledger.firstGate?.verifiedAt &&
        Date.parse(effectiveSubmittedAt) >= Date.parse(ledger.firstGate.verifiedAt),
      'Case 14 submittedAt predates firstGate.verifiedAt',
    );
  }

  const connection = await connectBradbury();
  const secondary = createPublicClient({ transport: http(L2_SECONDARY, { retryCount: 0, timeout: 25000 }) });

  let receipt = null;
  for (let i = 0; i < 40; i++) {
    try {
      receipt = await connection.publicClient.getTransactionReceipt({ hash: envelopeHash });
      if (receipt) break;
    } catch {
      // 等待 L2 打包
    }
    await sleep(2000);
  }
  assert.ok(receipt, 'L2 EVM receipt not yet available; retry verification without resending');

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

  assert.equal(receipt.status, 'success', `Case ${seq} L2 EVM envelope reverted`);
  assert.equal(secondaryReceipt.status, 'success', 'Secondary L2 RPC receipt status mismatch');
  assert.equal(secondaryReceipt.logs.length, receipt.logs.length, 'Secondary L2 RPC receipt log count mismatch');
  assert.equal(blockPrimary.hash, receipt.blockHash);
  assert.equal(blockSecondary.hash, receipt.blockHash);

  const candidates = [
    review.callRequest,
    ...(Array.isArray(review.priorCallRequests)
      ? review.priorCallRequests.map(item => item?.callRequest).filter(Boolean)
      : []),
  ];
  let matchedReq =
    candidates.find(
      cand =>
        cand &&
        String(envelopeTx.nonce) === cand.nonce &&
        envelopeTx.input.toLowerCase() === cand.data.toLowerCase() &&
        String(envelopeTx.value) === cand.value &&
        String(envelopeTx.gas) === cand.gas &&
        String(envelopeTx.gasPrice) === cand.gasPrice,
    ) || null;
  if (!matchedReq) {
    // 若闲置刷新曾覆盖先前已弹出的同序号同 nonce 待签请求，按冻结计划参数与链上包络 validUntil/gas 做确定性重建与边界重验
    assert.equal(String(envelopeTx.nonce), review.callRequest.nonce, 'Envelope nonce mismatch');
    const decodedEnvelope = decodeFunctionData({
      abi: connection.chain.consensusMainContract.abi,
      data: envelopeTx.input,
    });
    assert.equal(decodedEnvelope.functionName, 'addTransaction');
    const onchainValidUntil = BigInt(decodedEnvelope.args[0].validUntil);
    assert.ok(
      onchainValidUntil >= blockPrimary.timestamp &&
        onchainValidUntil <= blockPrimary.timestamp + 7200n,
      'Envelope validUntil outside bounded 2h window',
    );
    matchedReq = buildCaseCallRequest({
      contractAddress: review.contractAddress,
      method: review.method,
      args: review.args,
      address: WALLET_4_OWNER,
      context: {
        chain: connection.chain,
        metadata: connection.metadata,
        quote: review.feeQuote,
        latestNonce: BigInt(review.callRequest.nonce),
        gasPrice: BigInt(envelopeTx.gasPrice),
      },
      validUntil: String(onchainValidUntil),
      gas: envelopeTx.gas,
    });
  }
  assert.equal(envelopeTx.from.toLowerCase(), WALLET_4_OWNER);
  assert.equal(envelopeTx.to?.toLowerCase(), matchedReq.to.toLowerCase());
  assert.equal(String(envelopeTx.nonce), matchedReq.nonce);
  assert.equal(envelopeTx.input.toLowerCase(), matchedReq.data.toLowerCase());
  assert.equal(String(envelopeTx.value), matchedReq.value);
  assert.equal(String(envelopeTx.gas), matchedReq.gas);
  assert.equal(String(envelopeTx.gasPrice), matchedReq.gasPrice);
  const matchedCallRequestHash = sha256(canonical(matchedReq));

  const coreLogs = receipt.logs.filter(
    log => !log.removed && log.address.toLowerCase() === connection.metadata.addresses.ConsensusMain.toLowerCase(),
  );
  const decodedEvents = [];
  for (const log of coreLogs) {
    try {
      const ev = decodeEventLog({ abi: [NEW_TX_EVENT], data: log.data, topics: log.topics, strict: true });
      if (ev.eventName === 'NewTransaction') decodedEvents.push({ log, args: ev.args });
    } catch {
      // 忽略其他内部日志
    }
  }
  assert.equal(decodedEvents.length, 1, `Expected exact 1 NewTransaction event, got ${decodedEvents.length}`);
  // NewTransaction.activator 为激活该协议交易的验证者地址；发送者由 envelopeTx.from 与 protocolTx.sender 双重锁定。
  const { log: matchedLog, args: eventArgs } = decodedEvents[0];
  const protocolTxId = eventArgs.txId.toLowerCase();
  assert.equal(eventArgs.recipient.toLowerCase(), ledger.release.contractAddress.toLowerCase());
  assert.match(eventArgs.activator.toLowerCase(), /^0x[0-9a-f]{40}$/);
  assert.notEqual(eventArgs.activator.toLowerCase(), '0x' + '0'.repeat(40));

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
  await verifyV6Inclusion(
    connection,
    { hash: protocolTxId, envelopeHash: envelopeHash.toLowerCase(), submittedAfterBlock },
    ledger.release,
    WALLET_4_OWNER,
    { inclusion: async () => rawInclusion },
  );

  // 只读轮询委员会共识终态（严禁重发或覆盖；容忍瞬时只读 RPC 网络抖动）
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
  assert.ok(protocolTx && protocolTx.statusName === 'FINALIZED', `Case ${seq} (${planned.name}) not yet FINALIZED`);
  const finalizedAt = new Date().toISOString();

  verifyTransactionIdentity(
    inputs,
    planned,
    { hash: protocolTxId },
    protocolTx,
    ledger.release,
  );

  const expectedExec = planned.expectedTransaction.executionResult;
  const outcome = transactionOutcome(protocolTx, expectedExec);
  if (!outcome.passed) {
    // 语义或共识未通过：先保存不可篡改失败诊断文件并立即中止，绝不重采样
    const failPath = resolve(
      PROJECT_ROOT,
      `artifacts/bradbury/v6-wallet-4/failure-case-${String(seq).padStart(2, '0')}-${planned.name}.json`,
    );
    await durableWrite(failPath, {
      sequence: seq,
      caseName: planned.name,
      envelopeHash: envelopeHash.toLowerCase(),
      protocolTxId,
      expectedExecutionResult: expectedExec,
      outcome,
      observedAt: finalizedAt,
    });
    throw new Error(
      `Case ${seq} (${planned.name}) failed consensus/outcome check: consensus=${outcome.consensusOutcome}/${outcome.consensusResult} exec=${outcome.execution}`,
    );
  }

  let errorEvidence = null;
  if (expectedExec === 'ERROR') {
    const round = Number(protocolTx.lastRound?.round);
    assert.ok(Number.isSafeInteger(round) && round >= 0 && round <= 255, 'Missing ERROR round');
    const stored = await connection.publicClient.request({
      method: 'gen_getTransactionData',
      params: [{ txId: protocolTxId, round }],
    });
    errorEvidence = validateExpectedGuardError(inputs, planned, protocolTx, stored);
  }

  // 确保 afterReads 所有采样时间严格 >= finalizedAt
  await sleep(15);
  const savedAfter = await saveV6Capture({
    capture: true,
    caseName: planned.name,
    stage: 'after',
    address: ledger.release.contractAddress.toLowerCase(),
    hash: protocolTxId,
    deploymentProofFile,
    planFile: WALLET_4_PLAN_FILE,
    planSha256: WALLET_4_PLAN_SHA256,
    deploymentSourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
  });
  assert.equal(savedAfter.captureComplete, true, `After capture incomplete for case ${seq}`);
  const afterDoc = JSON.parse(await readFile(resolve(PROJECT_ROOT, savedAfter.file), 'utf8'));

  const attemptRow = {
    sequence: seq,
    name: planned.name,
    intentId: `wallet-4-case-${seq}-${matchedCallRequestHash.slice(0, 12)}`,
    state: 'confirmed',
    hash: protocolTxId,
    envelopeHash: envelopeHash.toLowerCase(),
    submittedAfterBlock,
    submittedAt: effectiveSubmittedAt,
    finalizedAt,
    beforeReads: beforeDoc.rawReads,
    afterReads: afterDoc.rawReads,
  };

  const transactionDatetime =
    planned.method === 'evaluate' && !planned.readbackOracle.rollback
      ? runtimeTransactionDatetime(protocolTx)
      : undefined;
  const readbackProof = await validateCaseReadbacks(inputs, planned, attemptRow, {
    transactionDatetime,
  });

  ledger.attempts.push(attemptRow);
  if (seq === 13) {
    await sleep(10);
    ledger.firstGate = {
      throughSequence: 13,
      passed: true,
      verifiedAt: new Date().toISOString(),
      caseHashes: ledger.attempts.slice(0, 13).map(r => r.hash),
    };
  }
  validateV6Wallet4Ledger(ledger, inputs);
  await durableWrite(ledgerAbs, ledger);

  return {
    verified: true,
    sequence: seq,
    caseName: planned.name,
    expectedExecutionResult: expectedExec,
    envelopeHash: envelopeHash.toLowerCase(),
    protocolTxId,
    blockNumber: String(receipt.blockNumber),
    gasUsed: String(receipt.gasUsed),
    consensusResult: outcome.consensusResult,
    ownUserError: errorEvidence?.ownUserError ?? null,
    readbackVerified: readbackProof.verified,
    firstGatePassed: ledger.firstGate?.passed ?? null,
    afterCaptureFile: savedAfter.file,
    completedCases: ledger.attempts.length,
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
        usage: '--verify --sequence <2..51> --envelope-hash 0x... [--submitted-at ISO]',
      }),
    );
    return;
  }
  const result = await verifyWallet4Case({
    sequence: opt('--sequence'),
    envelopeHash: opt('--envelope-hash'),
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
