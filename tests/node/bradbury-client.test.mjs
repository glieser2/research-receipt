import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { consensusAccepted, executionSucceeded, executionReverted, finalizedUndetermined } from '../../src/lib/protocol-outcome.mjs';
import { BRADBURY, REQUIRED_NAMES, validateManifest, overrideChain, projectFile, developmentDistribution, safeError, protocolInclusion, verifyTrackedOperation, verifyDeploymentEvidence } from '../../scripts/bradbury-client.mjs';
const addresses = Object.fromEntries(REQUIRED_NAMES.map((key, i) => [key, `0x${(i + 1).toString(16).padStart(40, '0')}`]));
const manifest = () => ({ chainId: '4221', registry: BRADBURY.addressManager, entries: REQUIRED_NAMES.map(key => ({ key, addr: addresses[key] })) });
test('only accepts the Phase 2 chain and sealed registry', () => {
  assert.deepEqual(validateManifest(manifest()), addresses);
  assert.throws(() => validateManifest({ ...manifest(), chainId: '61997' }), /Phase 2/);
  assert.throws(() => validateManifest({ ...manifest(), registry: addresses.ConsensusMain }), /Phase 2/);
});
test('rejects missing, duplicate and zero contract references', () => {
  const missing = manifest(); missing.entries = missing.entries.filter(e => e.key !== 'RoundsStorage');
  assert.throws(() => validateManifest(missing), /RoundsStorage/);
  const duplicate = manifest(); duplicate.entries.push(duplicate.entries[0]);
  assert.throws(() => validateManifest(duplicate), /duplicate/);
  const zero = manifest(); zero.entries[0].addr = `0x${'0'.repeat(40)}`;
  assert.throws(() => validateManifest(zero), /invalid/);
});
test('maps SDK rounds storage to the exact RoundsStorage alias', () => {
  const chain = overrideChain(addresses);
  assert.equal(chain.roundsStorageContract.address, addresses.RoundsStorage);
  assert.equal(chain.consensusMainContract.address, addresses.ConsensusMain);
  assert.equal(chain.consensusDataContract.address, addresses.ConsensusData);
  assert.equal(chain.feeManagerContract.address, addresses.FeeManager);
  assert.equal(chain.isStudio, false);
  assert.deepEqual(chain.rpcUrls.default.http, [BRADBURY.rpcUrl]);
});
test('source resolution rejects absolute, outside and wrong-extension files', async () => {
  await assert.rejects(projectFile(PROJECT_SENTINEL(), '.py'), /relative/);
  await assert.rejects(projectFile('../research-receipt-site.tar.gz', '.py'));
  await assert.rejects(projectFile('package.json', '.py'), /expected extension/);
  assert.match(await projectFile('contracts/research_receipt.py', '.py'), /research_receipt\.py$/);
});
function PROJECT_SENTINEL() { return new URL('../../package.json', import.meta.url).pathname; }

test('explicit development budgets retain rc.2 rotations and rounded caps', () => {
  const distribution = developmentDistribution({ leaderTimeunitsAllocation: 600n, validatorTimeunitsAllocation: 600n, executionBudgetPerRound: 10000000000000000n, appealRounds: 0n }, { genPerTimeUnit: 1n, storageUnitPrice: 250000000n, receiptGasPrice: 250000000n }, overrideChain(addresses));
  assert.deepEqual(distribution.rotations, [3n]);
  assert.equal(distribution.maxPriceGenPerTimeUnit, 2n);
  assert.equal(distribution.receiptFeeMaxGasPrice, 300000000n);
  assert.equal(distribution.executionBudgetPerRound, 10000000000000000n);
});
test('error summaries do not expose long signed envelopes or key-like hex', () => {
  const secret = `0x${'a'.repeat(64)}`;
  assert.equal(safeError(new Error(`RPC ${secret}\nrequest ${secret}`)), 'RPC [redacted hex]');
  assert.equal(safeError({ name: 'TransportError', message: secret }), 'RPC or local operation failed.');
});
test('inclusion requires matching protocol event and successful envelope receipt', async () => {
  const txId = `0x${'1'.repeat(64)}`; const envelope = `0x${'2'.repeat(64)}`; const blockHash = `0x${'3'.repeat(64)}`;
  const log = { args: { txId }, transactionHash: envelope, blockHash, logIndex: 2, address: addresses.ConsensusMain };
  const receipt = { status: 'success', transactionHash: envelope, blockHash, blockNumber: 11n, logs: [{ ...log, topics: ['0x', txId] }] };
  const connection = { metadata: { addresses }, publicClient: { getBlockNumber: async () => 11n, getLogs: async () => [log], getTransactionReceipt: async ({ hash }) => { assert.equal(hash, envelope); return receipt; } } };
  assert.equal((await protocolInclusion(connection, txId, '10')).verified, true);
  receipt.status = 'reverted';
  assert.equal((await protocolInclusion(connection, txId, '10')).verified, false);
  await assert.rejects(protocolInclusion(connection, txId, '-1'), /range/);
  await assert.rejects(protocolInclusion(connection, txId, '12'), /range/);
  // 链高度继续推进超过 20,000 个区块后，仍可在起始区块向后有界窗口内定位历史交易事件。
  receipt.status = 'success';
  const archivalConnection = {
    metadata: { addresses },
    publicClient: {
      getBlockNumber: async () => 50000n,
      getLogs: async ({ fromBlock, toBlock }) => (fromBlock === 10n && toBlock === 1009n ? [log] : []),
      getTransactionReceipt: async () => receipt,
    },
  };
  assert.equal((await protocolInclusion(archivalConnection, txId, '10')).verified, true);
});
test('tracked deployment proof rejects different sender, altered source and untracked history', () => {
  const code = 'class Example: pass\n';
  const operation = { operation: 'deploy', sourceSha256: createHash('sha256').update(code).digest('hex') };
  const transaction = { sender: addresses.ConsensusMain, txDataDecoded: { type: 'deploy', code } };
  assert.equal(verifyTrackedOperation(transaction, operation, addresses.ConsensusMain).operationVerified, true);
  assert.equal(verifyTrackedOperation(transaction, operation, addresses.Staking).operationVerified, false);
  transaction.txDataDecoded.code += '# changed';
  assert.equal(verifyTrackedOperation(transaction, operation, addresses.ConsensusMain).operationVerified, false);
  assert.equal(verifyTrackedOperation(transaction, null, addresses.ConsensusMain).operationVerified, false);
});
test('independent verifier requires matching final VM state as well as inclusion', async () => {
  const hash = `0x${'4'.repeat(64)}`; const envelope = `0x${'5'.repeat(64)}`; const blockHash = `0x${'6'.repeat(64)}`; const code = 'pass\n';
  const log = { args: { txId: hash }, transactionHash: envelope, blockHash, logIndex: 0, address: addresses.ConsensusMain };
  const transaction = { sender: addresses.Staking, recipient: addresses.ConsensusData, statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', lifecycle: { outcome: 'accepted' }, result: 1, resultName: 'MAJORITY_AGREE', txDataDecoded: { type: 'deploy', code, contractAddress: addresses.ConsensusData } };
  const connection = { metadata: { addresses }, publicClient: { getBlockNumber: async () => 11n, getLogs: async () => [log], getTransactionReceipt: async () => ({ status: 'success', transactionHash: envelope, blockHash, blockNumber: 11n, logs: [{ ...log, topics: ['0x', hash] }] }) }, client: { getTransaction: async () => transaction, readContract: async args => { assert.equal(args.address, addresses.ConsensusData); assert.equal(args.transactionHashVariant, 'latest-final'); return 1n; } } };
  const options = { hash, actorAddress: addresses.Staking, sourceSha256: createHash('sha256').update(code).digest('hex'), fromBlock: '10', readback: { method: 'get_count', expected: '1' } };
  assert.equal((await verifyDeploymentEvidence(connection, options)).fullyVerified, true);
  options.readback.expected = '0';
  assert.equal((await verifyDeploymentEvidence(connection, options)).fullyVerified, false);
  options.readback.expected = '1';
  transaction.lifecycle.outcome = 'undetermined'; transaction.result = 5; transaction.resultName = 'NO_MAJORITY';
  const undetermined = await verifyDeploymentEvidence(connection, options);
  assert.equal(undetermined.executionSuccessful, false);
  assert.equal(undetermined.fullyVerified, false);
});

test('recorded public and Studio consensus shapes distinguish VM return from agreement', () => {
  const publicDeploy = { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', lifecycle: { outcome: 'accepted' }, result: 1, resultName: 'MAJORITY_AGREE' };
  const publicNoMajority = { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', lifecycle: { outcome: 'undetermined' }, result: 5, resultName: 'NO_MAJORITY' };
  const studioDeploy = { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', lifecycle: { outcome: 'accepted' }, result: 1 };
  assert.equal(executionSucceeded(publicDeploy), true);
  assert.equal(executionSucceeded(studioDeploy), true);
  assert.equal(executionSucceeded(publicNoMajority), false);
  assert.equal(finalizedUndetermined(publicNoMajority), true);
  assert.equal(executionReverted({ ...publicNoMajority, txExecutionResultName: 'FINISHED_WITH_ERROR' }), false);
  assert.equal(executionReverted({ ...publicDeploy, txExecutionResultName: 'FINISHED_WITH_ERROR' }), true);
  assert.equal(consensusAccepted({ ...publicDeploy, resultName: 'NO_MAJORITY' }), false);
  assert.equal(consensusAccepted({ statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN' }), false);
  const majorityDisagreedWithLeader = { ...publicNoMajority, result: 2, resultName: 'MAJORITY_DISAGREE', txExecutionResultName: 'FINISHED_WITH_ERROR' };
  assert.equal(finalizedUndetermined(majorityDisagreedWithLeader), true);
  assert.equal(executionReverted(majorityDisagreedWithLeader), false);
  assert.equal(executionSucceeded(majorityDisagreedWithLeader), false);
  assert.equal(finalizedUndetermined({ ...majorityDisagreedWithLeader, result: 5 }), false);
});
