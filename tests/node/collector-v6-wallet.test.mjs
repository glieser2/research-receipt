import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { abi } from 'genlayer-js';
import { encodeEventTopics } from 'viem';
import { BRADBURY } from '../../scripts/bradbury-client.mjs';
import { captureV6Case } from '../../scripts/capture-v6-case.mjs';
import {
  DEPLOYMENT_SOURCE_SHA256,
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
  WALLET_2_COLLECT_ACK,
  WALLET_2_FIXTURE_SHA256,
  WALLET_2_OWNER,
  WALLET_2_PLAN_FILE,
  WALLET_2_PLAN_SHA256,
  collectV6Wallet2Evidence,
  loadV6Wallet2Inputs,
  notCollectedWallet2Evidence,
  validateV6Wallet2Ledger,
} from '../../scripts/collect-v6-wallet-evidence.mjs';

const hash = n => '0x' + n.toString(16).padStart(64, '0');
const address = n => '0x' + n.toString(16).padStart(40, '0');
const iso = ms => new Date(Date.UTC(2026, 10, 7, 4, 0, 0) + ms).toISOString();
const runtimeIso = ms => iso(ms).replace('.000Z', 'Z');
const release = {
  contractAddress: address(99),
  deploymentHash: hash(2001),
  sourceSha256: DEPLOYMENT_SOURCE_SHA256,
  actorAddress: WALLET_2_OWNER,
};
const read = (method, args, value, observedAt) => ({
  method,
  args,
  variant: 'latest-final',
  value: structuredClone(value),
  observedAt,
});

const inputPromise = loadV6Wallet2Inputs();

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

async function offlineWallet2Ledger(inputs, count = 51) {
  const ledger = {
    format: 'research-receipt/v6-execution-ledger/1',
    executionRun: 'v6-wallet-2',
    planSha256: WALLET_2_PLAN_SHA256,
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
        owner: WALLET_2_OWNER,
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
        submitted_by: WALLET_2_OWNER,
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
      intentId: `wallet-2-case-${planned.sequence}`,
      state: 'confirmed',
      hash: hash(2000 + planned.sequence),
      submittedAfterBlock: String(2000 + planned.sequence * 3 - 1),
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

function rawWallet2Transaction(inputs, planned, attempt, sender = WALLET_2_OWNER) {
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
    txExecutionHash: hash(9000 + planned.sequence),
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

test('v6-wallet-2 收集器核验全部冻结承诺，默认保持 NOT_COLLECTED 且零网络请求', async () => {
  const inputs = await inputPromise;
  assert.equal(inputs.planFile, WALLET_2_PLAN_FILE);
  assert.equal(inputs.planSha256, WALLET_2_PLAN_SHA256);
  assert.equal(inputs.owner, WALLET_2_OWNER);
  assert.equal(inputs.plan.fixtureSha256, WALLET_2_FIXTURE_SHA256);
  assert.equal(inputs.plan.cases.length, 51);
  assert.equal(inputs.plan.expected.length, 10);

  const notCollected = notCollectedWallet2Evidence();
  assert.equal(notCollected.ready, false);
  assert.equal(notCollected.networkRequests, 0);
  assert.equal(notCollected.plan.file, WALLET_2_PLAN_FILE);
  assert.equal(notCollected.plan.sha256, WALLET_2_PLAN_SHA256);
  assert.equal(notCollected.plan.executionRun, 'v6-wallet-2');
  assert.equal(notCollected.plan.owner, WALLET_2_OWNER);
});

test('validateV6Wallet2Ledger 与 verifyHistoryAccounting 隔离原 33 笔历史记录并拒绝旧计划或 wallet-1 混用', async () => {
  const inputs = await inputPromise;
  const { ledger } = await offlineWallet2Ledger(inputs, 13);
  validateV6Wallet2Ledger(ledger, inputs);

  // 拒绝旧计划与作废的 wallet-1 计划摘要
  assert.throws(
    () => validateV6Wallet2Ledger({ ...ledger, planSha256: ORIGINAL_PLAN_SHA256 }, inputs),
    /Superseded or historical plan/,
  );
  assert.throws(
    () =>
      validateV6Wallet2Ledger({ ...ledger, planSha256: WALLET_1_SUPERSEDED_PLAN_SHA256 }, inputs),
    /Superseded or historical plan/,
  );

  // 拒绝在用户钱包 run 中使用仅替换部署者的 transportAddendum
  assert.throws(
    () =>
      validateV6Wallet2Ledger(
        { ...ledger, transportAddendum: { file: 'addendum.json', sha256: 'a'.repeat(64) } },
        inputs,
      ),
    /transport addendum is forbidden/,
  );

  // 验证原 33 笔历史交易会话保持只读不追加，且不得混入新钱包 ledger
  const sessionUrl = new URL(
    '../../artifacts/bradbury/session-0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70.json',
    import.meta.url,
  );
  const session = JSON.parse(await readFile(sessionUrl, 'utf8'));
  const accounting = verifyHistoryAccounting(session, ledger, { separateWalletRun: true });
  assert.equal(accounting.historicalCount, 33);
  assert.equal(accounting.trackedCount, 33);
  assert.equal(accounting.separateWalletRun, true);
  assert.equal(accounting.historicalSessionUnchanged, true);

  // 若旧 session 被追加了第 34 笔交易，separateWalletRun 必须拒绝
  const mutatedSession = {
    ...session,
    transactions: [...session.transactions, { hash: ledger.attempts[0].hash, operation: 'deploy', role: 'owner' }],
  };
  assert.throws(
    () => verifyHistoryAccounting(mutatedSession, ledger, { separateWalletRun: true }),
    /must remain at 33 transactions/,
  );

  // 若新钱包 ledger 混用任何历史交易哈希，必须拒绝
  const pollutedLedger = structuredClone(ledger);
  pollutedLedger.attempts[0].hash = HISTORICAL_TRANSACTIONS[0].hash;
  assert.throws(
    () => verifyHistoryAccounting(session, pollutedLedger, { separateWalletRun: true }),
    /Historical or auxiliary transaction/,
  );
});

test('collectV6Wallet2Evidence 在离线替身下完整验证 33 笔历史归档（0x29eb...）与 51 项新钱包用例（0x5d89...），并拒绝错误签名者', async () => {
  const inputs = { ...(await inputPromise), dependenciesComplete: true };
  const { ledger, orders, revisions, snapshots, assessments } = await offlineWallet2Ledger(
    inputs,
    51,
  );
  const sessionUrl = new URL(
    '../../artifacts/bradbury/session-0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70.json',
    import.meta.url,
  );
  const session = JSON.parse(await readFile(sessionUrl, 'utf8'));

  const core = address(77);
  const historicalSourceCache = new Map();
  for (const old of HISTORICAL_TRANSACTIONS) {
    if (!historicalSourceCache.has(old.sourceFile)) {
      const text = await readFile(new URL(`../../${old.sourceFile}`, import.meta.url), 'utf8');
      historicalSourceCache.set(old.sourceFile, text);
    }
  }

  let overrideSenderForCase2 = null;
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

  const buildCaseTransactions = () => {
    for (const attempt of ledger.attempts) {
      const planned = inputs.plan.cases[attempt.sequence - 1];
      const sender =
        attempt.sequence === 2 && overrideSenderForCase2 ? overrideSenderForCase2 : WALLET_2_OWNER;
      txMap.set(
        attempt.hash.toLowerCase(),
        rawWallet2Transaction(inputs, planned, attempt, sender),
      );
    }
  };
  buildCaseTransactions();

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

  const collected = await collectV6Wallet2Evidence(
    ledger,
    { ack: WALLET_2_COLLECT_ACK },
    { inputs, session, connection, inclusion, storedData },
  );
  assert.equal(collected.status, 'COLLECTED');
  assert.equal(collected.ready, true);
  assert.equal(collected.allRequiredCasesPassed, true);
  assert.equal(collected.firstGatePassed, true);
  assert.equal(collected.latestFinalVerified, true);
  assert.equal(collected.historicalTransactions.length, 33);
  assert.ok(collected.historicalTransactions.every(row => row.historicalVerified === true));
  assert.ok(
    collected.historicalTransactions.every(row => row.sender === HISTORICAL_OWNER),
  );
  assert.equal(collected.cases.length, 51);
  assert.ok(collected.cases.every(row => row.passed === true));
  assert.equal(collected.plan.executionRun, 'v6-wallet-2');
  assert.equal(collected.plan.owner, WALLET_2_OWNER);

  // 若第 2 项交易使用了已作废的 wallet-1 地址 fdb9，必须判定该用例失败且整体 INCOMPLETE
  overrideSenderForCase2 = WALLET_1_SUPERSEDED_OWNER;
  buildCaseTransactions();
  const rejected = await collectV6Wallet2Evidence(
    ledger,
    { ack: WALLET_2_COLLECT_ACK },
    { inputs, session, connection, inclusion, storedData },
  );
  assert.equal(rejected.ready, false);
  assert.equal(rejected.status, 'INCOMPLETE');
  assert.equal(rejected.cases[1].passed, false);
  assert.ok(rejected.failures.some(f => f.sequence === 2));
});

test('captureV6Case 绑定 v6-wallet-2 计划摘要并拒绝非锁定钱包的部署证明或交易', async () => {
  const inputs = await inputPromise;
  const target = address(11);
  const core = address(12);
  const deploymentHash = hash(41);
  const afterHash = hash(42);
  const envelopeHash = hash(43);
  const blockHash = hash(44);
  const inclusion = {
    verified: true,
    protocolTxId: deploymentHash,
    envelopeHash,
    blockHash,
    blockNumber: '500',
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
    planSha256: WALLET_2_PLAN_SHA256,
    contractAddress: target,
    sourceSha256: DEPLOYMENT_SOURCE_SHA256,
    protocolTxId: deploymentHash,
    actorAddress: WALLET_2_OWNER,
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
    args: { txId: deploymentHash, recipient: target, activator: WALLET_2_OWNER },
  });
  let ticks = 0;
  let afterSender = WALLET_2_OWNER;
  const clock = () => new Date(Date.UTC(2026, 10, 7, 5, 0, 0) + ticks++).toISOString();
  const connection = {
    metadata: { ...network, addresses: { ConsensusMain: core } },
    client: {
      getTransaction: async ({ hash: h }) =>
        h === deploymentHash
          ? {
              txId: deploymentHash,
              sender: WALLET_2_OWNER,
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
              sender: afterSender,
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
            spec: { client_ref: 'wallet-2-ref' },
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
        blockNumber: 500n,
        to: core,
        logs: [{ address: core, logIndex: 0, topics, data: '0x' }],
      }),
      getTransaction: async () => ({ hash: envelopeHash, from: WALLET_2_OWNER, to: core }),
      getBlock: async () => ({ hash: blockHash }),
    },
  };

  const options = {
    capture: true,
    caseName: 'evaluateBeforeEvidence',
    stage: 'after',
    address: target,
    hash: afterHash,
    deploymentProofFile: 'offline-wallet-2-proof.json',
  };
  const captured = await captureV6Case(options, {
    inputs,
    connection,
    deploymentProof: validProof,
    now: clock,
  });
  assert.equal(captured.captureComplete, true);
  assert.equal(captured.planSha256, WALLET_2_PLAN_SHA256);

  // 拒绝绑定了 wallet-1 actor 的部署证明
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

  // 拒绝 after 交易发送者不是锁定钱包地址的情况
  afterSender = WALLET_1_SUPERSEDED_OWNER;
  await assert.rejects(
    () =>
      captureV6Case(options, {
        inputs,
        connection,
        deploymentProof: validProof,
        now: clock,
      }),
    /locked wallet\/contract/,
  );
});
