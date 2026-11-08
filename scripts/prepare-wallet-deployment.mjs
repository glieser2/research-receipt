// 本地只读钱包部署审核资料生成器。严禁创建临时密钥、接触私钥、签名或广播。
import assert from 'node:assert/strict';
import { readFile, mkdir, open, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, parseAbi } from 'viem';
import {
  connectBradbury,
  quoteDevelopmentProfile,
  publicJson,
  BRADBURY,
  REQUIRED_NAMES,
  projectFile,
  PROJECT_ROOT,
} from './bradbury-client.mjs';
import {
  buildDeploymentRequest,
  validateRequest,
  sha256,
  canonical,
  callProjection,
} from './bradbury-gas-aware-session.mjs';

export const WALLET_FORMAT = 'research-receipt/wallet-deployment-review/1';
export const OUTPUT = 'artifacts/wallet-validation/review.json';
export const WALLET_DEPLOYMENT_SOURCE_SHA =
  '5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf';
export const LOCKED_WALLET_OWNER = '0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd';
export const LOCKED_WALLET_4_PLAN_SHA =
  'e65905d24990f7f1bc0fd20ae8b172d57c3290f7ae531b9711077205a46839d0';
export const LOCKED_EXECUTION_RUN = 'v6-wallet-4';
export const ARB_GAS_INFO_ADDRESS = '0x000000000000000000000000000000000000006C';
export const BRADBURY_MAX_TX_GAS_LIMIT = 32000000n;
export const WALLET_BOUNDED_GAS_LIMIT = 31800000n;
export const MIN_ESTIMATE_HEADROOM_GAS = 1000000n;
export const SUPERSEDED_OWNERS = [
  '0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70',
  '0x7036138ada2052af0b07dae5a4d450effd9a40e3',
  '0xfdb942f537095d8e0c36b97a3b0324de81db9c3f',
];
export const SUPERSEDED_PLANS = [
  'c731fb736abc2bf2c70e48d5a72cd1e72195a0bc25aa50070d7a9a28564b506e',
  '04dbef08dc757f7457808d04f320b8cade446ca507596388e9f275e830753f77',
  '306f742ac1b8bbdb8c01f0125c565dafe2c059ff1627cc1ed4f62c5804924b89',
  '76c2583b393255b241e670e5ba418a7517003d56afdfd1316f0c5c746c8a1b1a',
];

const l2 = 'https://rpc.testnet-chain.genlayer.com';
const quantity = n => '0x' + BigInt(n).toString(16);

async function durableNew(path, value) {
  const file = await open(path, 'wx');
  try {
    await file.writeFile(publicJson(value) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
}

async function durableUpdate(path, value) {
  const file = await open(path, 'w');
  try {
    await file.writeFile(publicJson(value) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
}

export const MAX_PLAN_BYTES = 1048576;

export async function walletPlanFile(name, limit = MAX_PLAN_BYTES) {
  assert.ok(
    typeof name === 'string' && name && !isAbsolute(name) && name.endsWith('.json'),
    'Use a project-relative JSON plan.',
  );
  const lexicalRel = relative(PROJECT_ROOT, resolve(PROJECT_ROOT, name));
  assert.ok(
    lexicalRel && lexicalRel.split(/[\\/]/)[0] !== '..' && !isAbsolute(lexicalRel),
    'Plan must remain inside the project and below 1 MiB.',
  );
  const root = await realpath(PROJECT_ROOT);
  const file = await realpath(resolve(root, name));
  const rel = relative(root, file);
  const details = await stat(file);
  // 只拒绝真正的上级路径段；名为 ..foo.json 的项目内文件不应被误伤。
  assert.ok(
    rel &&
      rel.split(/[\\/]/)[0] !== '..' &&
      !isAbsolute(rel) &&
      details.isFile() &&
      details.size <= limit,
    'Plan must remain inside the project and below 1 MiB.',
  );
  return file;
}

// 经已解析路径读取并在读取阶段再次限长，防止 stat 之后文件被换成更大内容。
export async function readWalletPlanBytes(name, limit = MAX_PLAN_BYTES) {
  const file = await walletPlanFile(name, limit);
  const handle = await open(file, 'r');
  try {
    const details = await handle.stat();
    assert.ok(
      details.isFile() && details.size <= limit,
      'Plan must remain inside the project and below 1 MiB.',
    );
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, limit + 1, 0);
    assert.ok(bytesRead <= limit, 'Plan must remain inside the project and below 1 MiB.');
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function validateWalletPlan({ planBytes, planSha256, address, read = readFile }) {
  assert.equal(sha256(planBytes), planSha256);
  assert.ok(!SUPERSEDED_PLANS.includes(planSha256), 'Superseded or historical plan cannot be used.');
  assert.match(address, /^0x[0-9a-f]{40}$/);
  assert.ok(
    !SUPERSEDED_OWNERS.includes(address),
    'Superseded or historical signer cannot be used.',
  );
  assert.equal(
    address,
    LOCKED_WALLET_OWNER,
    'Only the locked v6-wallet-4 owner address is permitted.',
  );
  assert.equal(
    planSha256,
    LOCKED_WALLET_4_PLAN_SHA,
    'Only the locked v6-wallet-4 frozen plan SHA-256 is permitted.',
  );
  const plan = JSON.parse(planBytes);
  assert.equal(plan.executionAuthority, 'user-controlled-wallet');
  assert.equal(plan.executionRun, LOCKED_EXECUTION_RUN);
  assert.equal(plan.policyVersion, 'research-receipt/6');
  assert.equal(plan.mode, 'prepared');
  assert.equal(plan.requiredSignedCaseCount, 51);
  assert.equal(plan.actorCommitment.actors.owner.toLowerCase(), LOCKED_WALLET_OWNER);
  assert.equal(plan.deploymentSourceCommitment.sha256, WALLET_DEPLOYMENT_SOURCE_SHA);
  for (const commitment of [
    plan.sourceCommitment,
    ...(plan.originalV6CanonicalCommitment ? [plan.originalV6CanonicalCommitment] : []),
    plan.deploymentSourceCommitment,
    plan.catalogCommitment,
    plan.buildCommitment,
    plan.feeProfileCommitment,
  ]) {
    let path;
    try {
      path = await projectFile(commitment.file);
    } catch (error) {
      if (error?.code !== 'ENOENT' || commitment !== plan.buildCommitment) throw error;
      path = await projectFile('tests/fixtures/v6-compact-v3-build.json');
    }
    assert.equal(sha256(await read(path)), commitment.sha256);
  }
  return plan;
}

export async function prepareWalletReview({ planFile, planSha256, address }) {
  const planBytes = await readWalletPlanBytes(planFile);
  const plan = await validateWalletPlan({ planBytes, planSha256, address });
  const source = await readFile(await projectFile(plan.deploymentSourceCommitment.file), 'utf8');
  const outputPath = resolve(PROJECT_ROOT, OUTPUT);
  await mkdir(dirname(outputPath), { recursive: true });
  const report = {
    format: WALLET_FORMAT,
    verified: false,
    startedAt: new Date().toISOString(),
    executionAuthority: 'user-controlled-wallet',
    sourceSha256: WALLET_DEPLOYMENT_SOURCE_SHA,
    source,
    planFile,
    planSha256,
    planBytesUtf8: planBytes.toString('utf8'),
    actor: address,
    l2Endpoint: l2,
    signatures: 0,
    chainTransactionsSent: 0,
    modelCalls: 0,
    ethEstimateGasRequestsStarted: 0,
    ethCallRequestsStarted: 0,
  };
  await durableNew(outputPath, report);
  try {
    const c = await connectBradbury();
    const reader = createPublicClient({ transport: http(l2, { retryCount: 0, timeout: 25000 }) });
    const [chainId, genesis, latestPrimary, latestSecondary] = await Promise.all([
      reader.getChainId(),
      reader.getBlock({ blockNumber: 0n }),
      c.publicClient.getBlockNumber(),
      reader.getBlockNumber(),
    ]);
    assert.equal(chainId, 4221);
    assert.equal(genesis.hash, BRADBURY.genesisHash);
    const commonBlockNumber = latestPrimary < latestSecondary ? latestPrimary : latestSecondary;
    const head = await reader.getBlock({ blockNumber: commonBlockNumber });
    assert.equal(
      (await c.publicClient.getBlock({ blockNumber: head.number })).hash,
      head.hash,
    );

    const regabi = parseAbi(['function getAddress(string) view returns (address)']);
    for (const name of REQUIRED_NAMES) {
      const resolved = await reader.readContract({
        address: BRADBURY.addressManager,
        abi: regabi,
        functionName: 'getAddress',
        args: [name],
        blockNumber: head.number,
      });
      assert.equal(resolved.toLowerCase(), c.metadata.addresses[name].toLowerCase());
      const [a, b] = await Promise.all([
        reader.getCode({ address: resolved, blockNumber: head.number }),
        c.publicClient.getCode({ address: resolved, blockNumber: head.number }),
      ]);
      assert.ok(a && a !== '0x');
      assert.equal(a, b);
    }
    assert.equal(
      (
        await reader.readContract({
          address: c.metadata.addresses.ConsensusData,
          abi: parseAbi(['function addressManager() view returns (address)']),
          functionName: 'addressManager',
          blockNumber: head.number,
        })
      ).toLowerCase(),
      BRADBURY.addressManager.toLowerCase(),
    );

    // 核验 Bradbury L2 ArbGasInfo 单笔交易硬上限（32,000,000 gas）在双官方节点一致
    const arbGasAbi = parseAbi([
      'function getGasAccountingParams() view returns (uint256 speedLimitPerSecond, uint256 gasPoolMax, uint256 maxTxGasLimit)',
    ]);
    const [gasParamsReader, gasParamsPrimary] = await Promise.all([
      reader.readContract({
        address: ARB_GAS_INFO_ADDRESS,
        abi: arbGasAbi,
        functionName: 'getGasAccountingParams',
        blockNumber: head.number,
      }),
      c.publicClient.readContract({
        address: ARB_GAS_INFO_ADDRESS,
        abi: arbGasAbi,
        functionName: 'getGasAccountingParams',
        blockNumber: head.number,
      }),
    ]);
    const maxTxGasLimit = gasParamsReader[2];
    assert.equal(maxTxGasLimit, gasParamsPrimary[2]);
    assert.ok(
      WALLET_BOUNDED_GAS_LIMIT < maxTxGasLimit && maxTxGasLimit <= BRADBURY_MAX_TX_GAS_LIMIT,
      'Bradbury L2 maxTxGasLimit changed or below bounded deployment gas.',
    );

    const schema = await c.client.getContractSchemaForCode(source);
    assert.deepEqual(schema.ctor.params, []);
    assert.deepEqual(schema.ctor.kwparams, {});
    report.officialSchemaVerified = true;

    const [{ quote }, latest, pending, balance, gasPrice] = await Promise.all([
      quoteDevelopmentProfile(c.client),
      reader.getTransactionCount({ address, blockNumber: head.number }),
      reader.getTransactionCount({ address, blockTag: 'pending' }),
      reader.getBalance({ address, blockNumber: head.number }),
      reader.getGasPrice(),
    ]);
    assert.equal(latest, pending);
    assert.ok(gasPrice > 0n);

    const validUntil = String(head.timestamp + 3600n);
    const context = {
      chain: c.chain,
      metadata: c.metadata,
      quote,
      latestNonce: latest,
      gasPrice,
    };
    const request = buildDeploymentRequest({
      source,
      address,
      context,
      validUntil,
      gas: WALLET_BOUNDED_GAS_LIMIT,
      expectedSourceSha: WALLET_DEPLOYMENT_SOURCE_SHA,
    });
    const maxTotalCostWei = String(validateRequest(request));
    assert.ok(
      balance >= BigInt(maxTotalCostWei),
      'Wallet needs the bounded test GEN amount before preparing a short-lived request.',
    );

    report.network = c.metadata;
    report.registryAddresses = c.metadata.addresses;
    report.deploymentRequest = request;
    report.deploymentRequestHash = sha256(canonical(request));
    report.maxTotalCostWei = maxTotalCostWei;
    report.validUntil = validUntil;
    report.feeQuote = quote;
    report.balanceWei = String(balance);
    report.nonceEvidence = { latest: String(latest), pending: String(pending) };

    const call = callProjection(request);
    report.ethEstimateGasRequestsStarted = 1;
    report.ethEstimateGas = {
      request: call,
      blockNumber: String(head.number),
      blockHash: head.hash,
      maxTxGasLimit: String(maxTxGasLimit),
      success: false,
    };
    report.ethCallRequestsStarted = 1;
    report.ethCall = {
      request: call,
      blockNumber: String(head.number),
      blockHash: head.hash,
      success: false,
    };
    await durableUpdate(outputPath, report);

    // 1. 固定区块 eth_estimateGas：证明真实 L1+L2 估算显著低于 31.8M 与 32M 硬上限
    const estResponse = await fetch(l2, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_estimateGas',
        params: [call, quantity(head.number)],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const estBody = await estResponse.json();
    report.ethEstimateGas.response = { httpStatus: estResponse.status, body: estBody };
    const estOk =
      estResponse.ok &&
      estBody.jsonrpc === '2.0' &&
      estBody.id === 1 &&
      !Object.hasOwn(estBody, 'error') &&
      /^0x[0-9a-fA-F]+$/.test(estBody.result || '');
    assert.equal(estOk, true, 'Exact bounded eth_estimateGas failed; stop this transport.');
    const estimatedGas = BigInt(estBody.result);
    assert.ok(
      estimatedGas >= 21000n &&
        estimatedGas + MIN_ESTIMATE_HEADROOM_GAS <= WALLET_BOUNDED_GAS_LIMIT &&
        WALLET_BOUNDED_GAS_LIMIT < maxTxGasLimit,
      'Estimated deployment gas lacks required safety headroom below Bradbury maxTxGasLimit.',
    );
    report.ethEstimateGas.result = estBody.result;
    report.ethEstimateGas.estimatedGas = String(estimatedGas);
    report.ethEstimateGas.success = true;

    // 2. 固定区块 eth_call：验证同一精确请求在选定 gas 下模拟返回 32 字节槽位结果
    const response = await fetch(l2, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [call, quantity(head.number)],
      }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    report.ethCall.response = { httpStatus: response.status, body };
    report.ethCall.success =
      response.ok &&
      body.jsonrpc === '2.0' &&
      body.id === 1 &&
      !Object.hasOwn(body, 'error') &&
      /^0x[0-9a-fA-F]{64}$/.test(body.result || '');
    assert.equal(report.ethCall.success, true, 'Exact bounded call failed; stop this transport.');
    report.ethCall.result = body.result;

    assert.equal((await reader.getBlock({ blockNumber: head.number })).hash, head.hash);
    report.verifiedAt = new Date().toISOString();
    report.verified = true;
  } catch (error) {
    report.verified = false;
    report.error = {
      name: error.name,
      code:
        error instanceof assert.AssertionError
          ? 'WALLET_READ_ONLY_GUARD_FAILED'
          : 'READ_ONLY_PREPARATION_FAILED',
    };
  }
  await durableUpdate(outputPath, report);
  return {
    path: OUTPUT,
    sha256: sha256(await readFile(outputPath)),
    verified: report.verified,
    actor: address,
    gas: report.deploymentRequest?.gas ?? null,
    estimatedGas: report.ethEstimateGas?.estimatedGas ?? null,
    maxTxGasLimit: report.ethEstimateGas?.maxTxGasLimit ?? null,
    maxTotalCostWei: report.maxTotalCostWei ?? null,
    error: report.error ?? null,
    chainTransactionsSent: 0,
    signatures: 0,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--prepare'))
    console.log(
      publicJson({
        started: false,
        networkRequests: 0,
        signatures: 0,
        accountCreated: false,
        output: OUTPUT,
        usage: '--prepare --address PUBLIC --plan-file NEW_PLAN --plan-sha REVIEWED_SHA',
      }),
    );
  else {
    const arg = n => {
      const i = process.argv.indexOf(n);
      assert.ok(i >= 0 && process.argv[i + 1], n + ' required');
      return process.argv[i + 1];
    };
    prepareWalletReview({
      address: arg('--address').toLowerCase(),
      planFile: arg('--plan-file'),
      planSha256: arg('--plan-sha'),
    })
      .then(result => console.log(publicJson(result)))
      .catch(error => {
        console.log(
          publicJson({
            verified: false,
            error: { name: error.name, code: 'LOCAL_PLAN_OR_OUTPUT_GUARD_FAILED' },
            chainTransactionsSent: 0,
            signatures: 0,
          }),
        );
        process.exitCode = 1;
      });
  }
}
