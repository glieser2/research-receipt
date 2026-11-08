// 本地只读用例队列协调器（不接触私钥、不自动签名、不广播交易）。
// 逐笔准备 case-review.json，监测链上锁定钱包真实 nonce 推进后自动执行共识终态与状态回读核验，
// 任何语义或共识失败立即保存诊断并退出，严禁重采样。
import assert from 'node:assert/strict';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT, connectBradbury, publicJson, safeError } from './bradbury-client.mjs';
import {
  WALLET_3_LEDGER_FILE,
  WALLET_3_OWNER,
  WALLET_3_PLAN_SHA256,
  loadV6Wallet3Inputs,
  validateV6Wallet3Ledger,
} from './collect-v6-wallet-3-evidence.mjs';
import { CASE_REVIEW_OUTPUT, prepareWallet3Case } from './prepare-wallet-case.mjs';
import { verifyWallet3Case } from './verify-wallet-case.mjs';

export const CASE_STATUS_OUTPUT = 'artifacts/wallet-validation/case-status.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function coordinatorErrorSummary(error) {
  if (error?.name === 'AssertionError' && typeof error.message === 'string') {
    return `AssertionError: ${error.message}`
      .split('\n')[0]
      .replace(/0x[0-9a-fA-F]{64,}/g, '[redacted hex]')
      .slice(0, 500);
  }
  return safeError(error);
}

async function prepareWithTransientRetry(seq, maxAttempts = 3) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await prepareWallet3Case({ sequence: seq });
    } catch (err) {
      lastErr = err;
      if (i + 1 < maxAttempts) await sleep(3000);
    }
  }
  throw lastErr;
}

async function writeStatus(statusObj) {
  const path = resolve(PROJECT_ROOT, CASE_STATUS_OUTPUT);
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, 'w');
  try {
    await handle.writeFile(publicJson({ ...statusObj, updatedAt: new Date().toISOString() }) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function findEnvelopeByNonce(connection, actor, expectedNonceStr, fromBlockBigInt) {
  const latest = await connection.publicClient.getBlockNumber();
  const start = fromBlockBigInt > 0n ? fromBlockBigInt - 1n : 0n;
  // 优先检索 ConsensusMain 事件日志定位匹配的协议调用信封
  for (let lower = start; lower <= latest; lower += 500n) {
    const upper = lower + 499n < latest ? lower + 499n : latest;
    const logs = await connection.publicClient.getLogs({
      address: connection.metadata.addresses.ConsensusMain,
      fromBlock: lower,
      toBlock: upper,
    });
    const seenHashes = new Set();
    for (const log of logs) {
      if (!log.transactionHash || seenHashes.has(log.transactionHash)) continue;
      seenHashes.add(log.transactionHash);
      const tx = await connection.publicClient.getTransaction({ hash: log.transactionHash });
      if (tx.from.toLowerCase() === actor.toLowerCase() && String(tx.nonce) === expectedNonceStr) {
        return tx.hash;
      }
    }
  }
  // 回退逐块扫描交易（以防信封在 L2 层直接回滚而未触发事件）
  for (let b = start; b <= latest; b++) {
    const block = await connection.publicClient.getBlock({ blockNumber: b, includeTransactions: true });
    for (const tx of block.transactions) {
      if (tx.from.toLowerCase() === actor.toLowerCase() && String(tx.nonce) === expectedNonceStr) {
        return tx.hash;
      }
    }
  }
  return null;
}

export async function runWallet3Cases({ throughSequence }) {
  const target = Number(throughSequence);
  assert.ok(Number.isInteger(target) && target >= 2 && target <= 51, 'throughSequence must be in 2..51');

  const inputs = await loadV6Wallet3Inputs();
  const connection = await connectBradbury();
  const ledgerAbs = resolve(PROJECT_ROOT, WALLET_3_LEDGER_FILE);
  const reviewAbs = resolve(PROJECT_ROOT, CASE_REVIEW_OUTPUT);

  while (true) {
    const ledger = JSON.parse(await readFile(ledgerAbs, 'utf8'));
    validateV6Wallet3Ledger(ledger, inputs);
    const completed = ledger.attempts.length;
    if (completed >= target) {
      await writeStatus({
        stage: 'target-completed',
        completedCases: completed,
        targetThrough: target,
        contractAddress: ledger.release.contractAddress,
        firstGatePassed: ledger.firstGate?.passed ?? false,
        lastCase: ledger.attempts.at(-1)?.name ?? null,
      });
      return {
        completed: true,
        completedCases: completed,
        targetThrough: target,
        contractAddress: ledger.release.contractAddress,
        firstGatePassed: ledger.firstGate?.passed ?? false,
      };
    }

    const seq = completed + 1;
    const planned = inputs.plan.cases[seq - 1];
    let review = null;
    let recoveredEnvelopeHash = null;
    let recoveredSubmittedAt = null;
    try {
      const existing = JSON.parse(await readFile(reviewAbs, 'utf8'));
      const ageMs = Date.now() - Date.parse(existing.verifiedAt);
      const liveNonce = BigInt(
        await connection.publicClient.getTransactionCount({
          address: WALLET_3_OWNER,
          blockTag: 'latest',
        }),
      );
      if (
        existing.sequence === seq &&
        existing.verified === true &&
        existing.planSha256 === WALLET_3_PLAN_SHA256
      ) {
        const existingNonce = BigInt(existing.callRequest.nonce);
        if (liveNonce > existingNonce) {
          // 链上真实 nonce 已推进：按断点恢复规则直接检索该 nonce 已上链信封并完成核验，严禁重新生成下一 nonce 请求
          const priorBlocks = Array.isArray(existing.priorCallRequests)
            ? existing.priorCallRequests
                .map(item => item?.submittedAfterBlock)
                .filter(Boolean)
                .map(b => BigInt(b))
            : [];
          const baseBlock = [BigInt(existing.ethCall.blockNumber), ...priorBlocks].reduce(
            (min, cur) => (cur < min ? cur : min),
          );
          const searchFrom = baseBlock > 200n ? baseBlock - 200n : 0n;
          recoveredEnvelopeHash = await findEnvelopeByNonce(
            connection,
            WALLET_3_OWNER,
            existing.callRequest.nonce,
            searchFrom,
          );
          assert.ok(
            recoveredEnvelopeHash,
            `Nonce ${existing.callRequest.nonce} already consumed on L2 for case ${seq}, but envelope tx not found`,
          );
          const tx = await connection.publicClient.getTransaction({ hash: recoveredEnvelopeHash });
          const blk = await connection.publicClient.getBlock({ blockNumber: tx.blockNumber });
          recoveredSubmittedAt = new Date(Number(blk.timestamp) * 1000).toISOString();
          review = existing;
        } else if (ageMs >= 0 && ageMs < 420_000 && existingNonce === liveNonce) {
          review = existing;
        }
      }
    } catch (resumeErr) {
      if (resumeErr?.name === 'AssertionError') throw resumeErr;
      review = null;
    }

    if (recoveredEnvelopeHash) {
      await writeStatus({
        stage: 'verifying-consensus',
        completedCases: completed,
        targetThrough: target,
        currentSequence: seq,
        currentCaseName: planned.name,
        envelopeHash: recoveredEnvelopeHash,
        contractAddress: ledger.release.contractAddress,
        recoveredFromChain: true,
      });
      const verified = await verifyWallet3Case({
        sequence: seq,
        envelopeHash: recoveredEnvelopeHash,
        submittedAt: recoveredSubmittedAt,
      });
      console.log(publicJson(verified));
      continue;
    }

    if (!review) {
      await writeStatus({
        stage: 'preparing-case',
        completedCases: completed,
        targetThrough: target,
        currentSequence: seq,
        currentCaseName: planned.name,
        contractAddress: ledger.release.contractAddress,
      });
      await prepareWithTransientRetry(seq);
      review = JSON.parse(await readFile(reviewAbs, 'utf8'));
    }

    await writeStatus({
      stage: 'awaiting-wallet-confirmation',
      completedCases: completed,
      targetThrough: target,
      currentSequence: seq,
      currentCaseName: planned.name,
      method: planned.method,
      expectedExecutionResult: planned.expectedTransaction.executionResult,
      nonce: review.callRequest.nonce,
      gas: review.callRequest.gas,
      callRequestHash: review.callRequestHash,
      contractAddress: ledger.release.contractAddress,
    });

    // 等待用户在 MetaMask 中亲自确认当前笔交易（闲置临近 8 分钟且无未决交易时自动刷新证明）
    let envelopeHash = null;
    let submittedAt = null;
    let transientPollErrors = 0;
    while (!envelopeHash) {
      let latestNonce;
      let pendingNonce;
      try {
        const [rawLatest, rawPending] = await Promise.all([
          connection.publicClient.getTransactionCount({ address: WALLET_3_OWNER, blockTag: 'latest' }),
          connection.publicClient.getTransactionCount({ address: WALLET_3_OWNER, blockTag: 'pending' }),
        ]);
        latestNonce = BigInt(rawLatest);
        pendingNonce = BigInt(rawPending);
        transientPollErrors = 0;
      } catch (pollError) {
        transientPollErrors += 1;
        if (transientPollErrors >= 5) throw pollError;
        await sleep(3000);
        continue;
      }
      const expectedNonce = BigInt(review.callRequest.nonce);
      if (latestNonce > expectedNonce) {
        submittedAt = new Date().toISOString();
        envelopeHash = await findEnvelopeByNonce(
          connection,
          WALLET_3_OWNER,
          review.callRequest.nonce,
          BigInt(review.ethCall.blockNumber),
        );
        assert.ok(envelopeHash, `Nonce ${review.callRequest.nonce} consumed but L2 tx not found`);
        break;
      }
      const ageMs = Date.now() - Date.parse(review.verifiedAt);
      if (ageMs >= 450_000 && latestNonce === expectedNonce && pendingNonce === expectedNonce) {
        try {
          await prepareWallet3Case({ sequence: seq });
          review = JSON.parse(await readFile(reviewAbs, 'utf8'));
          await writeStatus({
            stage: 'awaiting-wallet-confirmation',
            completedCases: completed,
            targetThrough: target,
            currentSequence: seq,
            currentCaseName: planned.name,
            method: planned.method,
            expectedExecutionResult: planned.expectedTransaction.executionResult,
            nonce: review.callRequest.nonce,
            gas: review.callRequest.gas,
            callRequestHash: review.callRequestHash,
            contractAddress: ledger.release.contractAddress,
            refreshedProof: true,
          });
        } catch {
          // 闲置刷新遇到瞬时只读 RPC 超时时保留原请求继续轮询，不中断等待
        }
      }
      await sleep(2500);
    }

    await writeStatus({
      stage: 'verifying-consensus',
      completedCases: completed,
      targetThrough: target,
      currentSequence: seq,
      currentCaseName: planned.name,
      envelopeHash,
      contractAddress: ledger.release.contractAddress,
    });

    const verified = await verifyWallet3Case({
      sequence: seq,
      envelopeHash,
      submittedAt,
    });
    console.log(publicJson(verified));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = name => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  if (!args.includes('--through')) {
    console.log(publicJson({ started: false, usage: '--through <2..51>' }));
    return;
  }
  const summary = await runWallet3Cases({ throughSequence: opt('--through') });
  console.log(publicJson(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(async error => {
    const msg = coordinatorErrorSummary(error);
    try {
      await writeStatus({ stage: 'stopped-on-error', error: msg });
    } catch {
      // 忽略状态写入异常
    }
    console.error(msg);
    process.exitCode = 1;
  });
}
