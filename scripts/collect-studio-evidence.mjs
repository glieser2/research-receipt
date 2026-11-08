// Read-only evidence collector. Deliberately excludes raw validator/model configuration.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createClient } from 'genlayer-js';
import { consensusAccepted, executionSucceeded } from '../src/lib/protocol-outcome.mjs';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
const deployment = JSON.parse(await readFile('src/deployment.json', 'utf8'));
const session = JSON.parse(await readFile('artifacts/live/session.json', 'utf8'));
const client = createClient({ chain: studioDevnet, endpoint: deployment.rpcUrl });
if (await client.getChainId() !== 61997) throw new Error('Wrong Studio-dev chain');
const sourceSha256 = createHash('sha256').update(await readFile('contracts/research_receipt.py')).digest('hex');
if (sourceSha256 !== deployment.sourceSha256) throw new Error('Source changed since deployment');
const transactions = [];
let deployedSourceSha256;
for (const operation of [{ hash: deployment.deploymentTx, operation: 'deploy' }, ...session.transactions,
  { hash: '0x69a3cbfa6db2cb0cfe30c3ce4651568a51ac86db70b1e1fc0f83305a575115c8', operation: 'evaluate', role: 'browser-independent-test-account', orderId: 3, revision: 1 }]) {
  const tx = await client.getTransaction({ hash: operation.hash });
  if (tx.statusName !== 'FINALIZED') throw new Error(`Transaction is not final: ${operation.hash}`);
  if (operation.operation === 'deploy') {
    deployedSourceSha256 = createHash('sha256').update(Buffer.from(tx.data.contract_code, 'base64')).digest('hex');
    if (deployedSourceSha256 !== sourceSha256 || tx.data.contract_address.toLowerCase() !== deployment.contractAddress.toLowerCase()) throw new Error('Deployment code or address does not match configured release');
  }
  transactions.push({ ...operation, status: tx.statusName, execution: tx.txExecutionResultName, consensusAccepted: consensusAccepted(tx), consensusOutcome: tx.lifecycle?.outcome || null, consensusResult: tx.resultName || tx.result_name || tx.result || null, successful: executionSucceeded(tx), blockHash: tx.blockHash ?? null, blockNumber: tx.blockNumber ?? null,
    leaderResult: tx.consensus_data?.leader_receipt?.[0]?.result ?? null });
}
const read = async (functionName, args) => {
  const value = await client.readContract({ address: deployment.contractAddress, functionName, args, transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
  return typeof value === 'string' && value ? JSON.parse(value) : value;
};
const orders = [];
for (const id of [1, 2, 3]) {
  const order = await read('get_order', [id]);
  const revisions = [];
  for (let revision = 1; revision <= order.revision_count; revision++) revisions.push({ submission: await read('get_revision', [id, revision]), assessment: await read('get_assessment', [id, revision]) });
  orders.push({ order, revisions });
}
const byId = id => orders.find(item => item.order.id === id);
const checks = {
  allTrackedTransactionsReachedConsensus: transactions.every(item => item.consensusAccepted),
  deployedSourceMatchesRelease: deployedSourceSha256 === sourceSha256,
  contradictedClaimRejected: byId(1).revisions[0].assessment.verdict === 'NOT_ACCEPTED',
  correctedRevisionAccepted: byId(1).revisions[1].assessment.verdict === 'ACCEPTED',
  hashMismatchFailsClosed: byId(2).revisions[0].assessment.verdict === 'INSUFFICIENT_EVIDENCE' && byId(2).revisions[0].assessment.source_checks[0].status === 'HASH_MISMATCH',
  duplicateContentDidNotAddRevision: byId(2).order.revision_count === 1,
  browserWorkflowAccepted: byId(3).revisions[0]?.assessment?.verdict === 'ACCEPTED',
  unauthorizedSubmissionReverted: transactions.find(t => t.hash === '0x287604aa3a7f25c374ae0ed77fb536d321cb055db5c8c025118111d5f1e9560f')?.execution === 'FINISHED_WITH_ERROR',
  duplicateAssessmentReverted: transactions.find(t => t.hash === '0xd9f5c7c394523573ab98790561a791a1a87b76230eead5119d033ad1d5a2434a')?.execution === 'FINISHED_WITH_ERROR',
  duplicateContentReverted: transactions.find(t => t.hash === '0xd382a6c57e0efc2f0559ed9b65a699cd84e5d3a55aa566f0a5c40a8c10e204de')?.execution === 'FINISHED_WITH_ERROR',
};
await mkdir('docs/evidence', { recursive: true });
await writeFile('docs/evidence/studio-e2e.json', JSON.stringify({ collectedAt: new Date().toISOString(), environment: 'Official hosted Studio-dev development simulator; not proof of public Bradbury chain deployment', deployment, sourceSha256, deployedSourceSha256, actors: session.actors, checks, transactions, orders }, null, 2) + '\n');
console.log(JSON.stringify({ checks, allPassed: Object.values(checks).every(Boolean), evidenceFile: 'docs/evidence/studio-e2e.json' }));
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
