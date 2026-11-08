// 本地只读用例（2..51）钱包审核资料生成器与前置状态采样器。
// 严禁创建临时密钥、接触私钥、签名或自动广播交易。
import assert from 'node:assert/strict';
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abi, decodeInputData, normalizeTransactionFees } from 'genlayer-js';
import { createPublicClient, decodeFunctionData, encodeFunctionData, http, parseAbi } from 'viem';
import {
  BRADBURY,
  PROJECT_ROOT,
  REQUIRED_NAMES,
  connectBradbury,
  publicJson,
  quoteDevelopmentProfile,
  safeError,
} from './bradbury-client.mjs';
import { callProjection, canonical, sha256, validateRequest } from './bradbury-gas-aware-session.mjs';
import { saveV6Capture } from './capture-v6-case.mjs';
import { expectedCaseArgs } from './collect-v6-evidence.mjs';
import {
  WALLET_4_DEPLOYMENT_SOURCE_SHA256,
  WALLET_4_LEDGER_FILE,
  WALLET_4_OWNER,
  WALLET_4_PLAN_FILE,
  WALLET_4_PLAN_SHA256,
  loadV6Wallet4Inputs,
  validateV6Wallet4Ledger,
} from './collect-v6-wallet-4-evidence.mjs';
import { DEPLOYMENT_PROOF_FILE } from './verify-wallet-deployment.mjs';

export const CASE_REVIEW_FORMAT = 'research-receipt/wallet-case-review/1';
export const CASE_REVIEW_OUTPUT = 'artifacts/wallet-validation/case-review.json';
export const ARB_GAS_INFO_ADDRESS = '0x000000000000000000000000000000000000006C';
export const BRADBURY_MAX_TX_GAS_LIMIT = 32000000n;
export const CASE_MAX_BOUNDED_GAS = 31800000n;
export const CASE_HEADROOM_GAS = 1000000n;
export const BRADBURY_FALLBACK_GAS = 200000n;

const L2_SECONDARY = 'https://rpc.testnet-chain.genlayer.com';
const quantity = n => '0x' + BigInt(n).toString(16);

const sameDecodedArgs = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  expected.every((value, i) =>
    typeof value === 'number'
      ? Number.isSafeInteger(value) &&
        (typeof actual[i] === 'bigint' ? actual[i] === BigInt(value) : actual[i] === value)
      : typeof value === 'string' && actual[i] === value,
  );

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

export function buildCaseCallRequest({
  contractAddress,
  method,
  args,
  address,
  context,
  validUntil,
  gas,
}) {
  assert.equal(address.toLowerCase(), WALLET_4_OWNER, 'Only locked v6-wallet-4 owner permitted');
  assert.match(contractAddress, /^0x[0-9a-fA-F]{40}$/);
  const appCall = abi.calldata.makeCalldataObject(method, args, undefined);
  const appData = abi.transactions.serialize([abi.calldata.encode(appCall), false]);
  const decoded = decodeInputData(appData, contractAddress);
  const callMap = decoded?.callData;
  const field = k => (callMap instanceof Map ? callMap.get(k) : callMap?.[k]);
  const kwargs = field('kwargs');
  const emptyKwargs =
    kwargs === undefined ||
    (kwargs instanceof Map
      ? kwargs.size === 0
      : typeof kwargs === 'object' && kwargs !== null && Object.keys(kwargs).length === 0);
  assert.equal(decoded?.type, 'call');
  assert.equal(decoded?.leaderOnly, false);
  assert.equal(field(''), method);
  assert.equal(emptyKwargs, true);
  assert.equal(sameDecodedArgs(field('args') || [], args), true);

  const fees = normalizeTransactionFees({
    distribution: context.quote.distribution,
    feeValue: BigInt(context.quote.feeValue),
  });
  assert.deepEqual(fees.messageAllocations, []);
  const params = {
    sender: WALLET_4_OWNER,
    recipient: contractAddress.toLowerCase(),
    numOfInitialValidators: 5n,
    maxRotations: 3n,
    validUntil: BigInt(validUntil),
    saltNonce: 0n,
    userValue: 0n,
    feesDistribution: fees.distribution,
    txCalldata: appData,
    messageAllocations: [],
  };
  const data = encodeFunctionData({
    abi: context.chain.consensusMainContract.abi,
    functionName: 'addTransaction',
    args: [params],
  }).toLowerCase();
  const roundtrip = decodeFunctionData({
    abi: context.chain.consensusMainContract.abi,
    data,
  });
  assert.equal(roundtrip.functionName, 'addTransaction');
  assert.equal(
    encodeFunctionData({
      abi: context.chain.consensusMainContract.abi,
      functionName: 'addTransaction',
      args: roundtrip.args,
    }).toLowerCase(),
    data,
  );
  const request = {
    chainId: '4221',
    from: WALLET_4_OWNER,
    to: context.metadata.addresses.ConsensusMain.toLowerCase(),
    data,
    value: String(context.quote.feeValue),
    nonce: String(context.latestNonce),
    gas: String(gas),
    gasPrice: String(context.gasPrice),
    type: 'legacy',
  };
  validateRequest(request);
  return request;
}

export async function prepareWallet3Case() {
  throw new Error('v6-wallet-3 is halted and archived; use prepareWallet4Case / run-wallet-4-cases.mjs');
}

export async function prepareWallet4Case({
  sequence,
  ledgerFile = WALLET_4_LEDGER_FILE,
  deploymentProofFile = DEPLOYMENT_PROOF_FILE,
  outputFile = CASE_REVIEW_OUTPUT,
}) {
  const seq = Number(sequence);
  assert.ok(Number.isInteger(seq) && seq >= 2 && seq <= 51, 'Sequence must be an integer in 2..51');

  const inputs = await loadV6Wallet4Inputs();
  const ledger = JSON.parse(await readFile(resolve(PROJECT_ROOT, ledgerFile), 'utf8'));
  validateV6Wallet4Ledger(ledger, inputs);
  assert.equal(
    ledger.attempts.length,
    seq - 1,
    `Ledger has ${ledger.attempts.length} attempts; cannot prepare sequence ${seq} out of order`,
  );
  assert.ok(
    ledger.attempts.every(row => row.state === 'confirmed'),
    'All preceding attempts must be confirmed before preparing the next case',
  );
  if (seq >= 14) {
    assert.ok(
      ledger.firstGate?.throughSequence === 13 && ledger.firstGate?.passed === true,
      'Cases 14..51 require passed first-13 gate in ledger',
    );
  }

  const planned = inputs.plan.cases[seq - 1];
  assert.equal(planned.sequence, seq);
  const contractAddress = ledger.release.contractAddress.toLowerCase();
  const args = expectedCaseArgs(inputs.plan, inputs.fixture, planned);

  // 采样或复用当前用例的 before 快照（幂等：若原只读预采样未完成且未绑定任何协议交易，保留原诊断文件并在 retried-prestate 目录采样）
  const baseName = `${String(seq).padStart(2, '0')}-${planned.name}`;
  let activeBeforeRelPath = `artifacts/bradbury/v6-wallet-4/cases/${baseName}-before.json`;
  let beforeDoc;
  try {
    const primaryDoc = JSON.parse(await readFile(resolve(PROJECT_ROOT, activeBeforeRelPath), 'utf8'));
    assert.equal(primaryDoc.address?.toLowerCase(), contractAddress);
    if (primaryDoc.captureComplete === true) {
      beforeDoc = primaryDoc;
    } else {
      assert.equal(
        primaryDoc.protocolTxId,
        null,
        'Incomplete before capture already bound to a protocol transaction',
      );
      const retryDir = 'artifacts/bradbury/v6-wallet-4/cases/retried-prestate';
      const retryRelPath = `${retryDir}/${baseName}-before.json`;
      try {
        const existingRetry = JSON.parse(await readFile(resolve(PROJECT_ROOT, retryRelPath), 'utf8'));
        assert.equal(existingRetry.captureComplete, true, 'Existing retried before capture is incomplete');
        assert.equal(existingRetry.address?.toLowerCase(), contractAddress);
        activeBeforeRelPath = retryRelPath;
        beforeDoc = existingRetry;
      } catch (retryErr) {
        if (retryErr.code !== 'ENOENT') throw retryErr;
        const savedRetry = await saveV6Capture({
          capture: true,
          caseName: planned.name,
          stage: 'before',
          address: contractAddress,
          deploymentProofFile,
          captureDir: retryDir,
          planFile: WALLET_4_PLAN_FILE,
          planSha256: WALLET_4_PLAN_SHA256,
          deploymentSourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
        });
        assert.equal(
          savedRetry.captureComplete,
          true,
          `Retried before capture failed for case ${seq} (${planned.name})`,
        );
        activeBeforeRelPath = savedRetry.file;
        beforeDoc = JSON.parse(await readFile(resolve(PROJECT_ROOT, activeBeforeRelPath), 'utf8'));
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const saved = await saveV6Capture({
      capture: true,
      caseName: planned.name,
      stage: 'before',
      address: contractAddress,
      deploymentProofFile,
      planFile: WALLET_4_PLAN_FILE,
      planSha256: WALLET_4_PLAN_SHA256,
      deploymentSourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
    });
    assert.equal(saved.captureComplete, true, `Before capture failed for case ${seq} (${planned.name})`);
    beforeDoc = JSON.parse(await readFile(resolve(PROJECT_ROOT, activeBeforeRelPath), 'utf8'));
  }

  const connection = await connectBradbury();
  const reader = createPublicClient({ transport: http(L2_SECONDARY, { retryCount: 0, timeout: 25000 }) });
  const [chainId, genesis, latestPrimary, latestSecondary] = await Promise.all([
    reader.getChainId(),
    reader.getBlock({ blockNumber: 0n }),
    connection.publicClient.getBlockNumber(),
    reader.getBlockNumber(),
  ]);
  assert.equal(chainId, 4221);
  assert.equal(genesis.hash, BRADBURY.genesisHash);
  // 取双节点共同已同步的最新区块高度，避免毫秒级出块差导致跨节点区块哈希误报不一致
  const commonBlockNumber = latestPrimary < latestSecondary ? latestPrimary : latestSecondary;
  const head = await reader.getBlock({ blockNumber: commonBlockNumber });
  assert.equal((await connection.publicClient.getBlock({ blockNumber: head.number })).hash, head.hash);

  const regabi = parseAbi(['function getAddress(string) view returns (address)']);
  for (const name of REQUIRED_NAMES) {
    const resolved = await reader.readContract({
      address: BRADBURY.addressManager,
      abi: regabi,
      functionName: 'getAddress',
      args: [name],
      blockNumber: head.number,
    });
    assert.equal(resolved.toLowerCase(), connection.metadata.addresses[name].toLowerCase());
  }

  const arbGasAbi = parseAbi([
    'function getGasAccountingParams() view returns (uint256 speedLimitPerSecond, uint256 gasPoolMax, uint256 maxTxGasLimit)',
  ]);
  const gasParams = await reader.readContract({
    address: ARB_GAS_INFO_ADDRESS,
    abi: arbGasAbi,
    functionName: 'getGasAccountingParams',
    blockNumber: head.number,
  });
  const maxTxGasLimit = gasParams[2];
  assert.ok(CASE_MAX_BOUNDED_GAS < maxTxGasLimit && maxTxGasLimit <= BRADBURY_MAX_TX_GAS_LIMIT);

  const [{ quote }, latest, pending, balance, gasPrice] = await Promise.all([
    quoteDevelopmentProfile(connection.client),
    reader.getTransactionCount({ address: WALLET_4_OWNER, blockNumber: head.number }),
    reader.getTransactionCount({ address: WALLET_4_OWNER, blockTag: 'pending' }),
    reader.getBalance({ address: WALLET_4_OWNER, blockNumber: head.number }),
    reader.getGasPrice(),
  ]);
  assert.equal(latest, pending, 'Wallet has pending L2 transaction; wait for confirmation first');
  assert.ok(gasPrice > 0n);

  const validUntil = String(head.timestamp + 3600n);
  const context = {
    chain: connection.chain,
    metadata: connection.metadata,
    quote,
    latestNonce: latest,
    gasPrice,
  };

  // 先用受限探测上限 31,800,000 请求 eth_estimateGas，再按 estimatedGas + 1,000,000 精确设定 gas
  const probeRequest = buildCaseCallRequest({
    contractAddress,
    method: planned.method,
    args,
    address: WALLET_4_OWNER,
    context,
    validUntil,
    gas: CASE_MAX_BOUNDED_GAS,
  });
  const probeCall = callProjection(probeRequest);
  const estResp = await fetch(L2_SECONDARY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_estimateGas',
      params: [probeCall, quantity(head.number)],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const estBody = await estResp.json();
  assert.ok(
    estResp.ok &&
      estBody.jsonrpc === '2.0' &&
      !Object.hasOwn(estBody, 'error') &&
      /^0x[0-9a-fA-F]+$/.test(estBody.result || ''),
    'Case eth_estimateGas failed on L2',
  );
  const estimatedGas = BigInt(estBody.result);
  assert.ok(
    estimatedGas > BRADBURY_FALLBACK_GAS &&
      estimatedGas + CASE_HEADROOM_GAS <= CASE_MAX_BOUNDED_GAS,
    `Unexpected case estimatedGas=${estimatedGas}`,
  );
  const boundedGas = estimatedGas + CASE_HEADROOM_GAS;

  const request = buildCaseCallRequest({
    contractAddress,
    method: planned.method,
    args,
    address: WALLET_4_OWNER,
    context,
    validUntil,
    gas: boundedGas,
  });
  const maxTotalCostWei = String(validateRequest(request));
  assert.ok(balance >= BigInt(maxTotalCostWei), 'Insufficient wallet test GEN balance');

  const exactCall = callProjection(request);
  const callResp = await fetch(L2_SECONDARY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [exactCall, quantity(head.number)],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const callBody = await callResp.json();
  assert.ok(
    callResp.ok &&
      callBody.jsonrpc === '2.0' &&
      !Object.hasOwn(callBody, 'error') &&
      /^0x[0-9a-fA-F]{64}$/.test(callBody.result || ''),
    'Exact bounded eth_call failed for case envelope',
  );
  assert.equal((await reader.getBlock({ blockNumber: head.number })).hash, head.hash);

  const review = {
    format: CASE_REVIEW_FORMAT,
    verified: true,
    executionAuthority: 'user-controlled-wallet',
    executionRun: 'v6-wallet-4',
    planFile: WALLET_4_PLAN_FILE,
    planSha256: WALLET_4_PLAN_SHA256,
    sourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
    actor: WALLET_4_OWNER,
    contractAddress,
    sequence: seq,
    caseName: planned.name,
    phase: planned.phase || 'remaining',
    method: planned.method,
    args,
    expectedExecutionResult: planned.expectedTransaction.executionResult,
    expectedError: planned.expectedError ?? null,
    beforeCaptureFile: activeBeforeRelPath,
    submittedAfterBlock: String(head.number),
    previousFinalizedAt: ledger.attempts[seq - 2].finalizedAt,
    registryAddresses: connection.metadata.addresses,
    feeQuote: quote,
    callRequest: request,
    callRequestHash: sha256(canonical(request)),
    maxTotalCostWei,
    validUntil,
    balanceWei: String(balance),
    nonceEvidence: { latest: String(latest), pending: String(pending) },
    ethEstimateGas: {
      blockNumber: String(head.number),
      blockHash: head.hash,
      maxTxGasLimit: String(maxTxGasLimit),
      estimatedGas: String(estimatedGas),
      selectedGas: String(boundedGas),
      result: estBody.result,
      success: true,
    },
    ethCall: {
      request: exactCall,
      blockNumber: String(head.number),
      blockHash: head.hash,
      result: callBody.result,
      success: true,
    },
    verifiedAt: new Date().toISOString(),
    signatures: 0,
    chainTransactionsSent: 0,
  };

  const outAbs = resolve(PROJECT_ROOT, outputFile);
  // 若同一用例与同一 nonce 先前已生成过待签请求（如 MetaMask 弹窗已打开但闲置触发了证明刷新），保留历史请求供链上回执精确对账
  let priorCallRequests = [];
  try {
    const existing = JSON.parse(await readFile(outAbs, 'utf8'));
    if (
      existing?.format === CASE_REVIEW_FORMAT &&
      existing?.planSha256 === WALLET_4_PLAN_SHA256 &&
      existing?.actor === WALLET_4_OWNER &&
      existing?.sequence === seq &&
      existing?.callRequest?.nonce === request.nonce
    ) {
      const prevList = Array.isArray(existing.priorCallRequests) ? existing.priorCallRequests : [];
      const merged = [
        ...prevList,
        {
          callRequest: existing.callRequest,
          callRequestHash: existing.callRequestHash,
          submittedAfterBlock: existing.submittedAfterBlock,
          verifiedAt: existing.verifiedAt,
        },
      ];
      const seen = new Set();
      priorCallRequests = merged
        .filter(item => {
          if (!item?.callRequestHash || item.callRequestHash === review.callRequestHash || seen.has(item.callRequestHash)) {
            return false;
          }
          seen.add(item.callRequestHash);
          return true;
        })
        .slice(-20);
    }
  } catch {
    priorCallRequests = [];
  }
  if (priorCallRequests.length > 0) {
    review.priorCallRequests = priorCallRequests;
  }
  await durableWrite(outAbs, review);
  return {
    verified: true,
    output: outputFile,
    sequence: seq,
    caseName: planned.name,
    method: planned.method,
    expectedExecutionResult: planned.expectedTransaction.executionResult,
    nonce: request.nonce,
    estimatedGas: String(estimatedGas),
    gas: request.gas,
    maxTotalCostWei,
    beforeCaptureFile: activeBeforeRelPath,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = name => {
    const i = args.indexOf(name);
    return i < 0 ? undefined : args[i + 1];
  };
  if (!args.includes('--prepare')) {
    console.log(
      publicJson({
        started: false,
        networkRequests: 0,
        usage: '--prepare --sequence <2..51>',
      }),
    );
    return;
  }
  const result = await prepareWallet4Case({
    sequence: opt('--sequence'),
  });
  console.log(publicJson(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}
