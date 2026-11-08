// Diagnostic deploy simulation only. This file never deploys or signs a transaction.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { abi, decodeInputData } from 'genlayer-js';
import { connectBradbury, contractSource, publicJson, safeError, PROJECT_ROOT } from './bradbury-client.mjs';
const RPC = 'https://rpc-bradbury.genlayer.com';
const OWNER = '0x29EB14D10ec2E406E5d1419ED08D803b8B18aB70';
const CONTRACT = '0x503b620680306533D43D57a859aB308eE9a9F7e1';
const FAILED_TX = '0x9fa815aa73a7bac515811960bd9368e25958d5b43ae20f63d86b59cc05eeca3e';
const SOURCE_SHA = '3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3';
const OUTPUT = resolve(PROJECT_ROOT, 'artifacts/bradbury/probe-deploy-simulation-2.json');
const CAPTURES = resolve(PROJECT_ROOT, 'artifacts/bradbury/probe-public-rpc-captures.json');
const captures = [];
const sha = value => createHash('sha256').update(value).digest('hex');
const hexBytes = value => typeof value === 'string' && /^(?:0x)?(?:[0-9a-fA-F]{2})+$/.test(value) ? Buffer.from(value.replace(/^0x/, ''), 'hex') : null;
const mapField = (value, key) => value instanceof Map ? value.get(key) : value?.[key];
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const safeKeys = new Set(['probe_version', 'phase', 'stage', 'index', 'byte_length', 'sha256', 'criterion_id', 'status', 'evidence_indices', 'response_type', 'response_bytes', 'object_valid', 'keys_valid', 'references_valid', 'duplicate_references', 'reason_type_valid', 'reason_bytes', 'reason_limit_exceeded', 'projection', 'equal', 'error_type', 'spec_hash', 'submission_hash', 'content_hash', 'verdict']);
export function markers(stdout) {
  const results = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.startsWith('RR_PROBE_JSON ') || line.length > 16384) continue;
    try {
      const value = JSON.parse(line.slice('RR_PROBE_JSON '.length));
      if (value.probe_version !== 'research-receipt-probe/1' || !['constructor', 'leader', 'validator'].includes(value.phase) || typeof value.stage !== 'string') continue;
      results.push(Object.fromEntries(Object.entries(value).filter(([key]) => safeKeys.has(key))));
    } catch { /* Other stdout cannot become diagnostic evidence. */ }
  }
  return results;
}
function publicDataSummary(value) {
  const bytes = hexBytes(value);
  if (!bytes) return { nonemptyHex: false, decoded: false };
  try {
    const outer = abi.calldata.decode(bytes);
    const outputs = mapField(outer, 'nd_outs');
    return { nonemptyHex: true, byteLength: bytes.length, sha256: sha(bytes), decoded: true, outerKeys: outer instanceof Map ? [...outer.keys()] : Object.keys(outer || {}), outputCount: Array.isArray(outputs) ? outputs.length : null };
  } catch { return { nonemptyHex: true, byteLength: bytes.length, sha256: sha(bytes), decoded: false }; }
}
function responseSummary(response, mode) {
  return { mode, responseShape: Object.fromEntries(Object.entries(response || {}).map(([key, value]) => [key, Array.isArray(value) ? { type: 'array', length: value.length } : value && typeof value === 'object' ? { type: 'object', keys: Object.keys(value) } : { type: typeof value }])), status: response.status ? { code: response.status.code, message: safeError({ name: 'Error', message: response.status.message || '' }) } : null, nondetDisagreementCallNo: response.nondetDisagreementCallNo ?? null, syncedBlock: response.syncedBlock ?? null, rawPublicFields: { data: response.data, leaderPublicData: response.leaderPublicData }, publicData: publicDataSummary(response.leaderPublicData), markers: markers(response.stdout), stdoutBytes: typeof response.stdout === 'string' ? Buffer.byteLength(response.stdout) : null };
}
const OWN_ERRORS = new Set(['Expected a JSON object', 'Missing or unsupported fields', 'JSON payload exceeds byte limit', 'Duplicate JSON object key', 'Invalid JSON payload', 'Model returned an unsupported finding', 'Model returned an invalid evidence reference', 'A substantive finding must cite verified evidence', 'model reason exceeds its byte limit or contains NUL', 'model reason must be non-empty text', 'Assessment verdict does not follow the locked policy']);
const sensitive = value => {
  if (typeof value === 'string') return /(?:authorization|bearer\s+\S+|(?:api[_-]?key|password|secret|token|private[_-]?key)\s*[:=]|sk-[A-Za-z0-9]{12})/i.test(value);
  if (value instanceof Map) return [...value].some(([key, item]) => /^(?:cfg|config|credentials?|api[_-]?key|authorization|password|secret|token|private[_-]?key)$/i.test(String(key)) || sensitive(item));
  if (Array.isArray(value)) return value.some(sensitive);
  return value && typeof value === 'object' ? Object.entries(value).some(([key, item]) => /^(?:cfg|config|credentials?|api[_-]?key|authorization|password|secret|token|private[_-]?key)$/i.test(key) || sensitive(item)) : false;
};
function decodedErrorView(value, key = '', depth = 0) {
  if (depth > 12) return { omitted: 'depth' };
  if (typeof value === 'string') {
    if (OWN_ERRORS.has(value)) return { ownUserError: value };
    if (['UserError', 'NameError', 'TypeError', 'ValueError', 'AttributeError', 'KeyError', 'Forbidden', 'BudgetExceeded'].includes(value)) return value;
    if (['module_name', 'func', 'file', 'name'].includes(key) && /^[A-Za-z0-9_.<>/ -]{1,160}$/.test(value)) return value;
    return { type: 'string', byteLength: Buffer.byteLength(value), sha256: sha(value) };
  }
  if (value instanceof Uint8Array) return { type: 'bytes', byteLength: value.length, sha256: sha(value) };
  if (value instanceof Map) return Object.fromEntries([...value].map(([name, item]) => [String(name), decodedErrorView(item, String(name), depth + 1)]));
  if (Array.isArray(value)) return value.map(item => decodedErrorView(item, key, depth + 1));
  return typeof value === 'bigint' ? value.toString() : value;
}
export function capturePublicError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  let kind = message.match(/VMResult\{Kind:(0x[0-9a-fA-F]+)/)?.[1] || null;
  let bytes = null;
  const list = message.match(/(?:ReturnData|Data):\[\](?:uint8|byte)\{([^}]*)\}/)?.[1];
  if (list !== undefined) {
    const values = list.split(',').map(item => item.trim()).filter(Boolean);
    if (values.every(item => /^(?:0x[0-9a-fA-F]{1,2}|\d{1,3})$/.test(item) && Number(item) <= 255)) bytes = Buffer.from(values.map(Number));
  }
  const nested = error?.data?.vmResult || error?.data?.vm_result || error?.data?.VMResult;
  if (!bytes && nested && typeof nested === 'object') { bytes = hexBytes(nested.Data ?? nested.ReturnData ?? nested.data); kind = nested.Kind ?? nested.kind ?? kind; }
  const captured = { rpcCode: error?.code ?? null, category: message.startsWith('execution failed:') ? 'GENVM_EXECUTION_FAILED' : 'PUBLIC_RPC_ERROR', messageByteLength: Buffer.byteLength(message), messageSha256: sha(message), publicData: error?.data && typeof error.data === 'object' ? { data: typeof error.data.data === 'string' && (hexBytes(error.data.data) || error.data.data === '') ? error.data.data : null, leaderPublicData: typeof error.data.leaderPublicData === 'string' && (hexBytes(error.data.leaderPublicData) || error.data.leaderPublicData === '') ? error.data.leaderPublicData : null, status: error.data.status ? { code: error.data.status.code } : null, markers: markers(error.data.stdout) } : null, vmResult: bytes ? { kind, byteLength: bytes.length, sha256: sha(bytes), decoded: false } : { kind, decoded: false } };
  if (bytes) {
    try {
      const decoded = abi.calldata.decode(bytes);
      captured.vmResult.decoded = true;
      if (sensitive(decoded)) captured.vmResult.filtered = 'configuration or credential-shaped fields excluded';
      else { captured.vmResult.rawDataHex = `0x${bytes.toString('hex')}`; captured.vmResult.decodedWhitelist = decodedErrorView(decoded); }
    } catch { captured.vmResult.filtered = 'unknown binary codec; only hash and byte length retained'; }
  }
  return captured;
}
function errorCodecTests() {
  const data = Buffer.from(abi.calldata.encode({ kind: 'UserError', message: 'model reason exceeds its byte limit or contains NUL', backtrace: [{ module_name: '<cpython', func: 'normalize_model_finding' }] }));
  const go = value => `execution failed: &genvm.VMResult{Kind:0x1, ReturnData:[]uint8{${[...value].map(item => `0x${item.toString(16)}`).join(', ')}}, ...}`;
  const captured = capturePublicError({ code: -32000, message: go(data) });
  assert.equal(captured.vmResult.rawDataHex, `0x${data.toString('hex')}`);
  assert.equal(captured.vmResult.decoded, true);
  assert.equal(captured.vmResult.decodedWhitelist.message.ownUserError, 'model reason exceeds its byte limit or contains NUL');
  const unknown = capturePublicError({ code: -32000, message: go(Buffer.from([255, 255])) });
  assert.equal(unknown.vmResult.rawDataHex, undefined);
  const secret = Buffer.from(abi.calldata.encode({ config: { api_key: 'not-a-real-credential' } }));
  assert.equal(capturePublicError({ message: go(secret) }).vmResult.rawDataHex, undefined);
  assert.equal(captured.vmResult.kind, '0x1');
  console.log(JSON.stringify({ errorCodecChecks: 6, passed: true, networkRequests: 0, knownVmDataPreservedBeforeThrow: true }));
}
async function rpc(request) {
  const response = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'gen_call', params: [request] }), signal: AbortSignal.timeout(180000) });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { const capture = { mode: request.leader_public_data ? 'validator' : 'leader', httpStatus: response.status, responseByteLength: Buffer.byteLength(text), responseSha256: sha(text), category: 'NON_JSON_PUBLIC_RESPONSE' }; captures.push(capture); await writeFile(CAPTURES, `${publicJson(captures)}\n`); throw new Error(capture.category); }
  const captured = { mode: request.leader_public_data ? 'validator' : 'leader', requestType: request.type, requestDataSha256: sha(request.data), httpStatus: response.status, responseByteLength: Buffer.byteLength(text), responseSha256: sha(text), result: json.result ? responseSummary(json.result, request.leader_public_data ? 'validator' : 'leader') : null, error: json.error ? capturePublicError(json.error) : null };
  captures.push(captured);
  await writeFile(CAPTURES, `${publicJson(captures)}\n`); // Persist allowed transport fields BEFORE throwing or classifying.
  if (!response.ok || json.error) {
    throw Object.assign(new Error(captured.error?.category || 'PUBLIC_RPC_ERROR'), { rpcCode: json.error?.code, safeDiagnostics: captured.error });
  }
  return json.result;
}
async function main() {
  if (process.argv.includes('--error-codec-test')) return errorCodecTests();
  const original = await contractSource('contracts/archive/research_receipt_v1.py');
  assert.equal(original.sourceSha256, SOURCE_SHA, 'Original business contract changed; do not substitute it.');
  const prefix = original.code.split('class ResearchReceipt(gl.contract.Contract):')[0];
  const probe = await contractSource('contracts/research_receipt_probe.py');
  assert.equal(probe.code.slice(0, prefix.length), prefix, 'Probe must preserve the original helper prefix verbatim.');
  const fixture = JSON.parse(await readFile(resolve(PROJECT_ROOT, 'artifacts/bradbury/e2e-input.json'), 'utf8'));
  const ctorArgs = [JSON.stringify(fixture.spec), JSON.stringify(fixture.negative)];
  // Exact SDK rc.2 deployContract encoding; decoded independently by its public decoder.
  const data = abi.transactions.serialize([probe.code, abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, ctorArgs)), false]);
  const decoded = decodeInputData(data, '0x0000000000000000000000000000000000000000');
  assert.equal(decoded.type, 'deploy'); assert.equal(decoded.code, probe.code);
  assert.deepEqual(mapField(decoded.constructorArgs, 'args'), ctorArgs);
  if (process.argv.includes('--self-test')) {
    assert.deepEqual(markers('not a marker\nRR_PROBE_JSON {"probe_version":"research-receipt-probe/1","phase":"validator","stage":"comparison","equal":false,"configuration":"excluded"}'), [{ probe_version: 'research-receipt-probe/1', phase: 'validator', stage: 'comparison', equal: false }]);
    assert.equal(markers('RR_PROBE_JSON {"phase":"validator"}').length, 0);
    console.log(JSON.stringify({ selfTest: 'passed', checks: 7, networkRequests: 0, originalSourceUnchanged: true, deploymentCodecRoundtrip: true })); return;
  }
  if (!process.argv.includes('--run')) { console.log('Offline: node scripts/probe-bradbury.mjs --self-test\nBounded read-only deploy simulation: node scripts/probe-bradbury.mjs --run'); return; }
  const report = { format: 'research-receipt/observable-probe/1', diagnosticOnly: true, chainTransactionsSent: 0, startedAt: new Date().toISOString(), sourceTransaction: FAILED_TX, businessContractAddress: CONTRACT, originalSourceSha256: original.sourceSha256, originalHelperPrefixSha256: sha(prefix), probeSourceSha256: probe.sourceSha256, fixtureInputSha256: sha(canonical({ spec: fixture.spec, submission: fixture.negative })), actor: OWNER, codec: 'genlayer-js 2.0.0-rc.2 abi.transactions.serialize; public decodeInputData roundtrip verified', maximumSimulationCalls: 2 };
  try {
    const connection = await connectBradbury();
    const view = (functionName, args) => connection.client.readContract({ address: CONTRACT, functionName, args, transactionHashVariant: 'latest-final' });
    const before = await view('get_assessment', [1, 1]);
    const order = JSON.parse(await view('get_order', [1]));
    const revision = JSON.parse(await view('get_revision', [1, 1]));
    report.expectedSpecHash = order.spec_hash; report.expectedSubmissionHash = revision.submission_hash;
    report.before = { assessmentEmpty: before === '', orderStatus: order.status, revisionCount: order.revision_count };
    if (before !== '') throw new Error('The business assessment already exists; this diagnostic fixture no longer matches the blocked case.');
    const request = { type: 'deploy', from: OWNER, to: '0x0000000000000000000000000000000000000000', data, status: 'finalized', transaction_hash_variant: 'latest-final' };
    const leader = await rpc(request);
    report.leader = responseSummary(leader, 'leader');
    console.log(publicJson({ stage: 'probe-leader-complete', status: report.leader.status, markers: report.leader.markers, publicData: report.leader.publicData }));
    const fixtureMarker = report.leader.markers.find(item => item.phase === 'constructor' && item.stage === 'fixture');
    const fixtureMatches = fixtureMarker?.spec_hash === report.expectedSpecHash && fixtureMarker?.submission_hash === report.expectedSubmissionHash;
    report.fixtureHashesMatch = fixtureMatches;
    if (leader.status?.code === 0 && report.leader.publicData.nonemptyHex && report.leader.publicData.decoded && fixtureMatches && report.leader.markers.some(item => item.phase === 'leader' && item.stage === 'complete')) {
      const validator = await rpc({ ...request, leader_public_data: leader.leaderPublicData });
      report.validator = { ...responseSummary(validator, 'validator'), leaderPublicDataSupplied: true };
    } else report.validator = { skipped: true, reason: 'Successful nonempty decoded leader data and trusted stdout fixture markers were not all present. No second simulation was made.' };
    report.after = { assessmentEmpty: (await view('get_assessment', [1, 1])) === '' };
    report.completedAt = new Date().toISOString();
  } catch (error) { report.error = { message: error.safeDiagnostics?.category || safeError(error), rpcCode: error.rpcCode ?? null, ...(error.safeDiagnostics ? { diagnostics: error.safeDiagnostics } : {}) }; }
  await writeFile(OUTPUT, `${publicJson(report)}\n`);
  console.log(publicJson({ evidenceFile: 'artifacts/bradbury/probe-deploy-simulation-2.json', leaderStatus: report.leader?.status, validatorStatus: report.validator?.status, validatorMarkers: report.validator?.markers, nondetDisagreementCallNo: report.validator?.nondetDisagreementCallNo, fixtureHashesMatch: report.fixtureHashesMatch, after: report.after, error: report.error ? { category: report.error.message, rpcCode: report.error.rpcCode, vmResult: report.error.diagnostics?.vmResult ? { kind: report.error.diagnostics.vmResult.kind, decoded: report.error.diagnostics.vmResult.decoded, byteLength: report.error.diagnostics.vmResult.byteLength, decodedWhitelist: report.error.diagnostics.vmResult.decodedWhitelist } : null } : null }));
}
await main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
