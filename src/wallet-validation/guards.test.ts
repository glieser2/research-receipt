import { describe, expect, it, vi } from 'vitest';
import { abi, createFeesDistribution, normalizeTransactionFees } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { encodeFunctionData, zeroAddress } from 'viem';
import COMPACT_V3_SOURCE from '../../contracts/research_receipt_v6_compact_v3.py?raw';
import LOCKED_PLAN_UTF8 from '../../docs/evidence/v6-wallet-4-validation-plan.json?raw';
import {
  CASE_FORMAT,
  FORMAT,
  LOCKED_ACTOR,
  LOCKED_GAS_LIMIT,
  LOCKED_PLAN_SHA,
  OLD_ACTORS,
  OLD_PLANS,
  REQUIRED_NAMES,
  SOURCE_SHA,
  STORAGE_KEY,
  SUPERSEDED_CONTRACTS,
  assertLocalDevelopment,
  callProjection,
  canonical,
  compareRegistry,
  freshProofTime,
  persistHash,
  persistUncertain,
  readPending,
  requestWalletCase,
  requestWalletDeployment,
  sha256,
  storageKeyForCase,
  storageKeyForReview,
  validateCaseCalldata,
  validateCaseReview,
  validateDeploymentCalldata,
  validateReview,
  walletRequest,
  type CaseReview,
  type Review,
} from './guards';

const CORRECTED_ACTOR = '0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd' as const;
const CONSENSUS_ABI = testnetBradbury.consensusMainContract!.abi;

const REGISTRY_ADDRESSES = Object.fromEntries(
  REQUIRED_NAMES.map((name, index) => [
    name,
    `0x${(index + 1).toString(16).padStart(40, '0')}` as `0x${string}`,
  ]),
) as Record<string, `0x${string}`>;

const RAW_FEE_DISTRIBUTION = createFeesDistribution({
  leaderTimeunitsAllocation: 10000000n,
  validatorTimeunitsAllocation: 10000000n,
  executionBudgetPerRound: 20000000n,
  appealRounds: 0n,
  rotations: [3n],
  maxPriceGenPerTimeUnit: 2n,
  storageFeeMaxGasPrice: 300000000n,
  receiptFeeMaxGasPrice: 300000000n,
});
const NORMALIZED_FEES = normalizeTransactionFees({
  distribution: RAW_FEE_DISTRIBUTION,
  feeValue: 40000000000033882n,
});
const FEE_DISTRIBUTION = NORMALIZED_FEES.distribution;

function buildDeploymentData(
  actor: `0x${string}` = CORRECTED_ACTOR,
  source: string = COMPACT_V3_SOURCE,
  validUntil = '1794028800',
  leaderOnly = false,
  ctorArgs: Parameters<typeof abi.calldata.makeCalldataObject>[1] = [],
): `0x${string}` {
  const txCalldata = abi.transactions.serialize([
    source,
    abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, ctorArgs, undefined)),
    leaderOnly,
  ]) as `0x${string}`;
  return encodeFunctionData({
    abi: CONSENSUS_ABI,
    functionName: 'addTransaction',
    args: [
      {
        sender: actor,
        recipient: zeroAddress,
        numOfInitialValidators: 5n,
        maxRotations: 3n,
        validUntil: BigInt(validUntil),
        saltNonce: 0n,
        userValue: 0n,
        feesDistribution: FEE_DISTRIBUTION,
        txCalldata,
        messageAllocations: [],
      },
    ],
  });
}

async function makeValidReview(now = 1794025500000): Promise<Review> {
  const validUntil = '1794028800';
  const planBytesUtf8 = LOCKED_PLAN_UTF8;
  const planSha256 = LOCKED_PLAN_SHA;
  const data = buildDeploymentData(CORRECTED_ACTOR, COMPACT_V3_SOURCE, validUntil);
  const deploymentRequest = {
    chainId: '4221',
    from: CORRECTED_ACTOR,
    to: REGISTRY_ADDRESSES.ConsensusMain.toLowerCase() as `0x${string}`,
    data,
    value: '40000000000033882',
    nonce: '49',
    gas: LOCKED_GAS_LIMIT,
    gasPrice: '10000000',
    type: 'legacy',
  };
  const maxTotalCostWei = String(
    BigInt(deploymentRequest.value) + BigInt(deploymentRequest.gas) * BigInt(deploymentRequest.gasPrice),
  );
  const deploymentRequestHash = await sha256(canonical(deploymentRequest));
  const resultWord = `0x${'a'.repeat(64)}`;
  const estHex = '0x' + 29950000n.toString(16);
  const blockHash = `0x${'b'.repeat(64)}` as `0x${string}`;
  return {
    format: FORMAT,
    verified: true,
    executionAuthority: 'user-controlled-wallet',
    actor: CORRECTED_ACTOR,
    source: COMPACT_V3_SOURCE,
    sourceSha256: SOURCE_SHA,
    planFile: 'docs/evidence/v6-wallet-4-validation-plan.json',
    planSha256,
    planBytesUtf8,
    deploymentRequest,
    deploymentRequestHash,
    maxTotalCostWei,
    validUntil,
    verifiedAt: new Date(now - 30_000).toISOString(),
    registryAddresses: { ...REGISTRY_ADDRESSES },
    feeQuote: {
      distribution: FEE_DISTRIBUTION,
      feeValue: deploymentRequest.value,
    },
    officialSchemaVerified: true,
    signatures: 0,
    chainTransactionsSent: 0,
    modelCalls: 0,
    ethEstimateGasRequestsStarted: 1,
    ethCallRequestsStarted: 1,
    ethEstimateGas: {
      request: callProjection(deploymentRequest),
      blockNumber: '123456',
      blockHash,
      maxTxGasLimit: '32000000',
      estimatedGas: '29950000',
      success: true,
      result: estHex,
      response: {
        httpStatus: 200,
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: estHex,
        },
      },
    },
    ethCall: {
      request: callProjection(deploymentRequest),
      blockNumber: '123456',
      blockHash,
      success: true,
      result: resultWord,
      response: {
        httpStatus: 200,
        body: {
          jsonrpc: '2.0',
          id: 1,
          result: resultWord,
        },
      },
    },
  };
}

function makeMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem(key: string) {
      return raw.has(key) ? raw.get(key)! : null;
    },
    setItem(key: string, value: string) {
      raw.set(key, String(value));
    },
  };
}

describe('wallet-validation guards (v6-wallet-4 / compact_v3)', () => {
  it('仅允许本机开发服务域名通过 assertLocalDevelopment', () => {
    expect(() => assertLocalDevelopment('127.0.0.1', true)).not.toThrow();
    expect(() => assertLocalDevelopment('localhost', true)).not.toThrow();
    expect(() => assertLocalDevelopment('[::1]', true)).not.toThrow();
    expect(() => assertLocalDevelopment('127.0.0.1', false)).toThrow('本机开发服务');
    expect(() => assertLocalDevelopment('research-receipt-lab.milkyhoop.chatgpt.site', true)).toThrow('本机开发服务');
  });

  it('compareRegistry 拒绝缺项、零地址或不一致的协议地址', () => {
    expect(() => compareRegistry(REGISTRY_ADDRESSES, { ...REGISTRY_ADDRESSES })).not.toThrow();
    const missingBoth = { ...REGISTRY_ADDRESSES };
    delete (missingBoth as Record<string, unknown>).ConsensusMain;
    expect(() => compareRegistry(missingBoth, missingBoth)).toThrow('registry');

    const withZero = { ...REGISTRY_ADDRESSES, ConsensusMain: zeroAddress };
    expect(() => compareRegistry(withZero, withZero)).toThrow('registry');

    const mismatch = { ...REGISTRY_ADDRESSES, ConsensusMain: REGISTRY_ADDRESSES.Staking };
    expect(() => compareRegistry(REGISTRY_ADDRESSES, mismatch)).toThrow('registry');
  });

  it('validateReview 通过合法的 v6-wallet-4 审核资料，拒绝旧计划/wallet-1/2/3、超 32M gas 与估算余量不足', async () => {
    const now = 1794025500000;
    const valid = await makeValidReview(now);
    await expect(validateReview(valid, now)).resolves.toEqual(valid);

    // 拒绝全部历史/作废地址（含 fdb9 wallet-1 错误地址）
    for (const oldActor of OLD_ACTORS) {
      const badActor = await makeValidReview(now);
      badActor.actor = oldActor as `0x${string}`;
      badActor.deploymentRequest.from = oldActor as `0x${string}`;
      const plan = JSON.parse(badActor.planBytesUtf8);
      plan.actorCommitment.actors.owner = oldActor;
      badActor.planBytesUtf8 = JSON.stringify(plan);
      badActor.planSha256 = await sha256(badActor.planBytesUtf8);
      badActor.deploymentRequestHash = await sha256(canonical(badActor.deploymentRequest));
      await expect(validateReview(badActor, now)).rejects.toThrow('部署账户');
    }

    // 拒绝原计划、wallet-1、wallet-2、wallet-3 以及任何未锁定的自造计划摘要
    expect(LOCKED_ACTOR).toBe(CORRECTED_ACTOR);
    expect(OLD_PLANS).toContain('76c2583b393255b241e670e5ba418a7517003d56afdfd1316f0c5c746c8a1b1a');
    for (const oldPlan of [...OLD_PLANS, 'e'.repeat(64)]) {
      const badPlan = await makeValidReview(now);
      badPlan.planSha256 = oldPlan;
      await expect(validateReview(badPlan, now)).rejects.toThrow('新钱包测试计划摘要不匹配');
      expect(() => storageKeyForReview(badPlan)).toThrow('新钱包测试计划摘要不匹配');
    }

    // 拒绝非历史但未获锁定的任意新地址
    const unknownActorReview = await makeValidReview(now);
    unknownActorReview.actor = '0x1111111111111111111111111111111111111111';
    unknownActorReview.deploymentRequest.from = '0x1111111111111111111111111111111111111111';
    await expect(validateReview(unknownActorReview, now)).rejects.toThrow('部署账户');

    // 拒绝非锁定 31,800,000 的其他低 gas（如 31,000,000）
    const nonLockedGas = await makeValidReview(now);
    nonLockedGas.deploymentRequest.gas = '31000000';
    nonLockedGas.maxTotalCostWei = String(
      BigInt(nonLockedGas.deploymentRequest.value) +
        BigInt(nonLockedGas.deploymentRequest.gas) * BigInt(nonLockedGas.deploymentRequest.gasPrice),
    );
    nonLockedGas.deploymentRequestHash = await sha256(canonical(nonLockedGas.deploymentRequest));
    await expect(validateReview(nonLockedGas, now)).rejects.toThrow('gas 上限');

    // 拒绝超出 Bradbury 32,000,000 单笔上限的 100,000,000 gas
    const overL2Gas = await makeValidReview(now);
    overL2Gas.deploymentRequest.gas = '100000000';
    overL2Gas.maxTotalCostWei = String(
      BigInt(overL2Gas.deploymentRequest.value) +
        BigInt(overL2Gas.deploymentRequest.gas) * BigInt(overL2Gas.deploymentRequest.gasPrice),
    );
    overL2Gas.deploymentRequestHash = await sha256(canonical(overL2Gas.deploymentRequest));
    await expect(validateReview(overL2Gas, now)).rejects.toThrow('gas 上限');

    // 拒绝 eth_estimateGas 余量不足（< 1,000,000 gas）
    const tightEstimate = await makeValidReview(now);
    tightEstimate.ethEstimateGas = {
      ...tightEstimate.ethEstimateGas,
      estimatedGas: '31000000',
      result: '0x' + 31000000n.toString(16),
      response: {
        httpStatus: 200,
        body: { jsonrpc: '2.0', id: 1, result: '0x' + 31000000n.toString(16) },
      },
    };
    await expect(validateReview(tightEstimate, now)).rejects.toThrow('32M');

    // 拒绝最大费用超过 0.05 测试 GEN
    const overCap = await makeValidReview(now);
    overCap.deploymentRequest.gasPrice = '500000000';
    overCap.maxTotalCostWei = String(
      BigInt(overCap.deploymentRequest.value) +
        BigInt(overCap.deploymentRequest.gas) * BigInt(overCap.deploymentRequest.gasPrice),
    );
    overCap.deploymentRequestHash = await sha256(canonical(overCap.deploymentRequest));
    await expect(validateReview(overCap, now)).rejects.toThrow('0.05');

    // 拒绝过期证明或剩余有效期不足
    expect(() => freshProofTime(valid, now + 600_001)).toThrow('已过期');
    const shortValidUntil = {
      ...valid,
      validUntil: String(Math.floor((now + 30_000) / 1000)),
    };
    expect(() => freshProofTime(shortValidUntil, now)).toThrow('有效期不足');
  });

  it('validateDeploymentCalldata 验证零参数部署编码并拒绝非空构造参数或篡改源码', async () => {
    const review = await makeValidReview();
    await expect(validateDeploymentCalldata(review, CONSENSUS_ABI)).resolves.toBeUndefined();

    const withCtorArgs = await makeValidReview();
    withCtorArgs.deploymentRequest.data = buildDeploymentData(
      CORRECTED_ACTOR,
      COMPACT_V3_SOURCE,
      withCtorArgs.validUntil,
      false,
      ['unexpected-arg'],
    );
    await expect(validateDeploymentCalldata(withCtorArgs, CONSENSUS_ABI)).rejects.toThrow();

    const withLeaderOnly = await makeValidReview();
    withLeaderOnly.deploymentRequest.data = buildDeploymentData(
      CORRECTED_ACTOR,
      COMPACT_V3_SOURCE,
      withLeaderOnly.validUntil,
      true,
      [],
    );
    await expect(validateDeploymentCalldata(withLeaderOnly, CONSENSUS_ABI)).rejects.toThrow('leader');
  });

  it('requestWalletDeployment 按计划隔离存储键，保持旧 STORAGE_KEY 历史记录不被覆盖且发送前落锁', async () => {
    const review = await makeValidReview();
    const storage = makeMemoryStorage();
    const historicalWallet2Record = JSON.stringify({
      format: STORAGE_KEY,
      requestHash: 'a'.repeat(64),
      from: CORRECTED_ACTOR,
      nonce: '1',
      state: 'submitted',
      createdAt: '2026-11-07T05:18:00.000Z',
      envelopeHash: '0xfa51562ff02e0e19346723c3ba2687654b2c4682d86d28104851c62b7db6ba23',
    });
    storage.setItem(STORAGE_KEY, historicalWallet2Record);

    const scopedKey = storageKeyForReview(review);
    expect(scopedKey).toBe(`${STORAGE_KEY}:${review.planSha256}`);
    expect(readPending(storage, scopedKey)).toBeNull();

    let seenDuringSend: unknown = null;
    const failingProvider = {
      request: vi.fn(async () => {
        seenDuringSend = readPending(storage, scopedKey);
        throw new Error('wallet transport timeout');
      }),
    };

    await expect(
      requestWalletDeployment({
        review,
        storage,
        storageKey: scopedKey,
        provider: failingProvider,
        preflight: async () => {},
        userConfirmed: true,
      }),
    ).rejects.toThrow('wallet transport timeout');

    expect(seenDuringSend).toMatchObject({
      format: scopedKey,
      state: 'uncertain',
      from: CORRECTED_ACTOR,
      nonce: '49',
      requestHash: review.deploymentRequestHash,
    });
    // 旧 wallet-2 记录完整保留未变
    expect(storage.getItem(STORAGE_KEY)).toBe(historicalWallet2Record);

    await expect(
      requestWalletDeployment({
        review,
        storage,
        storageKey: scopedKey,
        provider: failingProvider,
        preflight: async () => {},
        userConfirmed: true,
      }),
    ).rejects.toThrow('禁止重复发送');

    const cleanStorage = makeMemoryStorage();
    const expectedHash = `0x${'c'.repeat(64)}`;
    const okProvider = {
      request: vi.fn(async () => expectedHash),
    };
    const onHash = vi.fn();
    const submitted = await requestWalletDeployment({
      review,
      storage: cleanStorage,
      storageKey: scopedKey,
      provider: okProvider,
      preflight: async () => {},
      userConfirmed: true,
      onHash,
    });

    expect(okProvider.request).toHaveBeenCalledWith({
      method: 'eth_sendTransaction',
      params: [walletRequest(review.deploymentRequest)],
    });
    expect(onHash).toHaveBeenCalledWith(expectedHash);
    expect(submitted).toMatchObject({
      format: scopedKey,
      state: 'submitted',
      envelopeHash: expectedHash,
    });
    expect(readPending(cleanStorage, scopedKey)).toEqual(submitted);

    const corruptedStorage = makeMemoryStorage();
    corruptedStorage.setItem(
      scopedKey,
      JSON.stringify({ ...submitted, envelopeHash: 'invalid-hash' }),
    );
    expect(() => readPending(corruptedStorage, scopedKey)).toThrow('无法解析的部署恢复记录');

    const manualStorage = makeMemoryStorage();
    const uncertain = persistUncertain(manualStorage, review, 1794025500000, scopedKey);
    expect(() => persistHash(manualStorage, uncertain, '0x1234', scopedKey)).toThrow('有效 EVM 哈希');
  });

  it('validateCaseReview、validateCaseCalldata 与 requestWalletCase 精确核验用例 2..51 并隔离每笔用例锁', async () => {
    const now = 1794025500000;
    const validUntil = '1794028800';
    const contractAddress = ('0x' + '9'.repeat(40)) as `0x${string}`;
    const args: (string | number)[] = [1, 1];
    const txCalldata = abi.transactions.serialize([
      abi.calldata.encode(abi.calldata.makeCalldataObject('evaluate', args, undefined)),
      false,
    ]) as `0x${string}`;
    const data = encodeFunctionData({
      abi: CONSENSUS_ABI,
      functionName: 'addTransaction',
      args: [
        {
          sender: CORRECTED_ACTOR,
          recipient: contractAddress,
          numOfInitialValidators: 5n,
          maxRotations: 3n,
          validUntil: BigInt(validUntil),
          saltNonce: 0n,
          userValue: 0n,
          feesDistribution: FEE_DISTRIBUTION,
          txCalldata,
          messageAllocations: [],
        },
      ],
    });
    const callRequest = {
      chainId: '4221',
      from: CORRECTED_ACTOR,
      to: REGISTRY_ADDRESSES.ConsensusMain.toLowerCase() as `0x${string}`,
      data,
      value: '40000000000033882',
      nonce: '3',
      gas: '3500000',
      gasPrice: '10000000',
      type: 'legacy',
    };
    const maxTotalCostWei = String(
      BigInt(callRequest.value) + BigInt(callRequest.gas) * BigInt(callRequest.gasPrice),
    );
    const callRequestHash = await sha256(canonical(callRequest));
    const caseRev: CaseReview = {
      format: CASE_FORMAT,
      verified: true,
      executionAuthority: 'user-controlled-wallet',
      executionRun: 'v6-wallet-4',
      planSha256: LOCKED_PLAN_SHA,
      sourceSha256: SOURCE_SHA,
      actor: CORRECTED_ACTOR,
      contractAddress,
      sequence: 4,
      caseName: 'evaluateBeforeEvidence',
      phase: 'firstGate',
      method: 'evaluate',
      args,
      expectedExecutionResult: 'ERROR',
      expectedError: 'Evidence must be verified before evaluation',
      callRequest,
      callRequestHash,
      maxTotalCostWei,
      validUntil,
      verifiedAt: new Date(now - 20_000).toISOString(),
      registryAddresses: { ...REGISTRY_ADDRESSES },
      feeQuote: { distribution: FEE_DISTRIBUTION, feeValue: callRequest.value },
      ethEstimateGas: {
        blockNumber: '123456',
        blockHash: `0x${'b'.repeat(64)}`,
        maxTxGasLimit: '32000000',
        estimatedGas: '2500000',
        selectedGas: '3500000',
        result: '0x' + 2500000n.toString(16),
        success: true,
      },
      ethCall: {
        request: callProjection(callRequest),
        blockNumber: '123456',
        blockHash: `0x${'b'.repeat(64)}`,
        result: `0x${'d'.repeat(64)}`,
        success: true,
      },
    };
    await expect(validateCaseReview(caseRev, now)).resolves.toEqual(caseRev);
    await expect(validateCaseCalldata(caseRev, CONSENSUS_ABI)).resolves.toBeUndefined();

    // 拒绝复用已归档的 v6-wallet-3 合约地址
    await expect(
      validateCaseReview({ ...caseRev, contractAddress: SUPERSEDED_CONTRACTS[0] as `0x${string}` }, now),
    ).rejects.toThrow('已归档历史合约');

    const wrongArgs = { ...caseRev, args: [1, 2] };
    await expect(validateCaseCalldata(wrongArgs, CONSENSUS_ABI)).rejects.toThrow('不一致');

    const storage = makeMemoryStorage();
    const expectedHash = `0x${'e'.repeat(64)}`;
    const sent = await requestWalletCase({
      review: caseRev,
      storage,
      provider: { request: vi.fn(async () => expectedHash) },
      preflight: async () => {},
      userConfirmed: true,
    });
    expect(sent.envelopeHash).toBe(expectedHash);
    expect(readPending(storage, storageKeyForCase(caseRev))?.envelopeHash).toBe(expectedHash);
    expect(readPending(storage, storageKeyForCase({ ...caseRev, sequence: 5 }))).toBeNull();
  });
});
