import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { abi } from 'genlayer-js';
import { encodeEventTopics } from 'viem';
import { BRADBURY } from '../../scripts/bradbury-client.mjs';
import { captureV6Case } from '../../scripts/capture-v6-case.mjs';
import {
  DEPLOYMENT_SOURCE_SHA256 as V1_SOURCE_SHA256,
  HISTORICAL_TRANSACTIONS,
  HISTORICAL_UNDETERMINED,
  PLAN_SHA256 as ORIGINAL_PLAN_SHA256,
  expectedCaseArgs,
  expectedGuardMessage,
  verifyHistoryAccounting,
} from '../../scripts/collect-v6-evidence.mjs';
import {
  HISTORICAL_OWNER,
  WALLET_1_SUPERSEDED_OWNER,
  WALLET_1_SUPERSEDED_PLAN_SHA256,
  WALLET_2_REVERTED_ENVELOPE_HASH,
  WALLET_2_SUPERSEDED_PLAN_SHA256,
  WALLET_3_HALTED_CONTRACT,
  WALLET_3_HALTED_TX_ID,
  WALLET_3_SUPERSEDED_DEPLOYMENT_SOURCE_SHA256,
  WALLET_3_SUPERSEDED_PLAN_SHA256,
  WALLET_4_CANONICAL_SOURCE_SHA256,
  WALLET_4_COLLECT_ACK,
  WALLET_4_DEPLOYMENT_SOURCE_SHA256,
  WALLET_4_FIXTURE_SHA256,
  WALLET_4_OWNER,
  WALLET_4_PLAN_FILE,
  WALLET_4_PLAN_SHA256,
  collectV6Wallet4Evidence,
  loadV6Wallet4Inputs,
  notCollectedWallet4Evidence,
  validateV6Wallet4Ledger,
} from '../../scripts/collect-v6-wallet-4-evidence.mjs';

const hash = n => '0x' + n.toString(16).padStart(64, '0');
const address = n => '0x' + n.toString(16).padStart(40, '0');
const iso = ms => new Date(Date.UTC(2026, 10, 7, 15, 0, 0) + ms).toISOString();
const runtimeIso = ms => iso(ms).replace('.000Z', 'Z');
const release = {
  contractAddress: address(299),
  deploymentHash: hash(4001),
  sourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
  actorAddress: WALLET_4_OWNER,
};
const read = (method, args, value, observedAt) => ({
  method,
  args,
  variant: 'latest-final',
  value: structuredClone(value),
  observedAt,
});

const inputPromise = loadV6Wallet4Inputs();

function normalizedSubmission(value, spec) {
  const claimMap = new Map(value.claims.map(claim => [claim.criterion_id, claim]));
  return {
    ...structuredClone(value),
    claims: spec.criteria
      .filter(row => claimMap.has(row.id))
      .map(row => {
        const claim = structuredClone(claimMap.get(row.id));
        if (claim.claim_type !== 'unknown_disclosure') {
          claim.statement = claim.statement.trim();
          claim.evidence_indices.sort((a, b) => a - b);
        }
        return claim;
      }),
  };
}

async function offlineWallet4Ledger(inputs, count = 51) {
  const ledger = {
    format: 'research-receipt/v6-execution-ledger/1',
    executionRun: 'v6-wallet-4',
    planSha256: WALLET_4_PLAN_SHA256,
    fixtureSha256: inputs.plan.fixtureSha256,
    release: structuredClone(release),
    attempts: [],
    transportFailures: [],
  };
  const orders = new Map();
  const revisions = new Map();
  const snapshots = new Map();
  const assessments = new Map();
  let orderCount = 0;

  function stateReads(planned, at) {
    const result = [read('get_order_count', [], orderCount, at)];
    if (planned.op === 'deploy') {
      return [
        ...result,
        read('get_policy_version', [], 'research-receipt/6', at),
        read('get_field_catalog', [], JSON.stringify(inputs.catalog), at),
      ];
    }
    const id = planned.readbackOracle.orderId;
    const order = orders.get(id);
    result.push(read('get_order', [id], JSON.stringify(order), at));
    if (order) {
      result.push(read('get_order_id', [order.spec.client_ref], id, at));
      for (let number = 1; number <= Math.max(1, order.revision_count); number++) {
        const key = `${id}:${number}`;
        if (revisions.has(key)) {
          result.push(read('get_revision', [id, number], JSON.stringify(revisions.get(key)), at));
        }
        result.push(
          read(
            'get_evidence_snapshot',
            [id, number],
            snapshots.has(key) ? JSON.stringify(snapshots.get(key)) : '',
            at,
          ),
        );
        result.push(
          read(
            'get_assessment',
            [id, number],
            assessments.has(key) ? JSON.stringify(assessments.get(key)) : '',
            at,
          ),
        );
      }
    }
    if (planned.readbackOracle.absentRevision) {
      result.push({
        method: 'get_revision',
        args: [id, 1],
        variant: 'latest-final',
        error: { message: 'Revision not found' },
        observedAt: at,
      });
    }
    return result;
  }

  for (const planned of inputs.plan.cases.slice(0, count)) {
    const time = planned.sequence * 1000;
    const oracle = planned.readbackOracle;
    const beforeReads = planned.op === 'deploy' ? [] : stateReads(planned, iso(time - 100));
    if (!oracle.rollback && planned.method === 'create_order') {
      const spec = {
        ...structuredClone(inputs.fixture[planned.inputCase]),
        author: inputs.fixture[planned.inputCase].author.toLowerCase(),
      };
      orders.set(oracle.orderId, {
        id: oracle.orderId,
        owner: WALLET_4_OWNER,
        spec,
        policy_version: 'research-receipt/6',
        spec_hash: oracle.specHash,
        revision_count: 0,
        status: 'OPEN',
        created_at: iso(time),
      });
      orderCount++;
    } else if (!oracle.rollback && planned.method === 'submit_revision') {
      const order = orders.get(oracle.orderId);
      const number = oracle.revision;
      const key = `${order.id}:${number}`;
      const submission = normalizedSubmission(inputs.fixture[planned.inputCase], order.spec);
      revisions.set(key, {
        order_id: order.id,
        revision: number,
        submission,
        submission_hash: oracle.submissionHash,
        content_hash: oracle.contentHash,
        previous_submission_hash: oracle.previousSubmissionHash,
        submitted_by: WALLET_4_OWNER,
        submitted_at: iso(time),
      });
      order.revision_count = number;
      order.status = 'SUBMITTED';
    } else if (!oracle.rollback && planned.method === 'verify_evidence') {
      const expected = inputs.plan.expected.find(row => row.id === oracle.expectedContext);
      const { materialCommitments, ...snapshot } = structuredClone(expected.snapshot);
      snapshots.set(`${expected.orderId}:${expected.revision}`, {
        ...snapshot,
        materials: materialCommitments.map((row, index) =>
          row.stored_material === null ? null : inputs.materials[index],
        ),
      });
    } else if (!oracle.rollback && planned.method === 'evaluate') {
      const expected = inputs.plan.expected.find(row => row.id === oracle.expectedContext);
      assessments.set(`${expected.orderId}:${expected.revision}`, {
        ...structuredClone(expected.assessment.deterministicMetadata),
        ...structuredClone(expected.assessment.projection),
        findings: structuredClone(expected.assessment.rawFindings),
        assessed_at: runtimeIso(time),
      });
      orders.get(expected.orderId).status = oracle.status;
    }
    const afterReads = stateReads(planned, iso(time + 400));
    ledger.attempts.push({
      sequence: planned.sequence,
      name: planned.name,
      intentId: `wallet-4-case-${planned.sequence}`,
      state: 'confirmed',
      hash: hash(4000 + planned.sequence),
      submittedAfterBlock: String(4000 + planned.sequence * 3 - 1),
      submittedAt: iso(time),
      finalizedAt: iso(time + 200),
      beforeReads,
      afterReads,
    });
  }
  if (count > 13) {
    ledger.firstGate = {
      throughSequence: 13,
      passed: true,
      caseHashes: ledger.attempts.slice(0, 13).map(row => row.hash),
      verifiedAt: iso(13500),
    };
  }
  return { ledger, orders, revisions, snapshots, assessments };
}

function rawWallet4Transaction(inputs, planned, attempt, sender = WALLET_4_OWNER) {
  return {
    txId: attempt.hash,
    sender,
    recipient: release.contractAddress,
    statusName: 'FINALIZED',
    lifecycle: { outcome: 'accepted' },
    resultName: 'MAJORITY_AGREE',
    result: 1,
    createdTimestamp: String(Date.parse(iso(planned.sequence * 1000)) / 1000),
    currentTimestamp: String(Date.parse(iso(planned.sequence * 1000 + 2000)) / 1000),
    lastRound: { round: '0' },
    txExecutionHash: hash(9800 + planned.sequence),
    txCalldata: '0x010203',
    txExecutionResultName: `FINISHED_WITH_${planned.expectedTransaction.executionResult}`,
    txDataDecoded:
      planned.op === 'deploy'
        ? {
            type: 'deploy',
            contractAddress: release.contractAddress,
            code: inputs.source,
            constructorArgs: {},
            leaderOnly: false,
          }
        : {
            type: 'call',
            callData: new Map([
              ['', planned.method],
              [
                'args',
                expectedCaseArgs(inputs.plan, inputs.fixture, planned).map(value =>
                  typeof value === 'number' ? BigInt(value) : value,
                ),
              ],
            ]),
            leaderOnly: false,
          },
  };
}

function storedGuardDouble(inputs, planned, tx, message = expectedGuardMessage(inputs, planned)) {
  return {
    id: tx.txId,
    sender: tx.sender,
    recipient: tx.recipient,
    round: 0,
    txExecutionHash: tx.txExecutionHash,
    txCallData: tx.txCalldata,
    statusName: 'Finalized',
    result: 1,
    txExecutionResult: 2,
    txExecutionResultName: 'FinishedWithError',
    timestamps: { Created: Number(tx.createdTimestamp) },
    returnData:
      '0x' +
      Buffer.from(
        abi.calldata.encode(
          new Map([
            ['kind', 'UserError'],
            ['data', message],
            ['backtrace', []],
          ]),
        ),
      ).toString('hex'),
  };
}

test('v6-wallet-4 收集器核验 compact_v3 构建证明与全部历史谱系承诺（含 wallet-3 中止归档），默认零网络请求', async () => {
  const inputs = await inputPromise;
  assert.equal(inputs.planFile, WALLET_4_PLAN_FILE);
  assert.equal(inputs.planSha256, WALLET_4_PLAN_SHA256);
  assert.equal(inputs.plan.sourceCommitment.sha256, WALLET_4_CANONICAL_SOURCE_SHA256);
  assert.equal(inputs.deploymentSourceSha256, WALLET_4_DEPLOYMENT_SOURCE_SHA256);
  assert.equal(inputs.owner, WALLET_4_OWNER);
  assert.equal(inputs.plan.fixtureSha256, WALLET_4_FIXTURE_SHA256);
  assert.equal(inputs.plan.cases.length, 51);
  assert.equal(inputs.plan.expected.length, 10);

  const notCollected = notCollectedWallet4Evidence();
  assert.equal(notCollected.ready, false);
  assert.equal(notCollected.networkRequests, 0);
  assert.equal(notCollected.plan.file, WALLET_4_PLAN_FILE);
  assert.equal(notCollected.plan.sha256, WALLET_4_PLAN_SHA256);
  assert.equal(notCollected.plan.executionRun, 'v6-wallet-4');
  assert.equal(notCollected.plan.owner, WALLET_4_OWNER);
});

test('validateV6Wallet4Ledger 拒绝旧计划、wallet-1/2/3 计划、v1/v2 源码及 wallet-2/3 历史交易混用', async () => {
  const inputs = await inputPromise;
  const { ledger } = await offlineWallet4Ledger(inputs, 13);
  validateV6Wallet4Ledger(ledger, inputs);

  for (const superseded of [
    ORIGINAL_PLAN_SHA256,
    WALLET_1_SUPERSEDED_PLAN_SHA256,
    WALLET_2_SUPERSEDED_PLAN_SHA256,
    WALLET_3_SUPERSEDED_PLAN_SHA256,
  ]) {
    assert.throws(
      () => validateV6Wallet4Ledger({ ...ledger, planSha256: superseded }, inputs),
      /Superseded or historical plan/,
    );
  }

  // 拒绝 release 使用旧 v1 或 v2 compact 源码 SHA
  for (const oldSource of [V1_SOURCE_SHA256, WALLET_3_SUPERSEDED_DEPLOYMENT_SOURCE_SHA256]) {
    assert.throws(
      () =>
        validateV6Wallet4Ledger(
          { ...ledger, release: { ...ledger.release, sourceSha256: oldSource } },
          inputs,
        ),
      /Missing exact V6 release identity/,
    );
  }

  // 拒绝复用 v6-wallet-3 合约地址
  assert.throws(
    () =>
      validateV6Wallet4Ledger(
        { ...ledger, release: { ...ledger.release, contractAddress: WALLET_3_HALTED_CONTRACT } },
        inputs,
      ),
    /Superseded v6-wallet-3 contract address/,
  );

  // 拒绝混入 v6-wallet-2 已回滚部署哈希 0xfa5156...
  const withRevertedEnvelope = structuredClone(ledger);
  withRevertedEnvelope.attempts[0].envelopeHash = WALLET_2_REVERTED_ENVELOPE_HASH;
  assert.throws(
    () => validateV6Wallet4Ledger(withRevertedEnvelope, inputs),
    /Reverted v6-wallet-2 deployment envelope/,
  );

  // 拒绝混入 v6-wallet-3 Case #47 中止交易哈希 0x39b4178d...
  const withHaltedTx = structuredClone(ledger);
  withHaltedTx.attempts[0].hash = WALLET_3_HALTED_TX_ID;
  assert.throws(
    () => validateV6Wallet4Ledger(withHaltedTx, inputs),
    /Halted or superseded v6-wallet-3 transaction/,
  );

  // 拒绝 release.deploymentHash 混入历史中止/已作废交易哈希
  assert.throws(
    () =>
      validateV6Wallet4Ledger(
        { ...ledger, release: { ...ledger.release, deploymentHash: WALLET_3_HALTED_TX_ID } },
        inputs,
      ),
    /Superseded historical deployment\/halted hash/,
  );

  const sessionUrl = new URL(
    '../../artifacts/bradbury/session-0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70.json',
    import.meta.url,
  );
  const session = JSON.parse(await readFile(sessionUrl, 'utf8'));
  const accounting = verifyHistoryAccounting(session, ledger, { separateWalletRun: true });
  assert.equal(accounting.historicalCount, 33);
  assert.equal(accounting.separateWalletRun, true);
});

test('collectV6Wallet4Evidence 离线替身完整验证 33 笔历史归档与 51 项 compact_v3 用例（含 11 项精确 UserError）', async () => {
  const inputs = { ...(await inputPromise), dependenciesComplete: true };
  const { ledger, orders, revisions, snapshots, assessments } = await offlineWallet4Ledger(
    inputs,
    51,
  );
  const sessionUrl = new URL(
    '../../artifacts/bradbury/session-0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70.json',
    import.meta.url,
  );
  const session = JSON.parse(await readFile(sessionUrl, 'utf8'));

  const core = address(177);
  const historicalSourceCache = new Map();
  for (const old of HISTORICAL_TRANSACTIONS) {
    if (!historicalSourceCache.has(old.sourceFile)) {
      const text = await readFile(new URL(`../../${old.sourceFile}`, import.meta.url), 'utf8');
      historicalSourceCache.set(old.sourceFile, text);
    }
  }

  const txMap = new Map();
  for (const old of HISTORICAL_TRANSACTIONS) {
    const undetermined = HISTORICAL_UNDETERMINED[old.hash.toLowerCase()];
    txMap.set(old.hash.toLowerCase(), {
      txId: old.hash,
      sender: HISTORICAL_OWNER,
      recipient: old.contractAddress,
      statusName: 'FINALIZED',
      lifecycle: { outcome: undetermined ? 'undetermined' : 'accepted' },
      resultName: undetermined || 'MAJORITY_AGREE',
      result: undetermined ? 2 : 1,
      txExecutionResultName: 'FINISHED_WITH_RETURN',
      txDataDecoded:
        old.operation === 'deploy'
          ? {
              type: 'deploy',
              contractAddress: old.contractAddress,
              code: historicalSourceCache.get(old.sourceFile),
              constructorArgs: {},
              leaderOnly: false,
            }
          : {
              type: 'call',
              callData: new Map([
                ['', old.operation],
                ['args', []],
              ]),
              leaderOnly: false,
            },
    });
  }

  for (const attempt of ledger.attempts) {
    const planned = inputs.plan.cases[attempt.sequence - 1];
    txMap.set(attempt.hash.toLowerCase(), rawWallet4Transaction(inputs, planned, attempt));
  }

  const inclusion = async (_conn, txHash, submittedAfterBlock) => {
    const blockNum = String(BigInt(submittedAfterBlock) + 1n);
    return {
      verified: true,
      event: 'NewTransaction',
      protocolTxId: txHash,
      envelopeHash: txHash,
      blockHash: hash(Number(blockNum)),
      blockNumber: blockNum,
      logIndex: 0,
    };
  };

  const connection = {
    metadata: {
      chainId: BRADBURY.chainId,
      genesisHash: BRADBURY.genesisHash,
      addressManager: BRADBURY.addressManager,
      addresses: { ConsensusMain: core },
    },
    client: {
      getTransaction: async ({ hash: h }) => txMap.get(h.toLowerCase()),
      readContract: async ({ functionName, args }) => {
        if (functionName === 'get_order_count') return 9;
        if (functionName === 'get_policy_version') return 'research-receipt/6';
        if (functionName === 'get_field_catalog') return JSON.stringify(inputs.catalog);
        if (functionName === 'get_order') return JSON.stringify(orders.get(args[0]));
        if (functionName === 'get_order_id') {
          for (const [id, o] of orders.entries()) {
            if (o.spec.client_ref === args[0]) return id;
          }
          return 0;
        }
        const key = `${args[0]}:${args[1]}`;
        if (functionName === 'get_revision') return JSON.stringify(revisions.get(key));
        if (functionName === 'get_evidence_snapshot') return JSON.stringify(snapshots.get(key));
        if (functionName === 'get_assessment') return JSON.stringify(assessments.get(key));
        throw new Error(`Unexpected readContract: ${functionName}`);
      },
    },
    publicClient: {
      getTransactionReceipt: async ({ hash: envHash }) => {
        const tx = txMap.get(envHash.toLowerCase());
        const old = HISTORICAL_TRANSACTIONS.find(
          row => row.hash.toLowerCase() === envHash.toLowerCase(),
        );
        const attempt = ledger.attempts.find(
          row => row.hash.toLowerCase() === envHash.toLowerCase(),
        );
        const blockNum = BigInt(old ? old.submittedAfterBlock : attempt.submittedAfterBlock) + 1n;
        const bHash = hash(Number(blockNum));
        const topics = encodeEventTopics({
          abi: [
            {
              type: 'event',
              name: 'NewTransaction',
              inputs: [
                { name: 'txId', type: 'bytes32', indexed: true },
                { name: 'recipient', type: 'address', indexed: true },
                { name: 'activator', type: 'address', indexed: true },
              ],
            },
          ],
          eventName: 'NewTransaction',
          args: { txId: envHash, recipient: tx.recipient, activator: tx.sender },
        });
        return {
          status: 'success',
          transactionHash: envHash,
          blockHash: bHash,
          blockNumber: blockNum,
          to: core,
          logs: [{ address: core, logIndex: 0, removed: false, topics, data: '0x' }],
        };
      },
      getTransaction: async ({ hash: envHash }) => {
        const tx = txMap.get(envHash.toLowerCase());
        return { hash: envHash, from: tx.sender, to: core };
      },
      getBlock: async ({ blockNumber }) => ({ hash: hash(Number(blockNumber)) }),
    },
  };

  const storedData = async tx => {
    const attempt = ledger.attempts.find(row => row.hash.toLowerCase() === tx.txId.toLowerCase());
    const planned = inputs.plan.cases[attempt.sequence - 1];
    return storedGuardDouble(inputs, planned, tx);
  };

  const collected = await collectV6Wallet4Evidence(
    ledger,
    { ack: WALLET_4_COLLECT_ACK },
    { inputs, session, connection, inclusion, storedData },
  );
  assert.equal(collected.status, 'COLLECTED');
  assert.equal(
    collected.reason,
    'All 51 prelocked V6 signed business cases collected and verified against Bradbury Phase 2 finality, consensus, and readback commitments.',
  );
  assert.equal(collected.ready, true);
  assert.equal(collected.allRequiredCasesPassed, true);
  assert.equal(collected.firstGatePassed, true);
  assert.equal(collected.latestFinalVerified, true);
  assert.equal(collected.historicalTransactions.length, 33);
  assert.equal(collected.cases.length, 51);
  assert.ok(collected.cases.every(row => row.passed === true));
  assert.equal(collected.plan.executionRun, 'v6-wallet-4');
  assert.equal(collected.plan.owner, WALLET_4_OWNER);
  assert.equal(collected.release.sourceSha256, WALLET_4_DEPLOYMENT_SOURCE_SHA256);
});

test('captureV6Case 绑定 v6-wallet-4 的 compact_v3 源码哈希并拒绝旧 v1/v2 源码证明', async () => {
  const inputs = await inputPromise;
  const target = address(31);
  const core = address(32);
  const deploymentHash = hash(61);
  const afterHash = hash(62);
  const envelopeHash = hash(63);
  const blockHash = hash(64);
  const inclusion = {
    verified: true,
    protocolTxId: deploymentHash,
    envelopeHash,
    blockHash,
    blockNumber: '700',
    logIndex: 0,
    event: 'NewTransaction',
  };
  const network = {
    chainId: 4221,
    genesisHash: BRADBURY.genesisHash,
    addressManager: BRADBURY.addressManager,
  };
  const validProof = {
    format: 'research-receipt/v6-capture-deployment-proof/1',
    planSha256: WALLET_4_PLAN_SHA256,
    contractAddress: target,
    sourceSha256: WALLET_4_DEPLOYMENT_SOURCE_SHA256,
    protocolTxId: deploymentHash,
    actorAddress: WALLET_4_OWNER,
    deploymentSourceVerified: true,
    finalized: true,
    consensusAccepted: true,
    execution: 'FINISHED_WITH_RETURN',
    constructorArgs: [],
    leaderOnly: false,
    inclusion,
    network,
  };
  const topics = encodeEventTopics({
    abi: [
      {
        type: 'event',
        name: 'NewTransaction',
        inputs: [
          { name: 'txId', type: 'bytes32', indexed: true },
          { name: 'recipient', type: 'address', indexed: true },
          { name: 'activator', type: 'address', indexed: true },
        ],
      },
    ],
    eventName: 'NewTransaction',
    args: { txId: deploymentHash, recipient: target, activator: WALLET_4_OWNER },
  });
  let ticks = 0;
  const clock = () => new Date(Date.UTC(2026, 10, 7, 15, 30, 0) + ticks++).toISOString();
  const connection = {
    metadata: { ...network, addresses: { ConsensusMain: core } },
    client: {
      getTransaction: async ({ hash: h }) =>
        h === deploymentHash
          ? {
              txId: deploymentHash,
              sender: WALLET_4_OWNER,
              recipient: target,
              statusName: 'FINALIZED',
              txExecutionResultName: 'FINISHED_WITH_RETURN',
              lifecycle: { outcome: 'accepted' },
              result: 1,
              txDataDecoded: {
                type: 'deploy',
                contractAddress: target,
                code: inputs.source,
                constructorArgs: {},
                leaderOnly: false,
              },
            }
          : {
              txId: afterHash,
              sender: WALLET_4_OWNER,
              recipient: target,
              statusName: 'FINALIZED',
              txExecutionResultName: 'FINISHED_WITH_ERROR',
              lifecycle: { outcome: 'accepted' },
              result: 1,
              txDataDecoded: {
                type: 'call',
                callData: new Map([
                  ['', 'evaluate'],
                  ['args', [1n, 1n]],
                ]),
                leaderOnly: false,
              },
            },
      readContract: async request => {
        if (request.functionName === 'get_order_count') return 1;
        if (request.functionName === 'get_policy_version') return 'research-receipt/6';
        if (request.functionName === 'get_field_catalog') return JSON.stringify(inputs.catalog);
        if (request.functionName === 'get_order') {
          return JSON.stringify({
            id: request.args[0],
            revision_count: 1,
            spec: { client_ref: 'wallet-4-ref' },
          });
        }
        if (request.functionName === 'get_order_id') return 1;
        if (request.functionName === 'get_revision') return '{"raw":true}';
        return '';
      },
    },
    publicClient: {
      getTransactionReceipt: async () => ({
        status: 'success',
        transactionHash: envelopeHash,
        blockHash,
        blockNumber: 700n,
        to: core,
        logs: [{ address: core, logIndex: 0, topics, data: '0x' }],
      }),
      getTransaction: async () => ({ hash: envelopeHash, from: WALLET_4_OWNER, to: core }),
      getBlock: async () => ({ hash: blockHash }),
    },
  };

  const options = {
    capture: true,
    caseName: 'evaluateBeforeEvidence',
    stage: 'after',
    address: target,
    hash: afterHash,
    deploymentProofFile: 'offline-wallet-4-proof.json',
  };
  const captured = await captureV6Case(options, {
    inputs,
    connection,
    deploymentProof: validProof,
    now: clock,
  });
  assert.equal(captured.captureComplete, true);
  assert.equal(captured.planSha256, WALLET_4_PLAN_SHA256);
  assert.equal(captured.sourceDeployment.sourceSha256, WALLET_4_DEPLOYMENT_SOURCE_SHA256);

  for (const oldSource of [V1_SOURCE_SHA256, WALLET_3_SUPERSEDED_DEPLOYMENT_SOURCE_SHA256]) {
    await assert.rejects(
      () =>
        captureV6Case(options, {
          inputs,
          connection,
          deploymentProof: { ...validProof, sourceSha256: oldSource },
          now: clock,
        }),
      /not bound to the frozen V6 source\/plan/,
    );
  }

  await assert.rejects(
    () =>
      captureV6Case(options, {
        inputs,
        connection,
        deploymentProof: { ...validProof, actorAddress: WALLET_1_SUPERSEDED_OWNER },
        now: clock,
      }),
    /locked wallet owner/,
  );
});

test('已落盘的 docs/evidence/bradbury-v6-wallet-4-e2e.json 完整通过 51/51 用例、33 笔历史归档与 9 份最终订单不变量校验', async () => {
  const evidenceUrl = new URL(
    '../../docs/evidence/bradbury-v6-wallet-4-e2e.json',
    import.meta.url,
  );
  const evidence = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(evidence.format, 'research-receipt/bradbury-v6-e2e/1');
  assert.equal(evidence.policyVersion, 'research-receipt/6');
  assert.equal(evidence.status, 'COLLECTED');
  assert.equal(
    evidence.reason,
    'All 51 prelocked V6 signed business cases collected and verified against Bradbury Phase 2 finality, consensus, and readback commitments.',
  );
  assert.equal(evidence.ready, true);
  assert.equal(evidence.allRequiredCasesPassed, true);
  assert.equal(evidence.suiteComplete, true);
  assert.equal(evidence.firstGatePassed, true);
  assert.equal(evidence.latestFinalVerified, true);
  assert.equal(evidence.plan.file, WALLET_4_PLAN_FILE);
  assert.equal(evidence.plan.sha256, WALLET_4_PLAN_SHA256);
  assert.equal(evidence.plan.executionRun, 'v6-wallet-4');
  assert.equal(evidence.plan.owner, WALLET_4_OWNER);
  assert.equal(
    evidence.release.contractAddress.toLowerCase(),
    '0x10d41bf2e9b54440ced622171ceff191754bcf73',
  );
  assert.equal(
    evidence.release.deploymentHash.toLowerCase(),
    '0x1a7dd2f1a54e56108c4d0170a213ffd495184bb6c7d0a37bfb68409d976ecbb5',
  );
  assert.equal(evidence.release.sourceSha256, WALLET_4_DEPLOYMENT_SOURCE_SHA256);
  assert.equal(evidence.release.actorAddress.toLowerCase(), WALLET_4_OWNER);
  assert.equal(evidence.historicalTransactions.length, 33);
  assert.ok(evidence.historicalTransactions.every(row => row.historicalVerified === true));
  assert.ok(evidence.historicalTransactions.every(row => row.passedBusinessCase === false));
  assert.equal(evidence.cases.length, 51);
  assert.ok(evidence.cases.every(row => row.passed === true && row.verified === true));
  assert.equal(evidence.cases.filter(row => row.rollbackVerified).length, 11);
  assert.equal(evidence.failures.length, 0);
  assert.equal(evidence.orders.length, 9);
});
