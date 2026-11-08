// Read-only public-chain collector. Never signs, funds, deploys, or saves raw RPC responses.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { connectBradbury, contractSource, projectFile, protocolInclusion, publicJson, safeError, PROJECT_ROOT } from './bradbury-client.mjs';
import { consensusAccepted as protocolAccepted, finalizedUndetermined } from '../src/lib/protocol-outcome.mjs';
import { validateEvidenceSnapshot, canonicalEvidenceJson } from '../src/lib/evidence-snapshot.mjs';
export { consensusAccepted as protocolAccepted } from '../src/lib/protocol-outcome.mjs';

const OUTPUT = resolve(PROJECT_ROOT, 'docs/evidence/bradbury-e2e.json');
const SESSION = 'artifacts/bradbury/session-0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70.json';
export const RELEASE = Object.freeze({ contractAddress: '0x503b620680306533D43D57a859aB308eE9a9F7e1', deploymentTx: '0x165cf7c5ec1034706c2b69495f362f814cee7feb91b3e2c95cc64561b4c5161b', sourceSha256: '3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3' });
export const CASES = Object.freeze({
  deployment: ['deploy', false], createCorrectionOrder: ['create_order', false], submitContradicted: ['submit_revision', false], evaluateContradicted: ['evaluate', false],
  submitCorrected: ['submit_revision', false], evaluateCorrected: ['evaluate', false], createHashMismatchOrder: ['create_order', false], submitHashMismatch: ['submit_revision', false],
  evaluateHashMismatch: ['evaluate', false], duplicateContent: ['submit_revision', true], createAuthorLockedOrder: ['create_order', false], unauthorizedSubmission: ['submit_revision', true],
  duplicateAssessment: ['evaluate', true], acceptedOrderClosed: ['submit_revision', true],
  createStrictUnknownOrder: ['create_order', false], submitStrictUnknown: ['submit_revision', false], evaluateStrictUnknown: ['evaluate', false],
  unboundReportBody: ['submit_revision', true],
  verifyContradictedEvidence: ['verify_evidence', false], verifyCorrectedEvidence: ['verify_evidence', false],
  verifyHashMismatchEvidence: ['verify_evidence', false], verifyStrictUnknownEvidence: ['verify_evidence', false],
  evaluateBeforeEvidence: ['evaluate', true], duplicateEvidenceSnapshot: ['verify_evidence', true],
});
const STAGED_CASES = new Set(['verifyContradictedEvidence','verifyCorrectedEvidence','verifyHashMismatchEvidence','verifyStrictUnknownEvidence','evaluateBeforeEvidence','duplicateEvidenceSnapshot']);
const dualPolicy = config => ['research-receipt/3','research-receipt/4','research-receipt/5'].includes(config.policyVersion);
const boundPolicy = config => ['research-receipt/4','research-receipt/5'].includes(config.policyVersion);
const requiredCases = config => Object.entries(CASES).filter(([name]) => STAGED_CASES.has(name) ? config.policyVersion === 'research-receipt/5' : name === 'unboundReportBody' ? boundPolicy(config) : dualPolicy(config) || !['createStrictUnknownOrder','submitStrictUnknown','evaluateStrictUnknown'].includes(name));
const validHash = value => /^0x[0-9a-fA-F]{64}$/.test(value || '');
const validAddress = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const sha = value => createHash('sha256').update(value).digest('hex');
export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const jsonValue = value => typeof value === 'string' && value ? JSON.parse(value) : value;
const field = (value, key) => value instanceof Map ? value.get(key) : value?.[key];
const scalarPick = (value, keys) => Object.fromEntries(keys.filter(key => ['string', 'number', 'boolean'].includes(typeof value?.[key]) || value?.[key] === null).map(key => [key, value[key]]));
const array = value => Array.isArray(value) ? value : [];
const scalars = value => array(value).filter(item => ['string', 'number', 'boolean'].includes(typeof item));
const sourceView = value => scalarPick(value, ['url', 'sha256', 'byte_length']);
const criterionView = value => scalarPick(value, ['id', 'text', 'required', 'evidence_requirement']);
const claimView = value => ({ ...scalarPick(value, ['criterion_id', 'statement']), evidence_indices: scalars(value?.evidence_indices) });
const submissionView = value => ({ ...scalarPick(value, ['report_title', 'report_body', 'report_version']), sources: array(value?.sources).map(sourceView), claims: array(value?.claims).map(claimView) });
const orderView = value => ({ ...scalarPick(value, ['id', 'owner', 'spec_hash', 'policy_version', 'revision_count', 'status', 'created_at']), spec: { ...scalarPick(value?.spec, ['title', 'protocol', 'chain', 'as_of', 'author', 'client_ref']), allowed_hosts: scalars(value?.spec?.allowed_hosts), source_roots: scalars(value?.spec?.source_roots), criteria: array(value?.spec?.criteria).map(criterionView) } });
const revisionView = value => ({ ...scalarPick(value, ['order_id', 'revision', 'submission_hash', 'content_hash', 'previous_submission_hash', 'submitted_by', 'submitted_at']), submission: submissionView(value?.submission) });
const assessmentView = value => !value ? null : ({ ...scalarPick(value, ['verdict', 'order_id', 'revision', 'spec_hash', 'submission_hash', 'content_hash', 'policy_version', 'snapshot_hash', 'assessed_at', 'scope']), findings: array(value.findings).map(item => ({ ...scalarPick(item, ['criterion_id', 'status', 'delivery_status', 'reason']), evidence_indices: scalars(item?.evidence_indices) })), source_checks: array(value.source_checks).map(item => scalarPick(item, ['index', 'status', 'sha256'])) });

function normalizeSubmission(value) {
  return { report_title: value.report_title.trim(), report_body: value.report_body.trim(), report_version: value.report_version.trim(),
    sources: value.sources.map(item => ({ url: item.url.trim(), sha256: item.sha256, byte_length: item.byte_length })),
    claims: value.claims.map(item => ({ criterion_id: item.criterion_id, statement: item.statement.trim(), evidence_indices: [...item.evidence_indices].sort((a, b) => a - b) })) };
}
export function normalizeBoundSubmission(value,spec) {
  const normalized=normalizeSubmission(value);
  const claims=new Map(normalized.claims.map(item=>[item.criterion_id,item]));
  if (claims.size!==normalized.claims.length || normalized.claims.some(item=>!spec.criteria.some(row=>row.id===item.criterion_id))) throw new Error('Unknown or duplicate bound claim');
  normalized.claims=spec.criteria.filter(row=>claims.has(row.id)).map(row=>claims.get(row.id));
  normalized.report_body=value.report_body;
  if (normalized.report_body!==normalized.claims.map(row=>row.statement).join('\n')) throw new Error('Unbound report body');
  return normalized;
}
const normalizeForPolicy=(value,spec,policyVersion)=>boundPolicy({policyVersion})?normalizeBoundSubmission(value,spec):normalizeSubmission(value);
export function normalizeSpec(value) {
  return { title: value.title.trim(), protocol: value.protocol.trim(), chain: value.chain.trim(), as_of: value.as_of.trim(), author: value.author.trim().toLowerCase(), client_ref: value.client_ref.trim(), allowed_hosts: [...value.allowed_hosts], source_roots: [...value.source_roots], criteria: value.criteria.map(item => ({ id: item.id.trim(), text: item.text.trim(), required: item.required, ...(item.evidence_requirement !== undefined ? {evidence_requirement:item.evidence_requirement} : {}) })) };
}
export function v3AssessmentPolicyValid(order, revision, assessment) {
  try {
    if (!dualPolicy({policyVersion:order.policy_version}) || assessment.policy_version !== order.policy_version || assessment.findings.length !== order.spec.criteria.length || assessment.source_checks.length !== revision.submission.sources.length) return false;
    if (boundPolicy({policyVersion:order.policy_version}) && canonical(normalizeBoundSubmission(revision.submission,order.spec))!==canonical(revision.submission)) return false;
    const verified = new Set();
    if (!assessment.source_checks.every((check,index) => check.index === index && ['VERIFIED','UNAVAILABLE','TOO_LARGE','HASH_MISMATCH','INVALID_ENCODING'].includes(check.status) && (check.sha256 === '' || /^[0-9a-f]{64}$/.test(check.sha256)) && (check.status !== 'VERIFIED' || (check.sha256 === revision.submission.sources[index].sha256 && (verified.add(index),true))))) return false;
    const claims = new Map(revision.submission.claims.map(item=>[item.criterion_id,item]));
    const deliveries = [];
    for (const [index,criterion] of order.spec.criteria.entries()) {
      if (!['fact_required','scoped_unknown_allowed'].includes(criterion.evidence_requirement)) return false;
      const finding=assessment.findings[index], claim=claims.get(criterion.id);
      if (finding.criterion_id !== criterion.id || !['SUPPORTED','CONTRADICTED','SCOPED_UNKNOWN','NOT_ESTABLISHED','SOURCE_UNAVAILABLE'].includes(finding.status) || !Array.isArray(finding.evidence_indices) || finding.evidence_indices.length > 3 || new Set(finding.evidence_indices).size !== finding.evidence_indices.length || typeof finding.reason !== 'string' || !finding.reason.trim() || Buffer.byteLength(finding.reason)>800 || finding.reason.includes('\0')) return false;
      if (!claim) { if (finding.status !== 'NOT_ESTABLISHED' || finding.evidence_indices.length) return false; }
      else if (!claim.evidence_indices.length || claim.evidence_indices.some(i=>!verified.has(i))) { if (finding.status !== 'SOURCE_UNAVAILABLE' || finding.evidence_indices.length) return false; }
      else if (finding.status === 'SOURCE_UNAVAILABLE' || finding.evidence_indices.some(i=>!Number.isInteger(i) || !verified.has(i) || !claim.evidence_indices.includes(i)) || (finding.status !== 'NOT_ESTABLISHED' && !finding.evidence_indices.length)) return false;
      const delivery = finding.status === 'SUPPORTED' || (finding.status === 'SCOPED_UNKNOWN' && criterion.evidence_requirement === 'scoped_unknown_allowed') ? 'FULFILLED' : finding.status === 'CONTRADICTED' ? 'CONTRADICTED' : 'INSUFFICIENT';
      if (finding.delivery_status !== delivery) return false;
      deliveries.push({required:criterion.required,delivery});
    }
    const verdict = deliveries.some(row=>row.required&&row.delivery==='CONTRADICTED') ? 'NOT_ACCEPTED' : deliveries.some(row=>row.required&&row.delivery==='INSUFFICIENT') ? 'INSUFFICIENT_EVIDENCE' : deliveries.some(row=>!row.required&&row.delivery==='CONTRADICTED') ? 'REVISION_REQUIRED' : 'ACCEPTED';
    return assessment.verdict === verdict;
  } catch { return false; }
}
export function expectedAssessmentMatches(assessment, expected) {
  return !!assessment && !!expected && assessment.verdict === expected.verdict && canonical(assessment.findings.map(item=>item.status)) === canonical(expected.statuses) && canonical(assessment.findings.map(item=>item.delivery_status)) === canonical(expected.delivery);
}
export function contentFingerprint(value) {
  const submission = normalizeSubmission(value);
  const sources = submission.sources.map(canonical);
  return sha(canonical({ report_body: submission.report_body, sources: [...sources].sort(), claims: submission.claims.map(item => ({ criterion_id: item.criterion_id, statement: item.statement, evidence: item.evidence_indices.map(index => sources[index]).sort() })).sort((a, b) => a.criterion_id < b.criterion_id ? -1 : a.criterion_id > b.criterion_id ? 1 : 0) }));
}

function normalizeRelease(value, label) {
  const deploymentHash = value?.deploymentHash || value?.deploymentTx;
  if (!validAddress(value?.contractAddress) || !/^[0-9a-f]{64}$/.test(value?.sourceSha256 || '') || !validHash(deploymentHash)) throw new Error(`Invalid ${label} release address, source hash or deployment hash.`);
  if (value.deploymentHash && value.deploymentTx && value.deploymentHash.toLowerCase() !== value.deploymentTx.toLowerCase()) throw new Error(`Conflicting ${label} deployment hashes.`);
  if (value.sourceFile !== undefined && (typeof value.sourceFile !== 'string' || !value.sourceFile.endsWith('.py'))) throw new Error(`Invalid ${label} source file.`);
  const priorSuiteHashes = value.priorSuiteHashes || [];
  if (!Array.isArray(priorSuiteHashes) || priorSuiteHashes.length > 100 || priorSuiteHashes.some(hash => !validHash(hash)) || new Set(priorSuiteHashes.map(hash => hash.toLowerCase())).size !== priorSuiteHashes.length || (label !== 'main' && priorSuiteHashes.length)) throw new Error('priorSuiteHashes is a unique bounded list supported only by the main release.');
  if (priorSuiteHashes.some(hash => hash.toLowerCase() === deploymentHash.toLowerCase())) throw new Error('The shared main deployment cannot be archived as a prior-suite operation.');
  return { contractAddress: value.contractAddress, sourceSha256: value.sourceSha256, deploymentHash, ...(value.sourceFile ? { sourceFile: value.sourceFile } : {}), ...(label === 'main' ? { priorSuiteHashes: [...priorSuiteHashes] } : {}) };
}

// Fixed public history cannot disappear merely by selecting a new suite/source.
export const RETAINED_RELEASES = Object.freeze([
  { contractAddress: RELEASE.contractAddress, sourceSha256: RELEASE.sourceSha256, deploymentHash: RELEASE.deploymentTx, hashes: [
    '0x642326605fb1c629e1064f95dd6faafabb8a9440ccd31206647cbec05153ed4e','0x15d3b833061b89ede1e5888b23a79d601d842f5d368f92d5a727a82dbbbf50e9',
    '0x9fa815aa73a7bac515811960bd9368e25958d5b43ae20f63d86b59cc05eeca3e','0xc78c86d823ddc2e5a4f8ce459a9aa36e3ccdee566e482a1726b257588766ab81'] },
  { contractAddress:'0xEE2F34aF1ef90938341a95B466769C92A96E61A8',sourceSha256:'cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745',deploymentHash:'0x1923ca36b3db8874e03de50e728e3d2250b60eb5a30d67b792b2b1815ac2dd6c',hashes:[
    '0x025e6c275b53d5d4fb9a34375a478b4d0355dbfbb8fba89c956f9e5afa301a81','0x4d276506bd6c03160386c552545dc127baa92d6a35cf32d32ce1cfb6b51b11db',
    '0xd98baf35614086fbde25d844814dfb54079455ff2b1662dde532c3ee3923a23c','0x62f75af7f5d9950c9ba1bb8482746635ddf595939c277fffc085d3f28c248532',
    '0x80ca07a9dc78451ba1fba1ce557a3f90fc7f2dd6a2c3928754c128570d101f2d','0x3dc9d06e19a67c1b175f42f5cdca3214fe38260e3c0c35fdf2e07b427d3311f6',
    '0x69c09902573b7c147411b8d76e250ed2afc39b8027a55f56f44b979bf0ed5ee4','0x2b00f80e8046baf05ccfd8861ff9ef75bb4c6d05454882d39a2a78f99bfb4c19',
    '0x13b8b97e11233d172466b19b4c88a8323ddab8ac0dfae5ce22e2ac2f48288c68','0x73fb585e610bf678975dfaf3c898c4d93646606fe4df7f6475b05dc93a6cb1d6',
    '0xdadd4bab5ecae0f5344e4a495dc4adb408d66ee81632fb141d7830a934fa7c6a'] },
  {contractAddress:'0x4e95cB64A0AD4fb443B0304dA850162BbEF7d973',sourceSha256:'f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61',deploymentHash:'0x811fb897a3dc207b7a6b3e55f6c4b61c169aac0a555eaa93367a5db56bbe9a5c',hashes:[
    '0x0c11c9f25bc36f9cb8b0b0984e488ee1ba97919d4d0b743d7c088ce2df4c46b0','0xadda1aec9b57f5c872e0be112599cacc90e998ad436b6be02799ce84df84ec47','0x1d7706bced5cba28771e37252469039e312401b40be166fa5eacb91e1591aea8']},
]);
export const AUXILIARY_RELEASES = Object.freeze([
  {kind:'source-only-probe',contractAddress:'0x7825b6e308152e6B980142A0Ba2c34B95b104A58',deploymentHash:'0xe02c2548d34facec52dfef7e619d47e802f0c260311b9dcdd7b86e4deee53cad',sourceFile:'contracts/research_receipt_source_probe.py',sourceSha256:'54e47ed1ebd4c92832723e242dc86acf5d665a0b46a1b0bdc1611ca5d5b47a5d',proofFile:'docs/evidence/source-only-probe-independent.json'},
  {kind:'inline-source-probe',contractAddress:'0xf8a4Ac4A0CdD72841513b536fed4690D14c18670',deploymentHash:'0xccbd92b3e0dc0787d2c528de8188b0c1ef0f4eebabfe24ec98a837be8c638ac2',sourceFile:'contracts/research_receipt_inline_probe.py',sourceSha256:'ded346ad9d6b8f454401074b95b246e25526075cc809122726165ecf8d2ad75c',proofFile:'docs/evidence/inline-source-probe-independent.json'},
]);

export function validateAuxiliaryProof(profile, proof) {
  try {
    const block=proof.blockEvidence, readback=proof.readback;
    return proof.fullyVerified===true && proof.status==='FINALIZED' && proof.finalized===true && proof.consensusAccepted===true && proof.consensusOutcome==='accepted' && proof.execution==='FINISHED_WITH_RETURN' && proof.executionSuccessful===true && proof.senderVerified===true && validAddress(proof.actorAddress) && proof.operationVerified===true && proof.addressConsistent===true && sameAddress(proof.contractAddress,profile.contractAddress) && proof.protocolTxId?.toLowerCase()===profile.deploymentHash.toLowerCase() && proof.sourceVerification?.verified===true && proof.sourceVerification.sourceSha256===profile.sourceSha256 && block?.verified===true && block.protocolTxId?.toLowerCase()===profile.deploymentHash.toLowerCase() && validHash(block.envelopeHash) && validHash(block.blockHash) && /^\d+$/.test(String(block.blockNumber)) && Number.isInteger(block.logIndex) && block.logIndex>=0 && ['NewTransaction','CreatedTransaction'].includes(block.event) && readback?.verified===true && readback.observed===true && readback.variant==='latest-final' && sameAddress(readback.address,profile.contractAddress) && readback.method==='get_receipt' && canonical(jsonValue(readback.value))===canonical(jsonValue(readback.expected)) && proof.inputVerification?.verified===true && proof.inputVerification.leaderOnly===false && (profile.kind!=='inline-source-probe'||proof.fullReceiptMatch===true);
  } catch { return false; }
}
export function auxiliaryFreshMatches(profile,proof,deployment,fresh) {
  try {
    return validateAuxiliaryProof({...profile,kind:profile.diagnosticKind||profile.kind},proof)&&deployment?.identityAndInclusionVerified===true&&deployment.consensusAccepted===true&&deployment.execution==='FINISHED_WITH_RETURN'&&sameAddress(deployment.sender,proof.actorAddress)&&sameAddress(deployment.recipient,profile.contractAddress)&&deployment.sourceSha256===profile.sourceSha256&&['envelopeHash','blockHash','blockNumber','event','logIndex'].every(key=>String(deployment.inclusion?.[key]).toLowerCase()===String(proof.blockEvidence[key]).toLowerCase())&&canonical(jsonValue(fresh))===canonical(jsonValue(proof.readback.expected));
  }catch{return false;}
}

export function releaseAssignments(config) {
  const result = new Map();
  const assign = (hash, profile) => {
    const key = hash.toLowerCase(); const previous = result.get(key);
    if (previous && previous.profileId !== profile.profileId) throw new Error('A protocol transaction cannot belong to multiple release profiles.');
    result.set(key, profile);
  };
  const main = { ...config.mainRelease, profileId: 'main', kind: 'main' };
  const selected = new Set(Object.values(config.caseHashes).map(hash => hash.toLowerCase()));
  if (main.priorSuiteHashes.some(hash => selected.has(hash.toLowerCase()))) throw new Error('A prior-suite operation cannot satisfy a selected required case.');
  config.historicalReleases.forEach((release, index) => {
    const profile = { ...release, profileId: `historical-${index + 1}`, kind: 'historical' };
    for (const hash of [profile.deploymentHash, ...profile.caseHashes]) assign(hash, profile);
  });
  for (const release of config.auxiliaryDeployments || []) assign(release.deploymentHash, { ...release, diagnosticKind:release.kind, profileId:`auxiliary-${release.kind}`, kind:'auxiliary' });
  for (const hash of [main.deploymentHash, ...main.priorSuiteHashes, ...Object.values(config.caseHashes)]) assign(hash, main);
  for (const diagnostic of config.diagnosticAttempts) {
    const known = result.get(diagnostic.hash.toLowerCase());
    if (diagnostic.releaseAddress && known && !sameAddress(diagnostic.releaseAddress, known.contractAddress)) throw new Error('Diagnostic release address conflicts with its transaction profile.');
    if (!known) {
      if (diagnostic.releaseAddress && !sameAddress(diagnostic.releaseAddress, main.contractAddress)) throw new Error('Historical diagnostic hashes must be explicitly included in their historical release.');
      assign(diagnostic.hash, main);
    }
  }
  return result;
}

export function validateExpectations(value) {
  if (!value || value.format !== 'research-receipt/bradbury-expectations/1' || !value.caseHashes || typeof value.caseHashes !== 'object') throw new Error('Expected a Bradbury expectations/1 object with explicit caseHashes.');
  const policyVersion = value.policyVersion || 'research-receipt/2';
  if (!['research-receipt/1','research-receipt/2','research-receipt/3','research-receipt/4','research-receipt/5'].includes(policyVersion)) throw new Error('Unsupported release policyVersion.');
  if (dualPolicy({policyVersion}) && (!value.fixtureFile || typeof value.validationPlanFile !== 'string' || !value.validationPlanFile.endsWith('.json') || !/^[0-9a-f]{64}$/.test(value.validationPlanSha256 || ''))) throw new Error('V3/V4 requires a frozen reviewed fixture and exact validation-plan commitment.');
  if (!dualPolicy({policyVersion}) && ['createStrictUnknownOrder','submitStrictUnknown','evaluateStrictUnknown'].some(name=>Object.hasOwn(value.caseHashes,name))) throw new Error('Strict-unknown cases require the V3 policy profile or V4.');
  if(!boundPolicy({policyVersion})&&Object.hasOwn(value.caseHashes,'unboundReportBody'))throw new Error('Unbound-report case requires the V4 policy profile or V5.');
  if(policyVersion!=='research-receipt/5'&&[...STAGED_CASES].some(name=>Object.hasOwn(value.caseHashes,name)))throw new Error('Evidence snapshot cases require the V5 policy profile.');
  for (const [name, hash] of Object.entries(value.caseHashes)) if (!Object.hasOwn(CASES, name) || !validHash(hash)) throw new Error(`Unknown case or invalid protocol ID: ${name}`);
  const hashes = Object.values(value.caseHashes).map(item => item.toLowerCase());
  if (new Set(hashes).size !== hashes.length) throw new Error('Each case must have a distinct protocol transaction ID.');
  if ((value.fixtureFile != null || value.fixtureSha256 != null) && (typeof value.fixtureFile !== 'string' || !value.fixtureFile.endsWith('.json') || !/^[0-9a-f]{64}$/.test(value.fixtureSha256 || ''))) throw new Error('A reviewed fixture needs both a project JSON path and its exact SHA256.');
  if (value.scopeRevision != null && (typeof value.scopeRevision !== 'string' || value.scopeRevision.length > 2000)) throw new Error('Invalid scope-revision declaration.');
  const mainRelease = normalizeRelease(value.mainRelease || RELEASE, 'main');
  if (value.caseHashes.deployment && value.caseHashes.deployment.toLowerCase() !== mainRelease.deploymentHash.toLowerCase()) throw new Error('Wrong main release deployment protocol ID.');
  if (value.historicalReleases !== undefined && (!Array.isArray(value.historicalReleases) || value.historicalReleases.length > 5)) throw new Error('historicalReleases must be an explicit bounded list.');
  const historicalReleases = (value.historicalReleases || []).map((item, index) => {
    if (!Array.isArray(item?.caseHashes) || item.caseHashes.length > 100 || item.caseHashes.some(hash => !validHash(hash)) || new Set(item.caseHashes.map(hash => hash.toLowerCase())).size !== item.caseHashes.length) throw new Error('Historical releases need an explicit unique list of tracked transaction hashes.');
    return { ...normalizeRelease(item, `historical ${index + 1}`), caseHashes: [...item.caseHashes] };
  });
  if (value.auxiliaryDeployments!==undefined && (!Array.isArray(value.auxiliaryDeployments)||value.auxiliaryDeployments.length>2)) throw new Error('auxiliaryDeployments must be a bounded diagnostic list.');
  const auxiliaryDeployments=(value.auxiliaryDeployments||[]).map(item=>{
    const expected=AUXILIARY_RELEASES.find(row=>row.kind===item?.kind);
    if(!expected || !Object.keys(expected).every(key=>key==='contractAddress'?sameAddress(item[key],expected[key]):item[key]===expected[key]) || !/^[0-9a-f]{64}$/.test(item.proofSha256||''))throw new Error('Invalid auxiliary deployment identity or proof commitment.');
    return {...normalizeRelease(item,`auxiliary ${item.kind}`),kind:item.kind,proofFile:item.proofFile,proofSha256:item.proofSha256};
  });
  if(new Set(auxiliaryDeployments.map(item=>item.kind)).size!==auxiliaryDeployments.length)throw new Error('Auxiliary diagnostic kinds must be unique.');
  if(policyVersion==='research-receipt/5') {
    for(const retained of RETAINED_RELEASES) {
      const declared=historicalReleases.find(item=>sameAddress(item.contractAddress,retained.contractAddress));
      if(!declared || declared.sourceSha256!==retained.sourceSha256 || declared.deploymentHash!==retained.deploymentHash || !retained.hashes.every(hash=>declared.caseHashes.includes(hash)))throw new Error('V5 must retain all 21 historical V1/V2/V4 transactions under their original releases.');
      if(retained.sourceSha256.startsWith('f5a656')&&declared.sourceFile!=='contracts/archive/research_receipt_v4_f5a656.py')throw new Error('Historical V4 must use the frozen source archive.');
    }
    if(auxiliaryDeployments.length!==2)throw new Error('V5 must retain both auxiliary diagnostic deployments.');
  }
  if (new Set([mainRelease, ...historicalReleases,...auxiliaryDeployments].map(item => item.contractAddress.toLowerCase())).size !== historicalReleases.length + auxiliaryDeployments.length + 1) throw new Error('Release contract addresses must be distinct.');
  const idNames = dualPolicy({policyVersion}) ? ['correction','hashMismatch','unauthorized','strictUnknown'] : ['correction','hashMismatch','unauthorized'];
  const ids = value.orderIds || { correction: 1, hashMismatch: 2, unauthorized: 3 };
  if (Object.keys(ids).length !== idNames.length || idNames.some(key => !Number.isSafeInteger(ids[key]) || ids[key] < 1 || ids[key] > 1000000) || new Set(Object.values(ids)).size !== idNames.length) throw new Error('Distinct bounded order IDs are required for every selected policy case.');
  if(policyVersion==='research-receipt/5'&&(canonical(ids)!==canonical({correction:1,hashMismatch:2,unauthorized:3,strictUnknown:4})||(value.expectedOrderCount!==undefined&&value.expectedOrderCount!==4)))throw new Error('V5 requires its four prelocked order IDs and final order count.');
  if (value.expectedOrderCount !== undefined && (!Number.isSafeInteger(value.expectedOrderCount) || value.expectedOrderCount < 3 || value.expectedOrderCount > 10)) throw new Error('Expected order count must be between 3 and 10.');
  if (value.diagnosticAttempts !== undefined && (!Array.isArray(value.diagnosticAttempts) || value.diagnosticAttempts.length > 10)) throw new Error('diagnosticAttempts must be a bounded explicit list.');
  const diagnosticAttempts = (value.diagnosticAttempts || []).map(item => {
    const caseType = item?.caseType || item?.case?.replace(/^v[1-9][0-9]{0,2}-/, '');
    const observedOutcome = ['NO_MAJORITY', 'MAJORITY_DISAGREE'].includes(item?.observedOutcome) ? `FINALIZED_UNDETERMINED_${item.observedOutcome}` : item?.observedOutcome;
    if (!item || typeof item.case !== 'string' || !Object.hasOwn(CASES, caseType) || !Number.isSafeInteger(item.attempt) || item.attempt < 1 || item.attempt > 10 || !validHash(item.hash) || !['FINALIZED_UNDETERMINED_NO_MAJORITY', 'FINALIZED_UNDETERMINED_MAJORITY_DISAGREE'].includes(observedOutcome)) throw new Error('Invalid diagnostic attempt or unsupported declared outcome.');
    if ((item.stateObservation !== undefined && (typeof item.stateObservation !== 'string' || !item.stateObservation.trim() || item.stateObservation.length > 1200)) || typeof item.retryPolicy !== 'string' || !item.retryPolicy.trim() || item.retryPolicy.length > 1200) throw new Error('Diagnostic attempts need bounded optional state observations and explicit retry policies.');
    if (item.retryHash !== undefined && !validHash(item.retryHash)) throw new Error('Invalid diagnostic retry hash.');
    const observedExecution = item.observedExecution || null;
    if (observedExecution !== null && !['FINISHED_WITH_RETURN', 'FINISHED_WITH_ERROR'].includes(observedExecution)) throw new Error('Invalid diagnostic execution result.');
    if (item.releaseAddress !== undefined && !validAddress(item.releaseAddress)) throw new Error('Invalid diagnostic release address.');
    return { case: item.case, caseType, attempt: item.attempt, hash: item.hash, observedOutcome, observedExecution, stateObservation: item.stateObservation || null, retryPolicy: item.retryPolicy, ...(item.retryHash ? { retryHash: item.retryHash } : {}), ...(item.releaseAddress ? { releaseAddress: item.releaseAddress } : {}) };
  });
  if (new Set(diagnosticAttempts.map(item => item.hash.toLowerCase())).size !== diagnosticAttempts.length || new Set(diagnosticAttempts.map(item => `${item.case}:${item.attempt}`)).size !== diagnosticAttempts.length) throw new Error('Diagnostic hashes and case/attempt numbers must be unique.');
  if (value.retries !== undefined && (!Array.isArray(value.retries) || value.retries.length > 10)) throw new Error('retries must be a bounded explicit list.');
  const retries = (value.retries || []).map(item => {
    const previous = diagnosticAttempts.find(previous => previous.case === item?.case && previous.hash.toLowerCase() === item?.previousHash?.toLowerCase());
    if (!previous || !validHash(item.retryHash) || item.retryHash.toLowerCase() === previous.hash.toLowerCase() || item.attempt !== previous.attempt + 1) throw new Error('Each retry must link a declared diagnostic attempt to a distinct next attempt.');
    return { case: item.case, previousHash: item.previousHash, retryHash: item.retryHash, attempt: item.attempt };
  });
  if (new Set(retries.map(item => item.previousHash.toLowerCase())).size !== retries.length) throw new Error('A diagnostic attempt cannot declare multiple selected retries.');
  const config = { policyVersion, validationPlanFile:value.validationPlanFile || null,validationPlanSha256:value.validationPlanSha256 || null, suiteComplete: value.suiteComplete === true, caseHashes: { ...value.caseHashes }, mainRelease, historicalReleases, auxiliaryDeployments, diagnosticAttempts, retries, orderIds: ids, expectedOrderCount: value.expectedOrderCount ?? idNames.length, sessionFile: value.sessionFile || SESSION, fixtureFile: value.fixtureFile || null, fixtureSha256: value.fixtureSha256 || null, scopeRevision: value.scopeRevision || null };
  releaseAssignments(config); // Reject conflicting profile claims before any network access.
  return config;
}

function callDetails(tx) {
  const decoded = tx.txDataDecoded;
  const call = decoded?.type === 'call' ? decoded.callData : null;
  const args = field(call, 'args') || [];
  return { method: field(call, ''), args: Array.isArray(args) ? args : [] };
}
const numberArg = value => typeof value === 'bigint' ? Number(value) : value;
function summarizeArgs(args) {
  return args.map(value => typeof value === 'string' ? { type: 'string', utf8Bytes: Buffer.byteLength(value), sha256: sha(value) } : ['number', 'bigint', 'boolean'].includes(typeof value) ? { type: typeof value, value: typeof value === 'bigint' ? value.toString() : value } : { type: 'unsupported', excluded: true });
}
function allTrue(values) { return Object.values(values).every(value => value === true); }

export function requiredCaseChecks(config, transactions) {
  const diagnosticHashes = new Set(config.diagnosticAttempts.map(item => item.hash.toLowerCase()));
  const priorHashes = new Set(config.mainRelease.priorSuiteHashes.map(hash => hash.toLowerCase()));
  return Object.fromEntries(requiredCases(config).map(([name, [method]]) => {
    const selected = config.caseHashes[name]?.toLowerCase();
    const tx = transactions.find(item => item.protocolTxId.toLowerCase() === selected);
    return [name, !!tx && !diagnosticHashes.has(selected) && !priorHashes.has(selected) && tx.caseId === name && tx.operation === method && tx.verified === true];
  }));
}
export { validateEvidenceSnapshot as validateCollectedSnapshot };
export function snapshotPlanMatches(config,orders,plan) {
  try {
    const expected=[['negative',config.orderIds.correction,1],['positive',config.orderIds.correction,2],['hashMismatch',config.orderIds.hashMismatch,1],['strictUnknown',config.orderIds.strictUnknown,1]];
    return Array.isArray(plan?.expectedSnapshots)&&plan.expectedSnapshots.length===4&&expected.every(([id,orderId,revision])=>{
      const matches=plan.expectedSnapshots.filter(item=>item.id===id), snapshot=orders.find(item=>item.order.id===orderId)?.revisions[revision-1]?.snapshot;
      if(matches.length!==1||!snapshot)return false;
      const row=matches[0];
      return row.orderId===orderId&&row.revision===revision&&row.snapshotHash===snapshot.snapshot_hash&&canonical(row.binding)===canonical(snapshot.binding)&&canonical(row.sourceChecks)===canonical(snapshot.source_checks)&&canonical(row.materialByteLengths)===canonical(snapshot.materials.map(item=>item===null?null:Buffer.byteLength(item,'utf8')));
    });
  }catch{return false;}
}
export function evidenceStageChecks(config, orders, transactions, rawTransactions) {
  const row=name=>transactions.find(item=>item.protocolTxId.toLowerCase()===config.caseHashes[name]?.toLowerCase());
  const args=name=>callDetails(rawTransactions.get(config.caseHashes[name]?.toLowerCase())||{}).args.map(numberArg);
  const matches=(name,expected)=>canonical(args(name))===canonical(expected);
  const after=(name,earlier)=>{
    const a=row(name)?.inclusion,b=row(earlier)?.inclusion;
    try{return !!a?.verified&&!!b?.verified&&(BigInt(a.blockNumber)>BigInt(b.blockNumber)||(a.blockNumber===b.blockNumber&&a.logIndex>b.logIndex));}catch{return false;}
  };
  const authorized=(name,id)=>{
    const order=orders.find(item=>item.order.id===id)?.order;
    return !!order&&(sameAddress(row(name)?.sender,order.owner)||sameAddress(row(name)?.sender,order.spec.author));
  };
  const stages=[
    ['verifyContradictedEvidence','submitContradicted','evaluateContradicted',config.orderIds.correction,1],
    ['verifyCorrectedEvidence','submitCorrected','evaluateCorrected',config.orderIds.correction,2],
    ['verifyHashMismatchEvidence','submitHashMismatch','evaluateHashMismatch',config.orderIds.hashMismatch,1],
    ['verifyStrictUnknownEvidence','submitStrictUnknown','evaluateStrictUnknown',config.orderIds.strictUnknown,1],
  ];
  const snapshots=orders.flatMap(item=>item.revisions);
  return {
    allRevisionSnapshotsAndAssessmentsBound:snapshots.length===4&&snapshots.every(item=>!!item.snapshot&&!!item.snapshotValidation&&!!item.assessment&&item.snapshotValidation.snapshotHash===item.snapshot.snapshot_hash&&item.assessment.snapshot_hash===item.snapshot.snapshot_hash&&canonicalEvidenceJson(item.assessment.source_checks)===canonicalEvidenceJson(item.snapshot.source_checks)),
    evidenceVerificationPrecedesEveryAssessment:stages.every(([verify,submit,evaluate,id,revision])=>row(verify)?.verified===true&&row(verify).execution==='FINISHED_WITH_RETURN'&&matches(verify,[id,revision])&&authorized(verify,id)&&after(verify,submit)&&after(evaluate,verify)),
    evaluateBeforeEvidenceRejectedWithoutStateChange:row('evaluateBeforeEvidence')?.verified===true&&row('evaluateBeforeEvidence').execution==='FINISHED_WITH_ERROR'&&matches('evaluateBeforeEvidence',[config.orderIds.correction,1])&&authorized('evaluateBeforeEvidence',config.orderIds.correction)&&after('evaluateBeforeEvidence','submitContradicted')&&after('verifyContradictedEvidence','evaluateBeforeEvidence'),
    duplicateEvidenceSnapshotRejectedWithoutStateChange:row('duplicateEvidenceSnapshot')?.verified===true&&row('duplicateEvidenceSnapshot').execution==='FINISHED_WITH_ERROR'&&matches('duplicateEvidenceSnapshot',[config.orderIds.correction,1])&&authorized('duplicateEvidenceSnapshot',config.orderIds.correction)&&after('duplicateEvidenceSnapshot','verifyContradictedEvidence')&&after('evaluateContradicted','duplicateEvidenceSnapshot'),
  };
}
export function attemptAccounting(config, transactions, tracked, rawTransactions) {
  const assignments = releaseAssignments(config);
  const diagnosticHashes = new Set(config.diagnosticAttempts.map(item => item.hash.toLowerCase()));
  const priorHashes = new Set(config.mainRelease.priorSuiteHashes.map(hash => hash.toLowerCase()));
  const txFor = hash => transactions.find(item => item.protocolTxId.toLowerCase() === hash?.toLowerCase());
  const undeclared = tracked.filter(item => !assignments.has(item.hash.toLowerCase())).map(item => item.hash);
  const trackedHashes = new Set(tracked.map(item => item.hash.toLowerCase()));
  const missingHistorical = [...new Set(config.historicalReleases.flatMap(item => [item.deploymentHash, ...item.caseHashes]))].filter(hash => !trackedHashes.has(hash.toLowerCase()));
  const missingPrior = config.mainRelease.priorSuiteHashes.filter(hash => !trackedHashes.has(hash.toLowerCase()));
  const missingAuxiliary = (config.auxiliaryDeployments||[]).map(item=>item.deploymentHash).filter(hash=>!trackedHashes.has(hash.toLowerCase()));
  const diagnosticAttempts = config.diagnosticAttempts.map(item => {
    const tx = txFor(item.hash);
    const raw = rawTransactions.get(item.hash.toLowerCase());
    const profile = assignments.get(item.hash.toLowerCase());
    const archivedSuite = profile?.kind === 'historical' ? 'historical-release' : priorHashes.has(item.hash.toLowerCase()) ? 'prior-main-suite' : null;
    const selectedHash = config.caseHashes[item.caseType];
    const explicit = config.retries.find(retry => retry.case === item.case && retry.previousHash.toLowerCase() === item.hash.toLowerCase());
    const nextDiagnostic = config.diagnosticAttempts.find(next => next.case === item.case && next.attempt === item.attempt + 1 && assignments.get(next.hash.toLowerCase())?.profileId === profile?.profileId);
    const selectedSameProfile = !archivedSuite && selectedHash && assignments.get(selectedHash.toLowerCase())?.profileId === profile?.profileId && selectedHash.toLowerCase() !== item.hash.toLowerCase();
    const retryHash = item.retryHash || explicit?.retryHash || nextDiagnostic?.hash || (selectedSameProfile ? selectedHash : null);
    const retry = txFor(retryHash);
    const retryRaw = retryHash ? rawTransactions.get(retryHash.toLowerCase()) : null;
    const originalCall = callDetails(raw || {}); const retryCall = callDetails(retryRaw || {});
    const methodMatches = tx?.operation === CASES[item.caseType][0] && originalCall.method === CASES[item.caseType][0];
    const actualOutcomeName = raw?.resultName || ([2, '2', 2n].includes(raw?.result) ? 'MAJORITY_DISAGREE' : [5, '5', 5n].includes(raw?.result) ? 'NO_MAJORITY' : null);
    const recordVerified = !!tx?.identityAndInclusionVerified && finalizedUndetermined(raw) && item.observedOutcome === `FINALIZED_UNDETERMINED_${actualOutcomeName}` && ['FINISHED_WITH_RETURN', 'FINISHED_WITH_ERROR'].includes(tx.execution) && (!item.observedExecution || tx.execution === item.observedExecution) && methodMatches;
    const sameCallAndActor = !!retry && sameAddress(tx?.sender, retry.sender) && sameAddress(tx?.recipient, retry.recipient) && originalCall.method === retryCall.method && canonical(originalCall.args.map(numberArg)) === canonical(retryCall.args.map(numberArg));
    const originalPosition = tx?.inclusion; const retryPosition = retry?.inclusion;
    const ordered = !!originalPosition?.verified && !!retryPosition?.verified && (BigInt(retryPosition.blockNumber) > BigInt(originalPosition.blockNumber) || (retryPosition.blockNumber === originalPosition.blockNumber && retryPosition.logIndex > originalPosition.logIndex));
    const explicitLinksAgree = (!item.retryHash || !explicit || item.retryHash.toLowerCase() === explicit.retryHash.toLowerCase());
    const sameRelease = retryHash && assignments.get(retryHash.toLowerCase())?.profileId === profile?.profileId;
    const allowedRetryRole = !!archivedSuite || (retryHash?.toLowerCase() === selectedHash?.toLowerCase() && !diagnosticHashes.has(retryHash?.toLowerCase()));
    const linkedRetryVerified = !!retry?.identityAndInclusionVerified && !!retryHash && sameRelease && allowedRetryRole && sameCallAndActor && ordered && explicitLinksAgree;
    return { caseId: item.case, caseType: item.caseType, archivedSuite, attempt: item.attempt, protocolTxId: item.hash, releaseProfile: profile?.profileId || null, releaseContractAddress: profile?.contractAddress || null, releaseSourceSha256: profile?.sourceSha256 || null, declaredOutcome: item.observedOutcome, expectedExecution: item.observedExecution, declaredPreRetryStateObservation: item.stateObservation, declaredRetryPolicy: item.retryPolicy, stateObservationIndependentlyReplayed: false, observedStatus: tx?.status || null, observedExecution: tx?.execution || null, observedConsensusOutcome: tx?.consensusOutcome || null, observedConsensusResult: tx?.consensusResult || null, observedConsensusResultCode: tx?.consensusResultCode || null, inclusion: tx?.inclusion || null, recordVerified, retryProtocolTxId: retryHash || null, retryLinkSource: item.retryHash ? 'diagnostic-entry' : explicit ? 'explicit-retries' : nextDiagnostic ? 'next-declared-diagnostic-attempt' : retryHash ? 'selected-required-case' : 'none-declared', sameCallAndActor, retrySubmittedAfterOriginalInclusion: ordered, linkedRetryVerified: retryHash ? linkedRetryVerified : null };
  });
  const historicalTransactions = transactions.filter(item => assignments.get(item.protocolTxId.toLowerCase())?.kind === 'historical');
  const priorTransactions = transactions.filter(item => priorHashes.has(item.protocolTxId.toLowerCase()));
  const allUndeterminedAttemptsDeclared = transactions.every(item => !finalizedUndetermined(rawTransactions.get(item.protocolTxId.toLowerCase())) || diagnosticHashes.has(item.protocolTxId.toLowerCase()));
  const allHistoricalRecordsVerified = missingHistorical.length === 0 && historicalTransactions.every(item => item.identityAndInclusionVerified === true && (item.consensusAccepted === true || diagnosticAttempts.some(diagnostic => diagnostic.protocolTxId.toLowerCase() === item.protocolTxId.toLowerCase() && diagnostic.recordVerified)));
  const allPriorMainSuiteRecordsVerified = missingPrior.length === 0 && priorTransactions.every(item => item.identityAndInclusionVerified === true && (item.consensusAccepted === true || diagnosticAttempts.some(diagnostic => diagnostic.protocolTxId.toLowerCase() === item.protocolTxId.toLowerCase() && diagnostic.recordVerified)));
  const allAuxiliaryRecordsVerified=missingAuxiliary.length===0 && (config.auxiliaryDeployments||[]).every(profile=>{
    const tx=txFor(profile.deploymentHash);
    return tx?.releaseKind==='auxiliary'&&tx.operation==='deploy'&&tx.identityAndInclusionVerified===true&&tx.consensusAccepted===true&&tx.execution==='FINISHED_WITH_RETURN';
  });
  return { diagnosticAttempts, undeclaredTrackedTransactions: undeclared,
    allTrackedTransactionsDeclared: undeclared.length === 0,
    allDeclaredDiagnosticAttemptsVerified: diagnosticAttempts.every(item => item.recordVerified && (!item.retryProtocolTxId || item.linkedRetryVerified)),
    allUndeterminedAttemptsDeclared, allHistoricalRecordsVerified, allPriorMainSuiteRecordsVerified, allAuxiliaryRecordsVerified, missingDeclaredAuxiliaryTransactions:missingAuxiliary, missingDeclaredHistoricalTransactions: missingHistorical, missingDeclaredPriorSuiteTransactions: missingPrior,
    allAttemptsConsensusAccepted: transactions.length === tracked.length && transactions.every(item => item.consensusAccepted === true),
    everyTrackedAttemptFinalAndIncluded: transactions.length === tracked.length && transactions.every(item => item.identityAndInclusionVerified === true),
    attemptStatistics: { trackedTotal: tracked.length, collectedTotal: transactions.length, requiredCasesSelected: Object.keys(config.caseHashes).length, requiredCasesExpected: requiredCases(config).length, diagnosticAttemptsDeclared: diagnosticAttempts.length, diagnosticAttemptRecordsVerified: diagnosticAttempts.filter(item => item.recordVerified).length, diagnosticRetryLinksVerified: diagnosticAttempts.filter(item => item.linkedRetryVerified).length, undeclaredTrackedAttempts: undeclared.length, consensusAcceptedAttempts: transactions.filter(item => item.consensusAccepted).length, finalizedUndeterminedAttempts: transactions.filter(item => item.finalized && item.consensusOutcome === 'undetermined' && ['NO_MAJORITY', 'MAJORITY_DISAGREE'].includes(item.consensusResult)).length, noMajorityAttempts: transactions.filter(item => item.finalized && item.consensusOutcome === 'undetermined' && item.consensusResult === 'NO_MAJORITY').length, majorityDisagreeAttempts: transactions.filter(item => item.finalized && item.consensusOutcome === 'undetermined' && item.consensusResult === 'MAJORITY_DISAGREE').length, acceptedExecutionReturns: transactions.filter(item => item.consensusAccepted && item.execution === 'FINISHED_WITH_RETURN').length, acceptedExecutionErrors: transactions.filter(item => item.consensusAccepted && item.execution === 'FINISHED_WITH_ERROR').length } };
}

export async function collect(expectations, dependencies = {}) {
  const config = validateExpectations(expectations);
  let lockedFixture = null;
  if (config.fixtureFile) {
    const bytes = await readFile(await projectFile(config.fixtureFile, '.json'));
    if (sha(bytes) !== config.fixtureSha256) throw new Error('Reviewed fixture changed since its declared fingerprint.');
    lockedFixture = JSON.parse(bytes.toString('utf8'));
  }
  let lockedPlan = null;
  if (dualPolicy(config)) {
    const bytes = await readFile(await projectFile(config.validationPlanFile,'.json'));
    if (sha(bytes) !== config.validationPlanSha256) throw new Error('Prelocked validation plan changed.');
    lockedPlan=JSON.parse(bytes.toString('utf8'));
    if (lockedPlan.policyVersion !== config.policyVersion || lockedPlan.fixtureSha256 !== config.fixtureSha256 || (lockedPlan.sourceCommitment?.sha256 || lockedPlan.sourceCommitment) !== config.mainRelease.sourceSha256 || !['positive','negative','strictUnknown','hashMismatch'].every(id=>lockedPlan.expected?.filter(item=>item.id===id).length===1)) throw new Error('Validation plan does not bind the selected source, fixture and required policies.');
    if(config.policyVersion==='research-receipt/5'&&(!Array.isArray(lockedPlan.expectedSnapshots)||lockedPlan.expectedSnapshots.length!==4||!['positive','negative','strictUnknown','hashMismatch'].every(id=>lockedPlan.expectedSnapshots.filter(item=>item.id===id).length===1)))throw new Error('V5 requires four prelocked exact snapshot expectations.');
  }
  const session = JSON.parse(await readFile(await projectFile(config.sessionFile, '.json'), 'utf8'));
  if (['owner', 'author', 'outsider'].some(role => !validAddress(session.actors?.[role]))) throw new Error('Session must contain three public independent actor addresses.');
  const profiles = [{ ...config.mainRelease, profileId: 'main', kind: 'main' }, ...config.historicalReleases.map((item, index) => ({ ...item, profileId: `historical-${index + 1}`, kind: 'historical' })), ...config.auxiliaryDeployments.map(item=>({...item,diagnosticKind:item.kind,profileId:`auxiliary-${item.kind}`,kind:'auxiliary'}))];
  const assignments = releaseAssignments(config);
  const localSourceProofs = new Map();
  const auxiliaryProofs = new Map();
  for (const profile of profiles) {
    const sourceFile = profile.sourceFile || (profile.kind === 'main' ? 'contracts/research_receipt.py' : null);
    if (sourceFile) {
      const source = await contractSource(sourceFile);
      if (source.sourceSha256 !== profile.sourceSha256) throw new Error(`Local source differs from the declared ${profile.profileId} release.`);
      if (profile.kind === 'main') {
        const sourcePolicy=source.code.match(/POLICY_VERSION = "(research-receipt\/[345])"/)?.[1];
        if(sourcePolicy&&config.policyVersion!==sourcePolicy)throw new Error('Business source requires its exact collector policy and prelocked plan.');
      }
      localSourceProofs.set(profile.profileId, { sourceFile, sourceSha256: source.sourceSha256 });
    }
    if(profile.kind==='auxiliary') {
      const bytes=await readFile(await projectFile(profile.proofFile,'.json'));
      if(sha(bytes)!==profile.proofSha256)throw new Error('Auxiliary independent proof fingerprint changed.');
      const proof=JSON.parse(bytes.toString('utf8'));
      if(!validateAuxiliaryProof({...profile,kind:profile.diagnosticKind},proof))throw new Error('Auxiliary independent proof identity, finality or full readback failed.');
      auxiliaryProofs.set(profile.profileId,proof);
    }
  }
  const connection = dependencies.connection || await connectBradbury();
  const inclusion = dependencies.inclusion || protocolInclusion;
  const rawTransactions = new Map();
  const transactions = [];
  const errors = [];
  const caseForHash = new Map(Object.entries(config.caseHashes).map(([id, hash]) => [hash.toLowerCase(), id]));
  const diagnosticForHash = new Map(config.diagnosticAttempts.map(item => [item.hash.toLowerCase(), item]));
  const priorHashes = new Set(config.mainRelease.priorSuiteHashes.map(hash => hash.toLowerCase()));
  const tracked = array(session.transactions);
  if (!tracked.length || new Set(tracked.map(item => item.hash?.toLowerCase())).size !== tracked.length) throw new Error('Session transactions are missing or duplicate.');
  for (const operation of tracked) {
    if (!validHash(operation.hash) || !['owner', 'author', 'outsider'].includes(operation.role) || !['deploy', 'create_order', 'submit_revision', 'verify_evidence', 'evaluate'].includes(operation.operation)) throw new Error('Malformed tracked transaction or unknown independent actor.');
    const id = caseForHash.get(operation.hash.toLowerCase());
    const diagnostic = diagnosticForHash.get(operation.hash.toLowerCase());
    const profile = assignments.get(operation.hash.toLowerCase());
    const priorSuite = priorHashes.has(operation.hash.toLowerCase());
    try {
      const tx = await connection.client.getTransaction({ hash: operation.hash });
      rawTransactions.set(operation.hash.toLowerCase(), tx);
      const call = callDetails(tx);
      const isDeploy = operation.operation === 'deploy';
      const deployedSourceSha256 = isDeploy && typeof tx.txDataDecoded?.code === 'string' ? sha(tx.txDataDecoded.code) : null;
      const sourceVerified = isDeploy ? !!profile && tx.txDataDecoded?.type === 'deploy' && deployedSourceSha256 === profile.sourceSha256 : !!profile;
      const senderVerified = sameAddress(tx.sender, session.actors[operation.role]);
      const recipientVerified = !!profile && sameAddress(tx.recipient, profile.contractAddress) && (!isDeploy || sameAddress(tx.txDataDecoded?.contractAddress, profile.contractAddress));
      const methodVerified = isDeploy ? tx.txDataDecoded?.type === 'deploy' : call.method === operation.operation;
      const blockEvidence = await inclusion(connection, operation.hash, operation.submittedAfterBlock ?? session.snapshotBlock);
      const expectedExecution = id ? (CASES[id][1] ? 'FINISHED_WITH_ERROR' : 'FINISHED_WITH_RETURN') : null;
      const final = tx.statusName === 'FINALIZED';
      const consensusAccepted = protocolAccepted(tx);
      const identityAndInclusionVerified = final && senderVerified && recipientVerified && methodVerified && sourceVerified && blockEvidence.verified === true;
      transactions.push({ protocolTxId: operation.hash, caseId: id || null, releaseProfile: profile?.profileId || null, releaseKind: profile?.kind || null, releaseContractAddress: profile?.contractAddress || null, releaseSourceSha256: profile?.sourceSha256 || null, classification: id && diagnostic ? 'required-diagnostic-conflict' : id ? 'required-case' : priorSuite ? (diagnostic ? 'prior-main-diagnostic-attempt' : 'prior-main-suite-transaction') : profile?.kind === 'historical' ? (diagnostic ? 'historical-diagnostic-attempt' : 'historical-transaction') : profile?.kind === 'auxiliary' ? 'auxiliary-diagnostic-deployment' : diagnostic ? 'diagnostic-attempt' : 'undeclared', diagnosticCaseId: diagnostic?.case || null, diagnosticAttempt: diagnostic?.attempt || null, operation: operation.operation, role: operation.role, sender: validAddress(tx.sender) ? tx.sender : null, recipient: validAddress(tx.recipient) ? tx.recipient : null, submittedAt: typeof operation.submittedAt === 'string' ? operation.submittedAt : null, status: typeof tx.statusName === 'string' ? tx.statusName : null, execution: typeof tx.txExecutionResultName === 'string' ? tx.txExecutionResultName : null, consensusOutcome: typeof tx.lifecycle?.outcome === 'string' ? tx.lifecycle.outcome : null, consensusResult: typeof tx.resultName === 'string' ? tx.resultName : null, consensusResultCode: ['number', 'string', 'bigint'].includes(typeof tx.result) ? String(tx.result) : null, expectedExecution, finalized: final, consensusAccepted, senderVerified, recipientVerified, methodVerified, sourceVerified, identityAndInclusionVerified, ...(id && CASES[id][1] ? { failureEvidence: { strength: 'Verified call inputs, execution error and latest-final state invariants; exact VM revert reason is not decoded.', vmRevertReasonDecoded: false } } : {}), ...(isDeploy ? { sourceSha256: deployedSourceSha256 } : { argumentCommitments: summarizeArgs(call.args) }), inclusion: blockEvidence, verified: identityAndInclusionVerified && consensusAccepted && (!expectedExecution || tx.txExecutionResultName === expectedExecution) });
    } catch (error) { errors.push({ operation: operation.operation, protocolTxId: operation.hash, error: safeError(error) }); }
  }
  const releaseProofs = profiles.map(profile => {
    const deployment = transactions.find(item => item.protocolTxId.toLowerCase() === profile.deploymentHash.toLowerCase());
    return { profileId: profile.profileId, kind: profile.kind, contractAddress: profile.contractAddress, sourceSha256: profile.sourceSha256, deploymentHash: profile.deploymentHash, localSource: localSourceProofs.get(profile.profileId) || null, actualDeploymentSourceSha256: deployment?.sourceSha256 || null, deploymentFinalized: deployment?.finalized === true, deploymentConsensusAccepted: deployment?.consensusAccepted === true, deploymentExecution: deployment?.execution || null, inclusion: deployment?.inclusion || null, verified: deployment?.verified === true && deployment?.operation === 'deploy' && deployment?.execution === 'FINISHED_WITH_RETURN' && deployment?.sourceSha256 === profile.sourceSha256 };
  });
  const auxiliaryDeployments=[];
  for(const profile of profiles.filter(item=>item.kind==='auxiliary')) {
    const proof=auxiliaryProofs.get(profile.profileId), deployment=transactions.find(item=>item.protocolTxId.toLowerCase()===profile.deploymentHash.toLowerCase());
    let readbackMatches=false, proofMatchesFresh=false;
    try {
      const fresh=jsonValue(await connection.client.readContract({address:profile.contractAddress,functionName:'get_receipt',args:[],transactionHashVariant:'latest-final'}));
      readbackMatches=canonical(fresh)===canonical(jsonValue(proof.readback.expected));
      proofMatchesFresh=auxiliaryFreshMatches(profile,proof,deployment,fresh);
    } catch(error) {errors.push({operation:'auxiliary latest-final readback',protocolTxId:profile.deploymentHash,error:safeError(error)});}
    const verified=releaseProofs.find(item=>item.profileId===profile.profileId)?.verified===true&&readbackMatches&&proofMatchesFresh;
    auxiliaryDeployments.push({kind:profile.diagnosticKind,contractAddress:profile.contractAddress,deploymentHash:profile.deploymentHash,sourceFile:profile.sourceFile,sourceSha256:profile.sourceSha256,proofFile:profile.proofFile,proofSha256:profile.proofSha256,readbackMatchesIndependentProof:readbackMatches,identityAndInclusionMatchesIndependentProof:proofMatchesFresh,verified,scope:'Auxiliary isolation diagnostic, never a business acceptance case.'});
    if(!verified)releaseProofs.find(item=>item.profileId===profile.profileId).verified=false;
  }
  for (const transaction of transactions) {
    transaction.releaseSourceVerified = releaseProofs.find(item => item.profileId === assignments.get(transaction.protocolTxId.toLowerCase())?.profileId)?.verified === true;
    transaction.identityAndInclusionVerified = transaction.identityAndInclusionVerified && transaction.releaseSourceVerified;
    transaction.verified = transaction.verified && transaction.releaseSourceVerified;
  }
  const reads = [];
  const read = async (method, args = []) => {
    const value = jsonValue(await connection.client.readContract({ address: config.mainRelease.contractAddress, functionName: method, args, transactionHashVariant: 'latest-final' }));
    reads.push({ method, args, variant: 'latest-final', observed: true });
    return value;
  };
  const orders = [];
  let orderCount = null;
  try {
    orderCount = await read('get_order_count');
    if (!Number.isSafeInteger(orderCount) || orderCount < 0 || orderCount > 1000000) { orderCount = null; throw new Error('Malformed final-state order count.'); }
    for (const id of Object.values(config.orderIds)) {
      const order = await read('get_order', [id]);
      if (order.id !== id || !Number.isInteger(order.revision_count) || order.revision_count < 0 || order.revision_count > 5 || typeof order.spec?.client_ref !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(order.spec.client_ref)) throw new Error(`Malformed on-chain order ${id}`);
      const mappedOrderId = await read('get_order_id', [order.spec.client_ref]);
      if (!Number.isSafeInteger(mappedOrderId) || mappedOrderId < 0 || mappedOrderId > 1000000) throw new Error('Malformed client reference mapping.');
      const revisions = [];
      for (let revision = 1; revision <= order.revision_count; revision++) {
        const rawRevision=await read('get_revision',[id,revision]), rawAssessment=await read('get_assessment',[id,revision]);
        let snapshot=null, snapshotValidation=null;
        if(config.policyVersion==='research-receipt/5') {
          snapshot=await read('get_evidence_snapshot',[id,revision]);
          if(!snapshot)throw new Error('Required policy-5 revision has no evidence snapshot.');
          snapshotValidation=await validateEvidenceSnapshot({snapshot,order,revision:rawRevision,expectedRevision:revision,assessment:rawAssessment||null});
        }
        revisions.push({submission:revisionView(rawRevision),assessment:assessmentView(rawAssessment),...(snapshot?{snapshot,snapshotValidation}: {})});
      }
      orders.push({ order: orderView(order), mappedOrderId, revisions });
    }
  } catch (error) { errors.push({ operation: 'latest-final state reads', error: safeError(error) }); }
  const byId = id => orders.find(item => item.order.id === id);
  const correction = byId(config.orderIds.correction);
  const mismatch = byId(config.orderIds.hashMismatch);
  const locked = byId(config.orderIds.unauthorized);
  const strict = byId(config.orderIds.strictUnknown);
  const isV3 = dualPolicy(config);
  const isV4 = boundPolicy(config), isV5=config.policyVersion==='research-receipt/5';
  const expectedOrderTotal = isV3 ? 4 : 3;
  const transactionFor = name => transactions.find(item => item.protocolTxId.toLowerCase() === config.caseHashes[name]?.toLowerCase());
  const rawFor = name => rawTransactions.get(config.caseHashes[name]?.toLowerCase());
  const argsFor = name => callDetails(rawFor(name) || {}).args;
  const argsMatch = (name, expected) => canonical(argsFor(name).map(numberArg)) === canonical(expected);
  const submittedMatches = (name, order, revision) => {
    try { const args = argsFor(name); return numberArg(args[0]) === order.order.id && sha(canonical(normalizeForPolicy(JSON.parse(args[1]),order.order.spec,config.policyVersion))) === order.revisions[revision - 1]?.submission.submission_hash; } catch { return false; }
  };
  const createsMatches = (name, order) => {
    try { const spec = JSON.parse(argsFor(name)[0]); return order.mappedOrderId === order.order.id && sha(canonical(normalizeSpec(spec)))===order.order.spec_hash && spec.client_ref === order.order.spec.client_ref && sameAddress(spec.author, order.order.spec.author) && sameAddress(rawFor(name)?.sender, order.order.owner); } catch { return false; }
  };
  let reviewedFixtureMatches = !lockedFixture;
  if (lockedFixture) {
    try {
      const submissionHash=key=>sha(canonical(normalizeForPolicy(lockedFixture[key],key==='missing'?lockedFixture.specMissing:lockedFixture.spec,config.policyVersion)));
      reviewedFixtureMatches = sha(canonical(normalizeSpec(lockedFixture.spec))) === correction?.order.spec_hash && sha(canonical(normalizeSpec(lockedFixture.specMissing))) === mismatch?.order.spec_hash && submissionHash('negative') === correction?.revisions[0]?.submission.submission_hash && submissionHash('positive') === correction?.revisions[1]?.submission.submission_hash && submissionHash('missing') === mismatch?.revisions[0]?.submission.submission_hash && (!isV3 || (sha(canonical(normalizeSpec(lockedFixture.specStrict))) === strict?.order.spec_hash && submissionHash('positive') === strict?.revisions[0]?.submission.submission_hash));
    } catch { reviewedFixtureMatches = false; }
  }
  let duplicateContentPreconditions = false;
  try {
    const args = argsFor('duplicateContent'); const submission = normalizeForPolicy(JSON.parse(args[1]),mismatch.order.spec,config.policyVersion);
    duplicateContentPreconditions = numberArg(args[0]) === mismatch.order.id && contentFingerprint(submission) === mismatch.revisions[0].submission.content_hash && !mismatch.revisions.some(item => item.submission.submission.report_version === submission.report_version) && sameAddress(rawFor('duplicateContent')?.sender, mismatch.order.spec.author);
  } catch { /* Missing cases cannot pass. */ }
  let unboundBodyPreconditions = false;
  if(isV4) {
    try {
      const args=argsFor('unboundReportBody'), submitted=JSON.parse(args[1]);
      const byId=new Map(submitted.claims.map(item=>[item.criterion_id,item]));
      const expectedBody=mismatch.order.spec.criteria.filter(row=>byId.has(row.id)).map(row=>byId.get(row.id).statement.trim()).join('\n');
      normalizeBoundSubmission({...submitted,report_body:expectedBody},mismatch.order.spec);
      const declared=lockedFixture.unboundBody;
      unboundBodyPreconditions=numberArg(args[0])===mismatch.order.id && submitted.report_body!==expectedBody && canonical({...submitted,report_version:declared.report_version})===canonical(declared) && !mismatch.revisions.some(item=>item.submission.submission.report_version===submitted.report_version) && sameAddress(rawFor('unboundReportBody')?.sender,mismatch.order.spec.author);
    } catch { /* Any missing precondition fails the negative-case proof. */ }
  }
  const caseChecks = requiredCaseChecks(config, transactions);
  const accounting = attemptAccounting(config, transactions, tracked, rawTransactions);
  const revisionIntegrity = orders.length === expectedOrderTotal && orders.every(({ order, mappedOrderId, revisions }) => mappedOrderId === order.id && revisions.every(({ submission, assessment }, index) => submission.order_id === order.id && submission.revision === index + 1 && sameAddress(submission.submitted_by, order.spec.author) && sha(canonical(submission.submission)) === submission.submission_hash && contentFingerprint(submission.submission) === submission.content_hash && submission.previous_submission_hash === (index ? revisions[index - 1].submission.submission_hash : '') && assessment?.submission_hash === submission.submission_hash && assessment?.content_hash === submission.content_hash && assessment?.spec_hash === order.spec_hash && assessment?.order_id === order.id && assessment?.revision === index + 1));
  const after = (name, earlier) => {
    const a = transactionFor(name)?.inclusion; const b = transactionFor(earlier)?.inclusion;
    return !!a?.verified && !!b?.verified && (BigInt(a.blockNumber) > BigInt(b.blockNumber) || (a.blockNumber === b.blockNumber && a.logIndex > b.logIndex));
  };
  const checks = {
    suiteExplicitlyComplete: config.suiteComplete,
    allRequiredCases: allTrue(caseChecks),
    everyTrackedAttemptFinalAndIncluded: accounting.everyTrackedAttemptFinalAndIncluded,
    allTrackedTransactionsDeclared: accounting.allTrackedTransactionsDeclared,
    allDeclaredDiagnosticAttemptsVerified: accounting.allDeclaredDiagnosticAttemptsVerified,
    allUndeterminedAttemptsDeclared: accounting.allUndeterminedAttemptsDeclared,
    allHistoricalRecordsVerified: accounting.allHistoricalRecordsVerified,
    allPriorMainSuiteRecordsVerified: accounting.allPriorMainSuiteRecordsVerified,
    allAuxiliaryDiagnosticRecordsVerified:accounting.allAuxiliaryRecordsVerified&&auxiliaryDeployments.every(item=>item.verified),
    allReleaseDeploymentSourcesVerified: releaseProofs.every(item => item.verified),
    deployedSourceMatchesRelease: transactionFor('deployment')?.sourceSha256 === config.mainRelease.sourceSha256,
    expectedFinalOrderCount: orderCount === config.expectedOrderCount,
    fourLockedCriteriaPreserved: orders.length === expectedOrderTotal && orders.every(({ order }) => canonical(order.spec.criteria.map(item => item.id)) === canonical(['permissions', 'withdrawals', 'audit', 'limitations']) && order.spec.criteria.every(item => item.required === true) && canonical(order.spec.criteria) === canonical(isV3 && order.id === config.orderIds.strictUnknown ? normalizeSpec(lockedFixture.specStrict).criteria : orders[0].order.spec.criteria)),
    reviewedFixtureMatchesMainCases: reviewedFixtureMatches,
    revisionAndAssessmentCommitments: revisionIntegrity,
    contradictionRejected: correction?.revisions[0]?.assessment?.verdict === 'NOT_ACCEPTED' && argsMatch('evaluateContradicted', [config.orderIds.correction, 1]),
    correctedRevisionAccepted: correction?.order.status === 'ACCEPTED' && correction?.order.revision_count === 2 && correction?.revisions[1]?.assessment?.verdict === 'ACCEPTED' && argsMatch('evaluateCorrected', [config.orderIds.correction, 2]),
    submissionsMatchChainCommitments: !!correction && !!mismatch && submittedMatches('submitContradicted', correction, 1) && submittedMatches('submitCorrected', correction, 2) && submittedMatches('submitHashMismatch', mismatch, 1) && (!isV3 || (!!strict && submittedMatches('submitStrictUnknown',strict,1))),
    ordersMatchSubmittedClientRefs: !!correction && !!mismatch && !!locked && createsMatches('createCorrectionOrder', correction) && createsMatches('createHashMismatchOrder', mismatch) && createsMatches('createAuthorLockedOrder', locked) && (!isV3 || (!!strict && createsMatches('createStrictUnknownOrder',strict))),
    hashMismatchFailsClosed: mismatch?.order.status === 'INSUFFICIENT_EVIDENCE' && mismatch?.revisions[0]?.assessment?.verdict === 'INSUFFICIENT_EVIDENCE' && mismatch?.revisions[0]?.assessment?.source_checks.some(item => item.status === 'HASH_MISMATCH') === true && argsMatch('evaluateHashMismatch', [config.orderIds.hashMismatch, 1]),
    duplicateContentRejectedWithoutExtraRevision: mismatch?.order.revision_count === 1 && duplicateContentPreconditions && after('duplicateContent', 'evaluateHashMismatch'),
    unauthorizedSubmissionRejected: locked?.order.revision_count === 0 && !sameAddress(locked?.order.owner, locked?.order.spec.author) && sameAddress(rawFor('unauthorizedSubmission')?.sender, locked?.order.owner) && numberArg(argsFor('unauthorizedSubmission')[0]) === config.orderIds.unauthorized && after('unauthorizedSubmission', 'createAuthorLockedOrder'),
    duplicateAssessmentRejected: argsMatch('duplicateAssessment', [config.orderIds.correction, 2]) && after('duplicateAssessment', 'evaluateCorrected'),
    acceptedOrderClosed: numberArg(argsFor('acceptedOrderClosed')[0]) === config.orderIds.correction && correction?.order.revision_count === 2 && sameAddress(rawFor('acceptedOrderClosed')?.sender, correction?.order.spec.author) && after('acceptedOrderClosed', 'evaluateCorrected'),
    ...(isV3 ? {
      evidencePolicyAndDeliveryMapping:orders.length===4 && orders.every(({order,revisions})=>order.policy_version===config.policyVersion && revisions.every(({submission,assessment})=>v3AssessmentPolicyValid(order,submission,assessment))),
      prelockedEvidenceAndDelivery:expectedAssessmentMatches(correction?.revisions[0]?.assessment,lockedPlan?.expected.find(item=>item.id==='negative')) && expectedAssessmentMatches(correction?.revisions[1]?.assessment,lockedPlan?.expected.find(item=>item.id==='positive')) && expectedAssessmentMatches(mismatch?.revisions[0]?.assessment,lockedPlan?.expected.find(item=>item.id==='hashMismatch')) && expectedAssessmentMatches(strict?.revisions[0]?.assessment,lockedPlan?.expected.find(item=>item.id==='strictUnknown')),
      strictUnknownRemainsInsufficient:strict?.order.status==='INSUFFICIENT_EVIDENCE' && strict?.order.revision_count===1 && argsMatch('evaluateStrictUnknown',[config.orderIds.strictUnknown,1]),
      evidenceClassificationIndependentOfBuyerPolicy:!!strict?.revisions[0]?.assessment && !!correction?.revisions[1]?.assessment && canonical(strict.revisions[0].assessment.findings.map(item=>({criterion_id:item.criterion_id,status:item.status,evidence_indices:item.evidence_indices})))===canonical(correction.revisions[1].assessment.findings.map(item=>({criterion_id:item.criterion_id,status:item.status,evidence_indices:item.evidence_indices}))),
    } : {}),
    ...(isV4?{unboundReportBodyRejectedWithoutExtraRevision:mismatch?.order.revision_count===1 && unboundBodyPreconditions && after('unboundReportBody','evaluateHashMismatch')}:{}),
    ...(isV5?evidenceStageChecks(config,orders,transactions,rawTransactions):{}),
    ...(isV5?{prelockedSnapshotsExact:snapshotPlanMatches(config,orders,lockedPlan)}:{}),
    noCollectionErrors: errors.length === 0,
  };
  const requiredChecks = Object.fromEntries(Object.entries(checks).filter(([name]) => !['everyTrackedAttemptFinalAndIncluded', 'allTrackedTransactionsDeclared', 'allDeclaredDiagnosticAttemptsVerified', 'allUndeterminedAttemptsDeclared', 'allHistoricalRecordsVerified', 'allPriorMainSuiteRecordsVerified', 'allAuxiliaryDiagnosticRecordsVerified', 'allReleaseDeploymentSourcesVerified'].includes(name)));
  const warnings = [];
  if (accounting.undeclaredTrackedTransactions.length) warnings.push('Tracked transactions exist outside main caseHashes, diagnosticAttempts and historical release declarations; overall verification fails.');
  if (accounting.missingDeclaredHistoricalTransactions.length) warnings.push('Declared historical transactions are missing from the retained session; overall verification fails.');
  if (accounting.missingDeclaredPriorSuiteTransactions.length) warnings.push('Declared prior-suite transactions are missing from the retained session; overall verification fails.');
  if(accounting.missingDeclaredAuxiliaryTransactions.length)warnings.push('Declared auxiliary diagnostic deployments are missing; overall verification fails.');
  if (accounting.attemptStatistics.finalizedUndeterminedAttempts) warnings.push('Historical or current undetermined attempts are retained explicitly; they are not counted as passed business cases.');
  return { format: 'research-receipt/bradbury-e2e/1', policyVersion: config.policyVersion, validationPlan: config.validationPlanFile ? { file:config.validationPlanFile, sha256:config.validationPlanSha256, sourceCommitment:config.mainRelease.sourceSha256 } : null, collectedAt: new Date().toISOString(), environment: 'Public GenLayer Bradbury Phase 2; protocol execution, EVM inclusion and latest-final contract state independently checked.', network: scalarPick(connection.metadata, ['network', 'chainId', 'genesisHash', 'addressManager', 'manifestUrl', 'manifestSha256', 'snapshotBlock', 'checkedAt']), reviewedInputFixture: config.fixtureFile ? { file: config.fixtureFile, sha256: config.fixtureSha256, declaredScopeRevision: config.scopeRevision } : null, deployment: { contractAddress: config.mainRelease.contractAddress, sourceSha256: config.mainRelease.sourceSha256, deploymentTx: config.mainRelease.deploymentHash }, releaseProofs, auxiliaryDeployments, historicalReleases: releaseProofs.filter(item => item.kind === 'historical'), priorMainSuite: { releaseProfile: 'main', contractAddress: config.mainRelease.contractAddress, sourceSha256: config.mainRelease.sourceSha256, sharedDeploymentHash: config.mainRelease.deploymentHash, declaredTransactionHashes: config.mainRelease.priorSuiteHashes, observedTransactionHashes: transactions.filter(item => priorHashes.has(item.protocolTxId.toLowerCase())).map(item => item.protocolTxId), allRecordsVerified: accounting.allPriorMainSuiteRecordsVerified }, actors: Object.fromEntries(['owner', 'author', 'outsider'].filter(role => typeof session.actors[role] === 'string').map(role => [role, session.actors[role]])), suiteComplete: config.suiteComplete, caseChecks, checks, allRequiredCasesPassed: allTrue(requiredChecks), allAttemptsConsensusAccepted: accounting.allAttemptsConsensusAccepted, attemptStatistics: { ...accounting.attemptStatistics, auxiliaryDeploymentsDeclared: config.auxiliaryDeployments.length, auxiliaryTrackedAttempts: transactions.filter(item => item.releaseKind === 'auxiliary').length, historicalReleaseCount: config.historicalReleases.length, historicalTrackedAttempts: transactions.filter(item => item.releaseKind === 'historical').length, priorMainSuiteAttemptsDeclared: config.mainRelease.priorSuiteHashes.length, priorMainSuiteTrackedAttempts: transactions.filter(item => priorHashes.has(item.protocolTxId.toLowerCase())).length }, diagnosticAttempts: accounting.diagnosticAttempts, undeclaredTrackedTransactions: accounting.undeclaredTrackedTransactions, missingDeclaredHistoricalTransactions: accounting.missingDeclaredHistoricalTransactions, missingDeclaredPriorSuiteTransactions: accounting.missingDeclaredPriorSuiteTransactions, missingDeclaredAuxiliaryTransactions: accounting.missingDeclaredAuxiliaryTransactions, warnings, allPassed: allTrue(checks), transactions, state: { releaseProfile: 'main', contractAddress: config.mainRelease.contractAddress, variant: 'latest-final', orderCount, orders, reads }, errors, limits: ['allPassed means the explicitly completed required main-release suite and declared diagnostic history were verified; it does not mean every historical attempt reached consensus.', 'Each historical transaction is bound to its own declared contract and independently checked deployed source; historical attempts cannot satisfy main-release cases.', 'Historical pre-retry state observations and retry policies are clearly labeled declarations; current collection does not independently replay those historical state reads.', 'This verifies these deployments and bounded test cases, not an independent smart-contract audit or production safety certification.', 'No raw RPC response, validator/model configuration, private key, signed raw transaction or authentication token is exported.'] };
}

export function selfTest() {
  const incomplete = validateExpectations({ format: 'research-receipt/bradbury-expectations/1', caseHashes: {} });
  assert.equal(incomplete.suiteComplete, false);
  assert.equal(Object.keys(incomplete.caseHashes).length, 0);
  assert.throws(() => validateExpectations({ format: 'research-receipt/bradbury-expectations/1', caseHashes: { deployment: RELEASE.deploymentTx, duplicateContent: RELEASE.deploymentTx } }), /distinct/);
  assert.throws(() => validateExpectations({ format: 'research-receipt/bradbury-expectations/1', caseHashes: { fakeCase: RELEASE.deploymentTx } }), /Unknown/);
  assert.deepEqual(scalarPick({ id: 1, providerConfig: { token: 'secret' } }, ['id']), { id: 1 });
  const sample = { report_title: 'One', report_body: 'same', report_version: 'v1', sources: [{ url: 'https://raw.githubusercontent.com/a/b/' + 'a'.repeat(40) + '/x', sha256: '0'.repeat(64), byte_length: 1 }], claims: [{ criterion_id: 'test', statement: 'claim', evidence_indices: [0] }] };
  assert.equal(contentFingerprint(sample), contentFingerprint({ ...sample, report_title: 'Renamed', report_version: 'v2' }));
  assert.notEqual(contentFingerprint(sample), contentFingerprint({ ...sample, report_body: 'different' }));
  assert.equal(protocolAccepted({ lifecycle: { outcome: 'accepted' }, resultName: 'MAJORITY_AGREE' }), true);
  assert.equal(protocolAccepted({ statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', lifecycle: { outcome: 'undetermined' }, resultName: 'NO_MAJORITY' }), false);
  assert.equal(protocolAccepted({ statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN' }), false);
  let attemptChecks = 0;
  const check = (actual, expected) => { assert.equal(actual, expected); attemptChecks++; };
  const oldHash = '0x9fa815aa73a7bac515811960bd9368e25958d5b43ae20f63d86b59cc05eeca3e';
  const retryHash = `0x${'b'.repeat(64)}`;
  const actor = `0x${'1'.repeat(40)}`;
  const diagnostic = { case: 'evaluateContradicted', attempt: 1, hash: oldHash, observedOutcome: 'FINALIZED_UNDETERMINED_NO_MAJORITY', stateObservation: 'Declared final assessment absent before retry.', retryPolicy: 'One explicit retry; no automatic retries.' };
  const config = validateExpectations({ format: 'research-receipt/bradbury-expectations/1', caseHashes: { evaluateContradicted: retryHash }, diagnosticAttempts: [diagnostic] });
  const oldRaw = { statusName: 'FINALIZED', txExecutionResultName: 'FINISHED_WITH_RETURN', lifecycle: { outcome: 'undetermined' }, result: 5, resultName: 'NO_MAJORITY', sender: actor, recipient: RELEASE.contractAddress, txDataDecoded: { type: 'call', callData: new Map([['', 'evaluate'], ['args', [1n, 1n]]]) } };
  const retryRaw = { ...oldRaw, lifecycle: { outcome: 'accepted' }, result: 1, resultName: 'MAJORITY_AGREE' };
  const rows = [
    { protocolTxId: oldHash, caseId: null, operation: 'evaluate', sender: actor, recipient: RELEASE.contractAddress, status: 'FINALIZED', execution: 'FINISHED_WITH_RETURN', finalized: true, consensusAccepted: false, consensusOutcome: 'undetermined', consensusResult: 'NO_MAJORITY', identityAndInclusionVerified: true, verified: false, inclusion: { verified: true, blockNumber: '1', logIndex: 0 } },
    { protocolTxId: retryHash, caseId: 'evaluateContradicted', operation: 'evaluate', sender: actor, recipient: RELEASE.contractAddress, status: 'FINALIZED', execution: 'FINISHED_WITH_RETURN', finalized: true, consensusAccepted: true, consensusOutcome: 'accepted', consensusResult: 'MAJORITY_AGREE', identityAndInclusionVerified: true, verified: true, inclusion: { verified: true, blockNumber: '2', logIndex: 0 } },
  ];
  const tracked = rows.map(row => ({ hash: row.protocolTxId }));
  const raw = new Map([[oldHash, oldRaw], [retryHash, retryRaw]]);
  const accounting = attemptAccounting(config, rows, tracked, raw);
  check(accounting.diagnosticAttempts[0].recordVerified, true);
  check(accounting.diagnosticAttempts[0].linkedRetryVerified, true);
  check(accounting.allAttemptsConsensusAccepted, false);
  check(requiredCaseChecks(config, rows).evaluateContradicted, true);
  check(attemptAccounting(config, rows, [...tracked, { hash: `0x${'c'.repeat(64)}` }], raw).allTrackedTransactionsDeclared, false);
  const wrongRetry = new Map(raw); wrongRetry.set(retryHash, { ...retryRaw, txDataDecoded: { type: 'call', callData: new Map([['', 'evaluate'], ['args', [2n, 1n]]]) } });
  check(attemptAccounting(config, rows, tracked, wrongRetry).diagnosticAttempts[0].linkedRetryVerified, false);
  const wrongHistory = new Map(raw); wrongHistory.set(oldHash, retryRaw);
  check(attemptAccounting(config, rows, tracked, wrongHistory).diagnosticAttempts[0].recordVerified, false);
  const selectedFailure = validateExpectations({ format: 'research-receipt/bradbury-expectations/1', caseHashes: { evaluateContradicted: oldHash }, diagnosticAttempts: [diagnostic] });
  check(requiredCaseChecks(selectedFailure, rows).evaluateContradicted, false);
  const disagreement = validateExpectations({ format: 'research-receipt/bradbury-expectations/1', caseHashes: { evaluateContradicted: retryHash }, diagnosticAttempts: [{ ...diagnostic, observedOutcome: 'FINALIZED_UNDETERMINED_MAJORITY_DISAGREE', observedExecution: 'FINISHED_WITH_ERROR' }] });
  const disagreementRows = [{ ...rows[0], consensusResult: 'MAJORITY_DISAGREE', execution: 'FINISHED_WITH_ERROR' }, rows[1]];
  const disagreementRaw = new Map(raw); disagreementRaw.set(oldHash, { ...oldRaw, result: 2, resultName: 'MAJORITY_DISAGREE', txExecutionResultName: 'FINISHED_WITH_ERROR' });
  check(attemptAccounting(disagreement, disagreementRows, tracked, disagreementRaw).diagnosticAttempts[0].recordVerified, true);
  check(attemptAccounting(config, disagreementRows, tracked, disagreementRaw).diagnosticAttempts[0].recordVerified, false);
  let releaseChecks = 0;
  const releaseCheck = (actual, expected) => { assert.equal(actual, expected); releaseChecks++; };
  const newMain = { contractAddress: `0x${'2'.repeat(40)}`, sourceSha256: 'a'.repeat(64), deploymentHash: `0x${'f'.repeat(64)}` };
  const historicalConfig = validateExpectations({ format: 'research-receipt/bradbury-expectations/1', mainRelease: newMain, historicalReleases: [{ ...RELEASE, deploymentHash: RELEASE.deploymentTx, caseHashes: [oldHash] }], caseHashes: { evaluateContradicted: retryHash }, diagnosticAttempts: [{ ...diagnostic, case: 'v1-evaluateContradicted', observedOutcome: 'NO_MAJORITY' }] });
  const assigned = releaseAssignments(historicalConfig);
  releaseCheck(assigned.get(oldHash).contractAddress, RELEASE.contractAddress);
  releaseCheck(assigned.get(oldHash).sourceSha256, RELEASE.sourceSha256);
  releaseCheck(assigned.get(retryHash).contractAddress, newMain.contractAddress);
  const history = attemptAccounting(historicalConfig, rows, tracked, raw);
  releaseCheck(history.diagnosticAttempts[0].recordVerified, true);
  releaseCheck(history.diagnosticAttempts[0].retryProtocolTxId, null); // Never invent a retry link across different source/address profiles.
  releaseCheck(history.allHistoricalRecordsVerified, false); // The declared old deployment is deliberately absent from this fixture.
  assert.throws(() => validateExpectations({ ...historicalConfig, format: 'research-receipt/bradbury-expectations/1', caseHashes: { evaluateContradicted: oldHash } }), /multiple release profiles/); releaseChecks++;
  assert.throws(() => validateExpectations({ format: 'research-receipt/bradbury-expectations/1', mainRelease: {}, caseHashes: {} }), /Invalid main/); releaseChecks++;
  let priorChecks = 0;
  const priorCheck = (actual, expected) => { assert.equal(actual, expected); priorChecks++; };
  const priorConfig = validateExpectations({ format: 'research-receipt/bradbury-expectations/1', mainRelease: { ...RELEASE, priorSuiteHashes: [oldHash] }, caseHashes: { evaluateContradicted: retryHash }, diagnosticAttempts: [diagnostic] });
  const priorAccounting = attemptAccounting(priorConfig, rows, tracked, raw);
  priorCheck(priorAccounting.allPriorMainSuiteRecordsVerified, true);
  priorCheck(priorAccounting.diagnosticAttempts[0].retryProtocolTxId, null); // Fresh scope/order is not an implicit retry of an archived attempt.
  priorCheck(attemptAccounting(priorConfig, rows, tracked.slice(1), raw).allPriorMainSuiteRecordsVerified, false);
  assert.throws(() => validateExpectations({ format: 'research-receipt/bradbury-expectations/1', mainRelease: { ...RELEASE, priorSuiteHashes: [oldHash] }, caseHashes: { evaluateContradicted: oldHash } }), /prior-suite operation/); priorChecks++;
  assert.throws(() => validateExpectations({ format: 'research-receipt/bradbury-expectations/1', mainRelease: { ...RELEASE, priorSuiteHashes: [RELEASE.deploymentTx] }, caseHashes: {} }), /shared main deployment/); priorChecks++;
  console.log(JSON.stringify({ selfTest: 'passed', checks: 10, attemptAccountingChecks: attemptChecks, releaseProfileChecks: releaseChecks, priorSuiteChecks: priorChecks, networkRequests: 0 }));
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();
  const index = args.indexOf('--expectations');
  if (!args.includes('--collect') || index < 0 || !args[index + 1]) {
    console.log('Read only: node scripts/collect-bradbury-evidence.mjs --collect --expectations artifacts/bradbury/e2e-expectations.json\nOffline checks: node scripts/collect-bradbury-evidence.mjs --self-test');
    return;
  }
  const expectations = JSON.parse(await readFile(await projectFile(args[index + 1], '.json'), 'utf8'));
  const evidence = await collect(expectations);
  await mkdir(resolve(PROJECT_ROOT, 'docs/evidence'), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(publicJson({ allPassed: evidence.allPassed, caseChecks: evidence.caseChecks, checks: evidence.checks, evidenceFile: 'docs/evidence/bradbury-e2e.json' }));
  if (!evidence.allPassed) process.exitCode = 1;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
