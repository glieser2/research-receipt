// EXPERIMENTAL / NOT ADOPTED. Offline only: root stopped the matrix before RPC.
// Candidate anchoring is a material risk. Official classification guidance still
// favors independent re-derivation; this code is not an official recommendation.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { abi, decodeInputData } from 'genlayer-js';
import { contractSource, PROJECT_ROOT, publicJson } from './bradbury-client.mjs';

export const BASE_SOURCE_SHA = 'cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745';
export const IDS = Object.freeze(['permissions', 'withdrawals', 'audit', 'limitations']);
const sha = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const mapField = (value, key) => value instanceof Map ? value.get(key) : value?.[key];

export const CONTROLS = Object.freeze([
  { id: 'C1', submission: 'positive', statuses: ['SUPPORTED', 'SUPPORTED', 'SUPPORTED', 'SUPPORTED'], verdict: 'ACCEPTED', expectedVector: [true, true, true, true], expectedStage: 'decision', expectedInvalidCriterion: null },
  { id: 'C2', submission: 'negative', statuses: ['SUPPORTED', 'SUPPORTED', 'SUPPORTED', 'SUPPORTED'], verdict: 'ACCEPTED', expectedVector: [false, true, true, true], expectedStage: 'decision', expectedInvalidCriterion: 'permissions' },
  { id: 'C3', submission: 'negative', statuses: ['CONTRADICTED', 'SUPPORTED', 'SUPPORTED', 'SUPPORTED'], verdict: 'NOT_ACCEPTED', expectedVector: [true, true, true, true], expectedStage: 'decision', expectedInvalidCriterion: null },
  { id: 'C4', submission: 'positive', statuses: ['CONTRADICTED', 'SUPPORTED', 'SUPPORTED', 'SUPPORTED'], verdict: 'NOT_ACCEPTED', expectedVector: [false, true, true, true], expectedStage: 'decision', expectedInvalidCriterion: 'permissions' },
  { id: 'C5', submission: 'positive', statuses: ['INSUFFICIENT_EVIDENCE', 'SUPPORTED', 'SUPPORTED', 'SUPPORTED'], verdict: 'INSUFFICIENT_EVIDENCE', expectedVector: [false, true, true, true], expectedStage: 'decision', expectedInvalidCriterion: 'permissions', emptyPermissionRefs: true },
  { id: 'C6', submission: 'positive', statuses: ['SUPPORTED', 'SUPPORTED', 'SUPPORTED', 'SUPPORTED'], verdict: 'ACCEPTED', expectedVector: null, expectedStage: 'candidate_rejected', expectedCode: 'RR_CANDIDATE_REFERENCE_INVALID', expectedInvalidCriterion: 'permissions', invalidReference: 99, expectedModelCalls: 0 },
]);
function normalizedSpec(value) {
  return { ...value, title: value.title.trim(), protocol: value.protocol.trim(), chain: value.chain.trim(), as_of: value.as_of.trim(), author: value.author.trim().toLowerCase(), client_ref: value.client_ref.trim(), criteria: value.criteria.map(item => ({ ...item, id: item.id.trim(), text: item.text.trim() })) };
}
function normalizedSubmission(value) {
  return { report_title: value.report_title.trim(), report_body: value.report_body.trim(), report_version: value.report_version.trim(), sources: value.sources.map(item => ({ ...item, url: item.url.trim() })), claims: value.claims.map(item => ({ ...item, statement: item.statement.trim(), evidence_indices: [...item.evidence_indices].sort((a, b) => a - b) })) };
}
export function buildMatrix(fixture) {
  assert.deepEqual(fixture.spec.criteria.map(item => item.id), IDS, 'All four original criteria must remain present in order.');
  const spec = normalizedSpec(fixture.spec);
  return CONTROLS.map(control => {
    const submission = normalizedSubmission(fixture[control.submission]);
    const candidate = { findings: IDS.map((id, index) => ({ criterion_id: id, status: control.statuses[index], evidence_indices: index === 0 && control.emptyPermissionRefs ? [] : index === 0 && control.invalidReference !== undefined ? [control.invalidReference] : [...submission.claims.find(item => item.criterion_id === id).evidence_indices], reason: 'Diagnostic seed only; this reason is withheld from the verifier model.' })), source_checks: submission.sources.map((item, index) => ({ index, status: 'VERIFIED', sha256: item.sha256 })), verdict: control.verdict };
    return { id: control.id, spec, submission, candidate, specSha256: sha(canonical(spec)), submissionSha256: sha(canonical(submission)), candidateSha256: sha(canonical(candidate)), expectedBooleanField: 'matches', expectedStage: control.expectedStage, expectedCode: control.expectedCode || null, expectedVector: control.expectedVector, expectedInvalidCriterion: control.expectedInvalidCriterion, expectedModelCalls: control.expectedModelCalls ?? 'one, or two only for one malformed-format repair', semanticTrialRequires: control.id === 'C6' ? ['specific out-of-bounds candidate rejection', 'zero model calls'] : ['all sources independently VERIFIED', 'complete legal four-ID boolean vector', 'exact expected vector', 'no IO/schema failure used as a false-case pass'], leaderPublicDataOrigin: 'NOT_REQUESTED_EXPERIMENT_NOT_ADOPTED' };
  });
}
export function safeMarkers(stdout) {
  const allowed = new Set(['probe_version', 'case_id', 'phase', 'stage', 'spec_hash', 'submission_hash', 'candidate_hash', 'source_fetches', 'model_calls', 'format_repairs', 'check', 'http_status', 'actual_bytes', 'committed_bytes', 'code', 'decision', 'findings', 'source_checks', 'deterministic_ids', 'model_ids', 'checks', 'basis']);
  const result = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    if (!line.startsWith('RR_CANDIDATE_JSON ') || line.length > 16384) continue;
    try { const value = JSON.parse(line.slice('RR_CANDIDATE_JSON '.length)); if (value.probe_version === 'research-receipt-candidate-probe/1' && /^C[1-6]$/.test(value.case_id) && ['constructor', 'leader', 'validator'].includes(value.phase)) result.push(Object.fromEntries(Object.entries(value).filter(([key]) => allowed.has(key)))); } catch { /* Other stdout is not evidence. */ }
  }
  return result;
}
async function main() {
  if (process.argv.includes('--run') || process.argv.includes('--run-locked-plan')) throw new Error('EXPERIMENTAL / NOT ADOPTED: matrix RPC execution is disabled. The legacy positive fixture has an unresolved semantic scope issue; a new decision and reviewed oracle would be required.');
  const base = await contractSource('contracts/archive/research_receipt_v2.py');
  assert.equal(base.sourceSha256, BASE_SOURCE_SHA);
  const probe = await contractSource('contracts/research_receipt_candidate_probe.py');
  const prefix = base.code.split('class ResearchReceipt(gl.contract.Contract):')[0];
  assert.equal(probe.code.slice(0, prefix.length), prefix);
  const fixtureBytes = await readFile(resolve(PROJECT_ROOT, 'tests/fixtures/candidate-validation-structural.json'));
  const fixture = JSON.parse(fixtureBytes);
  assert.equal(fixture.structuralOnly, true);
  const cases = buildMatrix(fixture);
  for (const item of cases) {
    // Expected vectors/labels are NOT constructor arguments or model inputs.
    const args = [JSON.stringify(item.spec), JSON.stringify(item.submission), JSON.stringify(item.candidate), item.id];
    const data = abi.transactions.serialize([probe.code, abi.calldata.encode(abi.calldata.makeCalldataObject(undefined, args)), false]);
    const decoded = decodeInputData(data, '0x0000000000000000000000000000000000000000');
    assert.equal(decoded.type, 'deploy'); assert.equal(decoded.code, probe.code); assert.deepEqual(mapField(decoded.constructorArgs, 'args'), args);
    item.deploymentPayloadSha256 = sha(data);
  }
  assert.equal(cases[0].candidateSha256, cases[1].candidateSha256, 'Paired positive/negative controls must receive identical proposed candidates.');
  assert.deepEqual(cases[4].candidate.findings[0].evidence_indices, []);
  assert.deepEqual(cases[5].candidate.findings[0].evidence_indices, [99]);
  assert.deepEqual(safeMarkers('RR_CANDIDATE_JSON {"probe_version":"research-receipt-candidate-probe/1","case_id":"C2","phase":"validator","stage":"decision","decision":false,"configuration":"discard"}')[0], { probe_version: 'research-receipt-candidate-probe/1', case_id: 'C2', phase: 'validator', stage: 'decision', decision: false });
  if (process.argv.includes('--write-draft')) {
    const report = { format: 'research-receipt/candidate-validation-draft/1', status: 'EXPERIMENTAL_NOT_ADOPTED', executionBlocked: true, oracleGroundTruthApproved: false, matrixExecuted: false, modelCalls: 0, genlayerRpcCalls: 0, chainTransactionsSent: 0, baseBusinessSourceSha256: base.sourceSha256, baseBusinessSourcePath: 'contracts/archive/research_receipt_v2.py', baseHelperPrefixSha256: sha(prefix), candidateProbeSourceSha256: probe.sourceSha256, structuralFixtureSha256: sha(fixtureBytes), referenceFailedPositiveTransaction: '0x80ca07a9dc78451ba1fba1ce557a3f90fc7f2dd6a2c3928754c128570d101f2d', sourceCommitFixture: { file: 'tests/fixtures/ownable-3e6c8639.sol', sha256: '38578bd71c0a909840e67202db527cc6b4e6b437e0f39f0c909da32c1e30cb81', byteLength: 3102 }, risks: ['Candidate-conditioned verification can anchor the model and accept a false proposed classification.', 'Official guidance for classification ordinarily favors independent re-derivation. This experiment is not an official recommendation for this use case.', 'The old positive claim may overstate default-unmodified implementation guarantees and omit Context/virtual dependencies. These structural fixtures are not an approved semantic oracle.', 'No matrix result exists. Controlled local booleans and successful ABI roundtrips establish plumbing only.'], officialGuidance: 'https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle', cases };
    await writeFile(resolve(PROJECT_ROOT, 'artifacts/bradbury/candidate-validation-not-adopted.json'), `${publicJson(report)}\n`);
  }
  console.log(JSON.stringify({ status: 'EXPERIMENTAL_NOT_ADOPTED', selfTest: 'passed', matrixCases: cases.length, deploymentCodecRoundtrips: cases.length, oracleGroundTruthApproved: false, genlayerRpcCalls: 0, modelCalls: 0 }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main().catch(error => { console.error(error.message); process.exitCode = 1; });
