// One-shot public reads only. No model invocation, signing, appeal, or state write.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { abi } from 'genlayer-js';
import { connectBradbury, PROJECT_ROOT, publicJson, safeError } from './bradbury-client.mjs';
const hash = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) throw new Error('Provide a public protocol transaction ID.');
const plain = value => value instanceof Map ? Object.fromEntries([...value].map(([key, item]) => [String(key), plain(item)])) : value instanceof Uint8Array ? `0x${Buffer.from(value).toString('hex')}` : Array.isArray(value) ? value.map(plain) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)])) : typeof value === 'bigint' ? (value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString()) : value;
const directory = resolve(PROJECT_ROOT, 'artifacts/bradbury');
const offline = process.argv.includes('--offline');
const connection = offline ? null : await connectBradbury();
const tx = offline ? JSON.parse(await readFile(resolve(directory,`${hash}.json`),'utf8')) : await connection.client.getTransaction({ hash });
await mkdir(directory, { recursive: true });
if (!offline) await writeFile(resolve(directory, `${hash}.json`), `${publicJson(plain(tx))}\n`);
const eq = abi.calldata.decode(Buffer.from(tx.eqBlocksOutputs.replace(/^0x/, ''), 'hex'));
const outputs = eq instanceof Map ? eq.get('nd_outs') : eq.nd_outs;
const decodedOutputs = (outputs || []).map((value, index) => {
  const bytes = value instanceof Uint8Array ? value : Buffer.from(String(value).replace(/^0x/, ''), 'hex');
  try { return { index, resultCode: bytes[0], calldata: plain(abi.calldata.decode(bytes.subarray(1))) }; }
  catch { const message = new TextDecoder().decode(bytes.subarray(1)); return { index, resultCode: bytes[0], ownError: /^(?:Model output rejected.*RR_MODEL_[A-Z_]+|Model returned an invalid evidence reference)$/.test(message) ? message : null, byteLength: bytes.length }; }
});
const rounds = [];
const count = Number(tx.numOfRounds);
if (!offline && Number.isSafeInteger(count) && count > 0 && count <= 12 && typeof connection.client.getRoundData === 'function') {
  const last = Number(tx.lastRound?.round);
  if (!Number.isSafeInteger(last) || last < count) throw new Error('Unexpected stored round numbering.');
  for (let round = last - count + 1; round <= last; round++) {
    try { rounds.push({ round, stored: plain(await connection.client.getRoundData({ txId: hash, round: BigInt(round) })) }); }
    catch (error) { rounds.push({ round, error: safeError(error) }); }
  }
}
const call = tx.txDataDecoded?.callData;
const args = call instanceof Map ? call.get('args') : call?.args;
let finalState = null;
if (!offline && Array.isArray(args) && args.length === 2 && typeof tx.recipient === 'string') {
  const method = call instanceof Map ? call.get('') : call?.[''];
  if (method === 'evaluate') {
    const view = (functionName, args) => connection.client.readContract({ address: tx.recipient, functionName, args, transactionHashVariant: 'latest-final' });
    const orderId = Number(args[0]); const revision = Number(args[1]);
    const [order, assessment] = await Promise.all([view('get_order', [orderId]), view('get_assessment', [orderId, revision])]);
    finalState = { orderId, revision, order: typeof order === 'string' ? JSON.parse(order) : plain(order), assessmentEmpty: assessment === '', assessment: assessment === '' ? null : typeof assessment === 'string' ? JSON.parse(assessment) : plain(assessment) };
  }
}
const report = { format: 'research-receipt/public-consensus-diagnostic/1', observedAt: new Date().toISOString(), readOnly: true, modelCalls: 0, protocolTxId: hash, status: tx.statusName, resultCode: tx.result, resultName: tx.resultName, lifecycle: tx.lifecycle, execution: tx.txExecutionResultName, numOfRounds: tx.numOfRounds, lastRound: plain(tx.lastRound), storedRounds: rounds, decodedPublicLeaderOutputs: decodedOutputs, finalState, limits: ['Stored votes and public leader outputs do not reveal private validator reasoning or independent classifications.', 'NONDET_DISAGREE alone does not identify semantic, schema, source-I/O or resource failure. Stored-round data may not preserve overwritten leader rotations.'] };
await writeFile(resolve(directory, `consensus-diagnostic-${hash}.json`), `${publicJson(report)}\n`);
console.log(publicJson({ evidenceFile: `artifacts/bradbury/consensus-diagnostic-${hash}.json`, status: tx.statusName, result: tx.resultName, lifecycle: tx.lifecycle, execution: tx.txExecutionResultName, roundCount: tx.numOfRounds, lastRound: plain(tx.lastRound), publicOutputs: decodedOutputs.map(item => ({ index: item.index, resultCode: item.resultCode, verdict: item.calldata?.verdict, findings: item.calldata?.findings?.map(finding => ({ criterion_id: finding.criterion_id, status: finding.status, evidence_indices: finding.evidence_indices, reasonBytes: typeof finding.reason === 'string' ? Buffer.byteLength(finding.reason) : null })), source_checks: item.calldata?.source_checks, ownError: item.ownError })), finalState: finalState ? { orderId: finalState.orderId, revision: finalState.revision, status: finalState.order.status, revisionCount: finalState.order.revision_count, assessmentEmpty: finalState.assessmentEmpty } : null }));
