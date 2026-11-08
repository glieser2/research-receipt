// Fresh independent public-testnet actors stay in this process only. No keys,
// account object or signed raw transactions are printed, persisted or exported.
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAccount } from 'genlayer-js';
import { consensusAccepted, executionSucceeded, executionReverted } from '../src/lib/protocol-outcome.mjs';
import { connectBradbury, quoteDevelopmentProfile, contractSource, projectFile, publicJson, protocolInclusion, verifyTrackedOperation, safeError, PROJECT_ROOT } from './bradbury-client.mjs';

async function main() {
const ack = process.env.RR_BRADBURY_DEPLOY_ACK === '1';
const actors = { owner: createAccount(), author: createAccount(), outsider: createAccount() };
const connection = await connectBradbury({ account: actors.owner });
const clients = { owner: connection.client };
// A verified chain object is reused, so actor changes cannot change network identity.
const { createClient } = await import('genlayer-js');
for (const role of ['author', 'outsider']) clients[role] = createClient({ chain: connection.chain, endpoint: connection.metadata.rpcUrl, account: actors[role] });
const artifactDir = resolve(PROJECT_ROOT, 'artifacts/bradbury');
await mkdir(artifactDir, { recursive: true });
const state = {
  ...connection.metadata, sessionAddress: actors.owner.address,
  actors: Object.fromEntries(Object.entries(actors).map(([role, account]) => [role, account.address])),
  readOnly: !ack, contractAddress: null, transactions: [],
};
const stateFile = resolve(artifactDir, `session-${actors.owner.address.toLowerCase()}.json`);
const output = value => console.log(publicJson(value));
const save = () => writeFile(stateFile, `${publicJson(state)}\n`);
const validAddress = value => /^0x[0-9a-fA-F]{40}$/.test(value || '');
const validHash = value => /^0x[0-9a-fA-F]{64}$/.test(value || '');
async function balance(role = 'owner') {
  return clients[role].getBalance({ address: actors[role].address });
}
async function feeRequirement(client) {
  const { quote, scope } = await quoteDevelopmentProfile(client);
  return { protocolDepositWei: quote.feeValue.toString(), scope };
}
function requireAck() { if (!ack) throw new Error('Read-only session: source disclosure and state changes require RR_BRADBURY_DEPLOY_ACK=1 when starting a new session.'); }
async function requireFunding(client, role, quote) {
  const available = await balance(role);
  if (available <= quote.feeValue) throw new Error(`Independent ${role} test account has ${available} wei; it must cover the ${quote.feeValue} wei protocol deposit plus L2 gas. No transaction submitted. Arrange authorized test GEN funding; this process cannot call a faucet or fund an account.`);
}
await save();
let fee;
try { fee = await feeRequirement(clients.owner); } catch (error) { fee = { unavailable: true, error: safeError(error) }; }
output({ ready: true, ...state, balanceWei: (await balance()).toString(), feeRequirement: fee, stateFile, privateKeysPersisted: false });

const lines = createInterface({ input: process.stdin, terminal: false });
for await (const line of lines) {
  if (!line.trim()) continue;
  let request;
  try {
    if (line.length > 131072) throw new Error('Request is too large.');
    request = JSON.parse(line);
    const role = request.role || 'owner'; const client = clients[role];
    if (!client) throw new Error('Unknown independent actor role.');
    if (request.inputFile) {
      const fixture = JSON.parse(await readFile(await projectFile(request.inputFile, '.json'), 'utf8'));
      if (!Object.hasOwn(fixture, request.case)) throw new Error('Unknown fixture case.');
      request.args = [...(request.prefixArgs || []), JSON.stringify(fixture[request.case])];
    }
    const target = request.address || state.contractAddress;
    let result;
    if (request.op === 'balance') result = { role, address: actors[role].address, balanceWei: (await balance(role)).toString() };
    else if (request.op === 'quote') result = await feeRequirement(client);
    else if (request.op === 'bind') {
      if (!validAddress(request.address)) throw new Error('Invalid contract address.');
      state.contractAddress = request.address; result = { contractAddress: state.contractAddress };
    } else if (request.op === 'schema') {
      requireAck();
      const source = await contractSource(request.file);
      result = { sourceSha256: source.sourceSha256, schema: await client.getContractSchemaForCode(source.code) };
    } else if (request.op === 'deploy' || request.op === 'write') {
      requireAck();
      const refreshed = await connectBradbury();
      if (publicJson(refreshed.metadata.addresses) !== publicJson(connection.metadata.addresses)) throw new Error('Protocol addresses changed while awaiting funding. Start a new reviewed session.');
      state.lastWriteNetworkVerification = refreshed.metadata;
      const { quote, scope } = await quoteDevelopmentProfile(client);
      await requireFunding(client, role, quote);
      const fees = { distribution: quote.distribution, feeValue: quote.feeValue };
      const submittedAfterBlock = (await connection.publicClient.getBlockNumber()).toString();
      let source;
      let hash;
      if (request.op === 'deploy') {
        source = await contractSource(request.file);
        hash = await client.deployContract({ code: source.code, args: request.args || [], fees });
      } else {
        if (!validAddress(target) || typeof request.method !== 'string' || !/^[a-z][a-z0-9_]*$/.test(request.method)) throw new Error('A bound contract and valid method are required.');
        hash = await client.writeContract({ address: target, functionName: request.method, args: request.args || [], fees });
      }
      if (!validHash(hash)) throw new Error('No valid transaction ID was returned. Investigate account nonce/history; do not blindly retry.');
      const operation = { hash, hashKind: 'genlayer-protocol-transaction-id', submittedAfterBlock, operation: request.op === 'deploy' ? 'deploy' : request.method, role, submittedAt: new Date().toISOString(), feeValueWei: quote.feeValue.toString(), scope, ...(source ? { sourceSha256: source.sourceSha256, file: request.file || 'contracts/research_receipt.py' } : { address: target }), ...(request.readback ? { readback: request.readback } : {}) };
      state.transactions.push(operation); await save(); result = operation;
    } else if (request.op === 'status') {
      const hash = request.hash || state.transactions.at(-1)?.hash;
      if (!validHash(hash)) throw new Error('A valid transaction ID is required.');
      const transaction = await client.getTransaction({ hash });
      await writeFile(resolve(artifactDir, `${hash}.json`), `${publicJson(transaction)}\n`);
      const finalized = transaction.statusName === 'FINALIZED';
      const successful = executionSucceeded(transaction);
      const operation = state.transactions.find(item => item.hash === hash);
      const { senderVerified, sourceVerification, operationVerified } = verifyTrackedOperation(transaction, operation, operation ? actors[operation.role].address : null);
      if (transaction.txDataDecoded?.contractAddress && transaction.recipient && transaction.txDataDecoded.contractAddress.toLowerCase() !== transaction.recipient.toLowerCase()) throw new Error('Transaction contract address and recipient disagree.');
      const candidate = transaction.txDataDecoded?.contractAddress || transaction.recipient;
      if (request.address && (!validAddress(candidate) || request.address.toLowerCase() !== candidate.toLowerCase())) throw new Error('Requested address differs from this transaction recipient.');
      let blockEvidence;
      try {
        blockEvidence = await protocolInclusion(connection, hash, request.fromBlock ?? operation?.submittedAfterBlock ?? connection.metadata.snapshotBlock);
      } catch (error) { blockEvidence = { verified: false, error: safeError(error) }; }
      let readback = { verified: false, reason: 'No requested VM readback.' };
      const wanted = request.readback || operation?.readback;
      if (successful && wanted && validAddress(candidate)) {
        const address = candidate;
        const value = await client.readContract({ address, functionName: wanted.method, args: wanted.args || [], transactionHashVariant: 'latest-final' });
        readback = { verified: Object.hasOwn(wanted, 'expected') && publicJson(value) === publicJson(wanted.expected), observed: true, variant: 'latest-final', address, method: wanted.method, value, ...(Object.hasOwn(wanted, 'expected') ? { expected: wanted.expected } : { reason: 'Expected value is required to verify state.' }) };
        if (operation?.operation === 'deploy' && operationVerified && blockEvidence.verified && readback.verified) state.contractAddress = address;
      }
      result = { hash, status: transaction.statusName, execution: transaction.txExecutionResultName, finalized, consensusAccepted: consensusAccepted(transaction), consensusOutcome: transaction.lifecycle?.outcome || null, consensusResult: transaction.resultName || transaction.result || null, confirmedRevert: executionReverted(transaction), executionSuccessful: successful, candidateContractAddress: candidate || null, senderVerified, sourceVerification, blockEvidence, readback, fullyVerified: operationVerified && successful && blockEvidence.verified && readback.verified };
      if (operation) operation.observation = result;
    } else if (request.op === 'read') {
      if (!validAddress(target) || typeof request.method !== 'string') throw new Error('A bound contract and read method are required.');
      result = await client.readContract({ address: target, functionName: request.method, args: request.args || [], transactionHashVariant: 'latest-final' });
    } else if (request.op === 'quit') { await save(); output({ closed: true, privateKeysPersisted: false }); break; }
    else throw new Error('Unknown operation. No faucet, funding, reset, transfer or administrator operation is available.');
    await save(); output({ ok: true, op: request.op, result });
  } catch (error) { output({ ok: false, op: request?.op, error: safeError(error) }); }
}
}
await main().catch(error => { console.log(publicJson({ ready: false, error: safeError(error) })); process.exitCode = 1; });
