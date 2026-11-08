// Read-only V6 collector. No signing, writes, funding, model calls or traces.
// Historical metadata is frozen here before V6 execution; private session fields
// are never accessed or copied into evidence.
import { readFile, realpath, stat, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abi,decodeInputData } from 'genlayer-js';
import { decodeEventLog, parseAbiItem } from 'viem';
import { BRADBURY, PROJECT_ROOT, connectBradbury, protocolInclusion, safeError } from './bradbury-client.mjs';
import { consensusAccepted, finalizedUndetermined } from '../src/lib/protocol-outcome.mjs';
import { canonicalEvidenceJson, hashEvidenceJson, validateEvidenceRecord, validateEvidenceSnapshot } from '../src/lib/evidence-snapshot.mjs';
import { validateV6Criteria, validateV6Submission } from '../src/lib/field-catalog.mjs';

export const PLAN_FILE = 'docs/evidence/v6-validation-plan.json';
export const PLAN_SHA256 = 'c731fb736abc2bf2c70e48d5a72cd1e72195a0bc25aa50070d7a9a28564b506e';
export const LEDGER_FILE = 'artifacts/bradbury/v6-execution-ledger.json';
export const SESSION_FILE = 'artifacts/bradbury/session-0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70.json';
export const OUTPUT_FILE = 'docs/evidence/bradbury-v6-e2e.json';
export const COLLECT_ACK = 'READ_ONLY_V6_PUBLIC_EVIDENCE';
export const DEPLOYMENT_SOURCE_SHA256 = 'e053f1b4250b6a0e7717722c54dfe97717a5d341b374d9404d7b5b2c057e1fcb';
const OWNER = '0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70';
const POLICY = 'research-receipt/6';
const sha = value => createHash('sha256').update(value).digest('hex');
const equal = (a,b) => canonicalEvidenceJson(a) === canonicalEvidenceJson(b);
const hash = value => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
const sameAddress = (a,b) => address(a) && address(b) && a.toLowerCase() === b.toLowerCase();
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const parsed = value => typeof value === 'string' && /^[\[{\"]/.test(value.trim()) ? JSON.parse(value) : value;
const field = (value,key) => value instanceof Map ? value.get(key) : value?.[key];
const ensure = (condition,message) => { if (!condition) throw new Error(message); };
const exact = (value,keys,label) => ensure(value && typeof value === 'object' && !Array.isArray(value) && equal(Object.keys(value).sort(),[...keys].sort()),`Unsupported ${label} fields`);

async function localBytes(name, root = PROJECT_ROOT) {
  ensure(typeof name === 'string' && !isAbsolute(name),'Input must be project-relative');
  const base = await realpath(root), path = await realpath(resolve(base,name.replaceAll('\\','/')));
  const rel = relative(base,path);
  ensure(rel && !rel.startsWith('..') && !isAbsolute(rel),'Input escapes project');
  const details = await stat(path);
  ensure(details.isFile() && details.size < 32*1024*1024,'Invalid or oversized evidence file');
  return readFile(path);
}

export async function loadV6Inputs({root = PROJECT_ROOT, requireArchivedEvidence = false, planFile = PLAN_FILE, planSha256 = PLAN_SHA256, deploymentSourceSha256 = DEPLOYMENT_SOURCE_SHA256} = {}) {
  const commitments = [];
  const committed = async (file,expected,fallback) => {
    let bytes,resolvedFile=file;
    try { bytes=await localBytes(file,root); }
    catch(error) { if(error.code!=='ENOENT' || !fallback)throw error;bytes=await localBytes(fallback,root);resolvedFile=fallback; }
    ensure(sha(bytes) === expected,`Changed frozen commitment: ${file}`);
    commitments.push({file,...(resolvedFile!==file?{resolvedFile}:{}),sha256:expected,byteLength:bytes.length,bytesVerified:true});
    return bytes;
  };
  const plan = JSON.parse(await committed(planFile,planSha256));
  ensure(plan.format === 'research-receipt/v6-prelocked-business-plan/1' && plan.policyVersion === POLICY && plan.requiredSignedCaseCount === 51 && plan.expectedSuccessfulCaseCount === 40 && plan.expectedErrorCaseCount === 11,'Wrong V6 plan profile');
  ensure(plan.deploymentSourceCommitment.sha256 === deploymentSourceSha256 && plan.cases.length === 51 && plan.cases.every((row,index) => row.sequence === index+1 && row.role === 'owner') && new Set(plan.cases.map(row=>row.name)).size === 51,'Wrong V6 fixed case sequence');
  ensure(equal(Object.values(plan.orderIds),[1,2,3,4,5,6,7,8,9]) && equal(plan.firstGate.caseSequences,Array.from({length:13},(_,i)=>i+1)) && plan.expected.length === 10,'Wrong V6 fixed order or first-gate profile');
  const fixture = JSON.parse(await committed(plan.fixtureFile,plan.fixtureSha256,plan.publicFixtureFile));
  await committed(plan.publicFixtureFile,plan.fixtureSha256);
  const source = new TextDecoder('utf-8',{fatal:true}).decode(await committed(plan.deploymentSourceCommitment.file,deploymentSourceSha256));
  ensure(Buffer.byteLength(source) === plan.deploymentSourceCommitment.byteLength,'Wrong compact source length');
  await committed(plan.sourceCommitment.file,plan.sourceCommitment.sha256);
  if (plan.originalV6CanonicalCommitment) await committed(plan.originalV6CanonicalCommitment.file,plan.originalV6CanonicalCommitment.sha256);
  const catalog = JSON.parse(await committed(plan.catalogCommitment.file,plan.catalogCommitment.sha256));
  const feeProfile = JSON.parse(await committed(plan.feeProfileCommitment.file,plan.feeProfileCommitment.sha256));
  const isCompactV2 = plan.buildCommitment.algorithm === 'python-ast-local-alpha-docstring-strip-minimal-whitespace/2';
  const buildFallback = plan.executionRun === 'v6-wallet-4'
    ? 'tests/fixtures/v6-compact-v3-build.json'
    : (isCompactV2 ? 'tests/fixtures/v6-compact-v2-build.json' : 'tests/fixtures/v6-compact-build.json');
  const build = JSON.parse(await committed(plan.buildCommitment.file,plan.buildCommitment.sha256,buildFallback));
  if (isCompactV2) {
    ensure(build.algorithm === 'python-ast-local-alpha-docstring-strip-minimal-whitespace/2' && build.source_sha256 === plan.sourceCommitment.sha256 && build.output_sha256 === deploymentSourceSha256 && build.full_ast_type_comments_equal === false && build.alpha_normalized_ast_type_comments_equal === true && build.ordered_str_bytes_values_and_utf8_bytes_equal === false && build.ordered_non_docstring_str_bytes_values_and_utf8_bytes_equal === true && build.module_and_class_surface_identical === true && build.runner_first_two_lines_bytes_identical === true && build.verification?.executed === true && build.verification?.exit_code === 0,'Invalid compact_v2/v3 equivalence build proof');
  } else {
    ensure(build.source_sha256 === plan.sourceCommitment.sha256 && build.output_sha256 === deploymentSourceSha256 && build.full_ast_type_comments_equal === true && build.ordered_str_bytes_values_and_utf8_bytes_equal === true && build.runner_first_two_lines_bytes_identical === true && build.verification?.executed === true && build.verification?.exit_code === 0,'Invalid compact equivalence build proof');
  }
  await committed(build.tool_file,plan.buildCommitment.toolSha256);
  await committed(build.algorithm_dependency_file,plan.buildCommitment.algorithmDependencySha256);
  await committed(build.artifact_test_file,build.artifact_test_sha256);
  await committed('scripts/prepare-v6-e2e.py',plan.plannerSha256);
  if (plan.walletPlannerCommitment) await committed(plan.walletPlannerCommitment.file,plan.walletPlannerCommitment.sha256);
  if (plan.supersedesExecutionPlan) await committed(plan.supersedesExecutionPlan.file,plan.supersedesExecutionPlan.sha256);
  if (plan.supersedesWallet1Plan) {
    await committed(plan.supersedesWallet1Plan.file,plan.supersedesWallet1Plan.sha256);
    await committed(plan.supersedesWallet1Plan.fixtureFile,plan.supersedesWallet1Plan.fixtureSha256,plan.supersedesWallet1Plan.publicFixtureFile);
    await committed(plan.supersedesWallet1Plan.publicFixtureFile,plan.supersedesWallet1Plan.fixtureSha256);
    await committed(plan.supersedesWallet1Plan.plannerFile,plan.supersedesWallet1Plan.plannerSha256);
  }
  if (plan.supersedesWallet2Plan) {
    await committed(plan.supersedesWallet2Plan.file,plan.supersedesWallet2Plan.sha256);
    await committed(plan.supersedesWallet2Plan.fixtureFile,plan.supersedesWallet2Plan.fixtureSha256,plan.supersedesWallet2Plan.publicFixtureFile);
    await committed(plan.supersedesWallet2Plan.publicFixtureFile,plan.supersedesWallet2Plan.fixtureSha256);
    await committed(plan.supersedesWallet2Plan.plannerFile,plan.supersedesWallet2Plan.plannerSha256);
    await committed(plan.supersedesWallet2Plan.revertedDeploymentEvidenceFile,plan.supersedesWallet2Plan.revertedDeploymentEvidenceSha256);
  }
  if (plan.supersedesWallet3Plan) {
    await committed(plan.supersedesWallet3Plan.file,plan.supersedesWallet3Plan.sha256);
    await committed(plan.supersedesWallet3Plan.fixtureFile,plan.supersedesWallet3Plan.fixtureSha256,plan.supersedesWallet3Plan.publicFixtureFile);
    await committed(plan.supersedesWallet3Plan.publicFixtureFile,plan.supersedesWallet3Plan.fixtureSha256);
    await committed(plan.supersedesWallet3Plan.plannerFile,plan.supersedesWallet3Plan.plannerSha256);
    await committed(plan.supersedesWallet3Plan.supersededDeploymentFile,plan.supersedesWallet3Plan.supersededDeploymentSourceSha256);
    await committed(plan.supersedesWallet3Plan.supersededBuildFile,plan.supersedesWallet3Plan.supersededBuildSha256,'tests/fixtures/v6-compact-v2-build.json');
    await committed(plan.supersedesWallet3Plan.attemptEvidenceFile,plan.supersedesWallet3Plan.attemptEvidenceSha256);
  }
  if (Array.isArray(plan.walletTransportEvidence)) {
    for (const row of plan.walletTransportEvidence) await committed(row.file,row.sha256);
  }
  const originalFixture=JSON.parse(await committed(plan.originalFixtureCommitment.file,plan.originalFixtureCommitment.sha256));
  const materials=originalFixture.positive.materials;
  ensure(Array.isArray(materials) && materials.length===plan.sourceMaterialCommitments.length,'Missing frozen original source materials');
  for (const [index,material] of materials.entries()) ensure(typeof material==='string' && sha(Buffer.from(material,'utf8'))===plan.sourceMaterialCommitments[index].sha256 && Buffer.byteLength(material)===plan.sourceMaterialCommitments[index].byte_length,'Original material byte commitment mismatch');
  const archivedOptional=new Set([
    'artifacts/bradbury/sufficiency-probe/positive-deployment-intent.json',
    'artifacts/bradbury/sufficiency-probe/gas-rejection-nonce-1793881748397.json',
    'artifacts/bradbury/sufficiency-probe/compact-transport-check.json',
  ]);
  const missingArchivedEvidence=[];
  for (const row of plan.priorEvidence) {
    try { await committed(row.file,row.sha256); }
    catch(error) {
      if(requireArchivedEvidence || error.code!=='ENOENT' || !archivedOptional.has(row.file))throw error;
      missingArchivedEvidence.push(row.file);commitments.push({file:row.file,sha256:row.sha256,commitmentOnly:true,bytesVerified:false});
    }
  }
  const seen = new Set();
  for (const row of HISTORICAL_TRANSACTIONS) if (!seen.has(row.sourceFile)) {
    await committed(row.sourceFile,row.sourceSha256);seen.add(row.sourceFile);
  }
  ensure(equal(catalog,plan.cases[0].readbackOracle.catalogCanonicalObject),'Catalog object differs from locked deployment getter oracle');
  ensure(sha(canonicalEvidenceJson(plan.actorCommitment.actors)) === plan.actorCommitment.sha256,'Actor commitment mismatch');
  for (const key of ['leaderTimeunitsAllocation','validatorTimeunitsAllocation','executionBudgetPerRound','appealRounds']) ensure(String(feeProfile[key]) === plan.executionProfile[key],`Fee execution profile mismatch: ${key}`);
  return {plan,fixture,source,catalog,feeProfile,materials,commitments,missingArchivedEvidence,dependenciesComplete:missingArchivedEvidence.length===0,planFile,planSha256,deploymentSourceSha256,owner:plan.actorCommitment.actors.owner.toLowerCase()};
}

export function expectedCaseArgs(plan,fixture,row) {
  ensure(plan.cases[row.sequence-1]?.name === row.name,'Case is not in frozen plan');
  if (row.op === 'deploy') return [];
  if (row.inputCase !== null) {
    ensure(Object.hasOwn(fixture,row.inputCase) && Array.isArray(row.prefixArgs),'Missing exact fixture input');
    return [...row.prefixArgs,JSON.stringify(fixture[row.inputCase])];
  }
  ensure(Array.isArray(row.args),'Missing fixed ABI arguments');return [...row.args];
}

export function validateTransportAddendum(addendum,expectedHash,{rawBytes,contractAddress} = {}) {
  ensure(typeof expectedHash === 'string' && /^[0-9a-f]{64}$/.test(expectedHash),'Transport actor exception requires an independently reviewed hash');
  const bytes = rawBytes ?? Buffer.from(canonicalEvidenceJson(addendum));
  ensure(sha(bytes) === expectedHash,'Transport addendum hash mismatch');
  exact(addendum,['format','planSha256','sequence','caseName','originalOwner','deploymentSender','contractAddress','chainId','genesisHash','sourceSha256','constructorArgs','leaderOnly','remainingCasesActor','reasonCode','reviewedAt','deploymentRequestHash','gasLimit','gasPriceWei','maxTotalCostWei','validUntil','registryAddresses','addressManager','l2Endpoint','manualProofFile','manualProofSha256'],'transport addendum');
  ensure(addendum.format === 'research-receipt/v6-deployment-transport-addendum/1' && addendum.planSha256 === PLAN_SHA256 && addendum.sequence === 1 && addendum.caseName === 'deployment','Transport addendum can alter only case-1 deployment sender');
  ensure(sameAddress(addendum.originalOwner,OWNER) && sameAddress(addendum.remainingCasesActor,OWNER) && address(addendum.deploymentSender) && !sameAddress(addendum.deploymentSender,OWNER),'Transport addendum must preserve the other 50 actors');
  ensure(addendum.contractAddress === null || address(addendum.contractAddress) && (!contractAddress || sameAddress(addendum.contractAddress,contractAddress)),'Transport addendum contract address mismatch');
  ensure(addendum.chainId === BRADBURY.chainId && addendum.genesisHash === BRADBURY.genesisHash && addendum.sourceSha256 === DEPLOYMENT_SOURCE_SHA256 && equal(addendum.constructorArgs,[]) && addendum.leaderOnly === false,'Transport addendum cannot change chain/source/constructor/leader flag');
  ensure(addendum.reasonCode === 'DEFAULT_ESTIMATE_REVERT_TRANSPORT' && date(addendum.reviewedAt),'Invalid transport review metadata');
  ensure(/^[a-f0-9]{64}$/.test(addendum.deploymentRequestHash || '') && addendum.gasLimit === '100000000' && decimal(addendum.gasPriceWei) && decimal(addendum.maxTotalCostWei) && BigInt(addendum.gasLimit)*BigInt(addendum.gasPriceWei) <= BigInt(addendum.maxTotalCostWei) && BigInt(addendum.maxTotalCostWei)<=50000000000000000n && decimal(addendum.validUntil) && BigInt(addendum.validUntil)*1000n>BigInt(Date.parse(addendum.reviewedAt)),'Invalid exact deployment request hash, gas cap or expiry');
  ensure(sameAddress(addendum.addressManager,BRADBURY.addressManager) && ['https://rpc-bradbury.genlayer.com','https://rpc.testnet-chain.genlayer.com'].includes(addendum.l2Endpoint) && addendum.registryAddresses && address(addendum.registryAddresses.ConsensusMain) && address(addendum.registryAddresses.TransactionManager),'Invalid transport registry or endpoint');
  ensure(typeof addendum.manualProofFile === 'string' && /^[a-f0-9]{64}$/.test(addendum.manualProofSha256 || ''),'Missing committed manual transport proof');
  return {...addendum,sha256:expectedHash};
}

export function validateV6Ledger(ledger,inputs,{transportAddendum} = {}) {
  const expectedPlanSha = inputs?.planSha256 || PLAN_SHA256;
  const expectedSourceSha = inputs?.deploymentSourceSha256 || DEPLOYMENT_SOURCE_SHA256;
  ensure(ledger?.format === 'research-receipt/v6-execution-ledger/1' && ledger.planSha256 === expectedPlanSha && ledger.fixtureSha256 === inputs.plan.fixtureSha256,'Ledger is not bound to frozen V6 inputs');
  ensure(Array.isArray(ledger.attempts) && ledger.attempts.length <= 51 && Array.isArray(ledger.transportFailures),'Malformed ledger attempts');
  if (inputs?.plan?.executionAuthority === 'user-controlled-wallet') {
    ensure(!ledger.transportAddendum && !transportAddendum,'User-wallet run uses the locked wallet owner for all 51 cases; transport addendum is forbidden');
    if (ledger.attempts.length && ledger.release?.actorAddress !== undefined) ensure(sameAddress(ledger.release.actorAddress,inputs.plan.actorCommitment.actors.owner),'Wallet release actor mismatch');
  }
  if (ledger.attempts.length) ensure(address(ledger.release?.contractAddress) && ledger.release.sourceSha256 === expectedSourceSha && hash(ledger.release.deploymentHash),'Missing exact V6 release identity');
  if (ledger.transportAddendum) ensure(transportAddendum && ledger.transportAddendum.sha256 === transportAddendum.sha256 && (transportAddendum.contractAddress===null || sameAddress(ledger.release?.contractAddress,transportAddendum.contractAddress)),'Unreviewed or conflicting ledger transport addendum');
  else ensure(!transportAddendum,'Reviewed transport addendum is not bound in ledger');
  const hashes = new Set(), intents = new Set();let stopped = false;
  for (const [index,row] of ledger.attempts.entries()) {
    const planned = inputs.plan.cases[index];
    ensure(!stopped && row.sequence === index+1 && row.name === planned.name,'Duplicate, extra, reordered or post-failure case attempt');
    ensure(typeof row.intentId === 'string' && row.intentId.length > 0 && !intents.has(row.intentId),'Duplicate or missing intent');intents.add(row.intentId);
    ensure(['confirmed','submission-uncertain','failed-before-hash'].includes(row.state) && decimal(row.submittedAfterBlock) && date(row.submittedAt),'Invalid attempt state or submission boundary');
    ensure(Array.isArray(row.beforeReads) && Array.isArray(row.afterReads),'Every attempt must retain public raw readbacks');
    if (row.hash !== undefined && row.hash !== null) { ensure(hash(row.hash) && !hashes.has(row.hash.toLowerCase()),'Duplicate or invalid case protocol hash');hashes.add(row.hash.toLowerCase()); }
    if (row.envelopeHash !== undefined && row.envelopeHash !== null) ensure(hash(row.envelopeHash),'Invalid envelope hash');
    if (row.state === 'confirmed') ensure(hash(row.hash) && date(row.finalizedAt),'Confirmed case requires one protocol hash and final observation time');
    else stopped = true;
    if (index === 0 && hash(row.hash)) ensure(row.hash.toLowerCase() === ledger.release.deploymentHash.toLowerCase(),'Deployment hash differs from release');
  }
  if (ledger.attempts.length > 13) {
    const gate = ledger.firstGate;
    ensure(gate?.throughSequence === 13 && gate.passed === true && date(gate.verifiedAt) && equal(gate.caseHashes,ledger.attempts.slice(0,13).map(row=>row.hash)),'Remaining cases require the exact first-13 gate record');
    ensure(Date.parse(gate.verifiedAt) >= Date.parse(ledger.attempts[12].finalizedAt) && Date.parse(gate.verifiedAt) <= Date.parse(ledger.attempts[13].submittedAt),'First-gate causal order mismatch');
  }
  for (const failure of ledger.transportFailures) ensure(typeof failure.intentId === 'string' && failure.protocolHash === null && failure.envelopeHash === null && decimal(String(failure.nonceBefore)) && String(failure.nonceBefore) === String(failure.nonceAfter) && /^[a-f0-9]{64}$/.test(failure.sourceSha256 || '') && typeof failure.stage === 'string' && typeof failure.reasonCode === 'string','Transport failure cannot impersonate a signed protocol case');
  return ledger;
}

const FINDING_KEYS = ['criterion_id','claim_type','validity','status','delivery_status','evidence_indices','basis_scope_source_indices','scope_source_indices','field_checks'];
export function assessmentProjection(assessment) {
  ensure(assessment && Array.isArray(assessment.findings),'Missing full assessment');
  return {snapshot_hash:assessment.snapshot_hash,verdict:assessment.verdict,findings:assessment.findings.map(item=>{
    exact(item,[...FINDING_KEYS,'reason'],'raw finding');
    ensure(typeof item.reason === 'string' && item.reason.trim() && Buffer.byteLength(item.reason) <= 800 && !item.reason.includes('\0'),'Invalid public finding rationale');
    return Object.fromEntries(FINDING_KEYS.map(key=>[key,item[key]]));
  }),source_checks:assessment.source_checks};
}
export function snapshotMatchesExpected(snapshot,expected,materials) {
  const {materials:actualMaterials,...actualMeta}=snapshot;
  const {materialCommitments,...expectedMeta}=expected;
  expectValue(actualMeta,expectedMeta,'prelocked complete snapshot metadata');
  ensure(Array.isArray(actualMaterials) && actualMaterials.length===materialCommitments.length,'Prelocked material count mismatch');
  for (const [index,committed] of materialCommitments.entries()) {
    ensure(committed.index===index && snapshot.source_checks[index].sha256===committed.fetched_sha256 && sha(Buffer.from(materials[index],'utf8'))===committed.fetched_sha256 && Buffer.byteLength(materials[index])===committed.fetched_byte_length,'Prelocked fetched material hash/byte length mismatch');
    const actual=actualMaterials[index];
    if(committed.stored_material===null) ensure(actual===null,'Failed source must retain null material');
    else ensure(typeof actual==='string' && sha(Buffer.from(actual,'utf8'))===committed.stored_material.sha256 && Buffer.byteLength(actual)===committed.stored_material.byte_length,'Prelocked stored material bytes mismatch');
  }
  return true;
}

function readMap(rows) {
  ensure(Array.isArray(rows),'Missing readbacks');const values = new Map();
  for (const row of rows) {
    ensure(row && typeof row.method === 'string' && Array.isArray(row.args) && row.variant === 'latest-final' && (Object.hasOwn(row,'value') !== Object.hasOwn(row,'error')) && (!row.error || typeof row.error.message==='string') && date(row.observedAt),'Readback must contain actual latest-final value or explicit error and observation time');
    const key = canonicalEvidenceJson([row.method,row.args]);ensure(!values.has(key),'Duplicate readback method/arguments');values.set(key,row);
  }
  return values;
}
const getRead = (map,method,args=[]) => {
  const row = map.get(canonicalEvidenceJson([method,args]));ensure(row && Object.hasOwn(row,'value'),`Missing raw readback: ${method} ${JSON.stringify(args)}`);return parsed(row.value);
};
const expectValue = (value,expected,label) => ensure(equal(value,expected),`Readback mismatch: ${label}`);

export async function validateCaseReadbacks(inputs,planned,attempt,{transactionDatetime} = {}) {
  const after = readMap(attempt.afterReads), before = readMap(attempt.beforeReads), oracle = planned.readbackOracle;
  ensure([...after.values()].every(row=>Date.parse(row.observedAt)>=Date.parse(attempt.finalizedAt)),'Post-state predates finalization observation');
  ensure([...before.values()].every(row=>Date.parse(row.observedAt)<=Date.parse(attempt.submittedAt)),'Pre-state was observed after submission');
  if (oracle.rollback) {
    ensure(oracle.beforeAfterEqualReads.length > 0,'Missing rollback oracle');
    for (const read of oracle.beforeAfterEqualReads) {
      const key=canonicalEvidenceJson([read.method,read.args]);ensure(before.has(key) && after.has(key),'ERROR requires both before and after raw state');
      ensure(Object.hasOwn(before.get(key),'value') && Object.hasOwn(after.get(key),'value') && !Object.hasOwn(before.get(key),'error') && !Object.hasOwn(after.get(key),'error'),'ERROR rollback requires successful raw value reads on both sides');
      expectValue(before.get(key).value,after.get(key).value,`ERROR unchanged raw ${read.method}`);
    }
  }
  if (oracle.orderCount !== undefined) expectValue(getRead(after,'get_order_count'),oracle.orderCount,'order count');
  if (planned.op === 'deploy') {
    expectValue(getRead(after,'get_policy_version'),POLICY,'policy getter');
    expectValue(getRead(after,'get_field_catalog'),oracle.catalogCanonicalObject,'complete catalog getter');
    return {verified:true,rollbackVerified:false,deploymentZeroBaselineVerified:true};
  }
  const order = getRead(after,'get_order',[oracle.orderId]);
  ensure(order.id === oracle.orderId && order.policy_version === POLICY,'Wrong actual order ID/policy');
  validateV6Criteria(order.spec.criteria,order.spec.catalog_version);
  ensure(await hashEvidenceJson(order.spec) === order.spec_hash,'Order spec hash mismatch');
  if (oracle.status !== undefined) expectValue(order.status,oracle.status,'order status');
  if (oracle.revisionCount !== undefined) expectValue(order.revision_count,oracle.revisionCount,'revision count');
  if (oracle.specHash !== undefined) expectValue(order.spec_hash,oracle.specHash,'spec hash');
  if (oracle.owner !== undefined) ensure(sameAddress(order.owner,oracle.owner),'Wrong owner');
  if (oracle.author !== undefined) ensure(sameAddress(order.spec.author,oracle.author),'Wrong author');
  if (planned.method === 'create_order' && !oracle.rollback) {
    const specInput = inputs.fixture[planned.inputCase];
    ensure(order.spec.client_ref === specInput.client_ref && equal(order.spec,{...specInput,author:specInput.author.toLowerCase()}),'Actual create spec differs from frozen input');
    expectValue(getRead(after,'get_order_id',[specInput.client_ref]),oracle.returnedOrderId,'client_ref → actual order ID');
  }
  for (let revisionNumber=1;revisionNumber<=order.revision_count;revisionNumber++) {
    const revision = getRead(after,'get_revision',[order.id,revisionNumber]);
    const snapshot = getRead(after,'get_evidence_snapshot',[order.id,revisionNumber]);
    const assessment = getRead(after,'get_assessment',[order.id,revisionNumber]);
    await validateEvidenceRecord({order,revision,expectedRevision:revisionNumber});
    const expected = inputs.plan.expected.find(row=>row.orderId===order.id && row.revision===revisionNumber);
    ensure(expected && revision.submission_hash===expected.submissionHash && revision.content_hash===expected.contentHash,'Revision is not the prelocked submission');
    if (revisionNumber===1) expectValue(revision.previous_submission_hash,'','first revision chain');
    else expectValue(revision.previous_submission_hash,getRead(after,'get_revision',[order.id,revisionNumber-1]).submission_hash,'previous submission chain');
    if (snapshot !== '') {
      await validateEvidenceSnapshot({order,revision,snapshot,expectedRevision:revisionNumber,assessment:assessment===''?null:assessment});
      snapshotMatchesExpected(snapshot,expected.snapshot,inputs.materials);
    } else ensure(assessment === '','Assessment exists without an immutable snapshot');
    if (assessment !== '') {
      expectValue(assessmentProjection(assessment),expected.assessment.projection,'full nine-field assessment projection');
      for (const [key,value] of Object.entries(expected.assessment.deterministicMetadata)) expectValue(assessment[key],value,`assessment metadata ${key}`);
      ensure(date(assessment.assessed_at) || Number.isSafeInteger(assessment.assessed_at),'Missing actual assessed_at');
    }
    if (oracle.revision === revisionNumber) {
      for (const [oracleKey,recordKey] of [['submissionHash','submission_hash'],['contentHash','content_hash'],['previousSubmissionHash','previous_submission_hash']]) if (oracle[oracleKey] !== undefined) expectValue(revision[recordKey],oracle[oracleKey],oracleKey);
      if (oracle.currentSnapshot !== undefined) expectValue(snapshot,oracle.currentSnapshot,'current snapshot absence');
      if (oracle.currentAssessment !== undefined) expectValue(assessment,oracle.currentAssessment,'current assessment absence');
    }
  }
  const context = oracle.expectedContext && inputs.plan.expected.find(row=>row.id===oracle.expectedContext);
  const targetRevision = context?.revision ?? oracle.revision ?? order.revision_count;
  const currentSnapshot = getRead(after,'get_evidence_snapshot',[order.id,targetRevision || 1]);
  const currentAssessment = getRead(after,'get_assessment',[order.id,targetRevision || 1]);
  if (oracle.snapshot) snapshotMatchesExpected(currentSnapshot,oracle.snapshot,inputs.materials);
  if (Object.hasOwn(oracle,'assessment')) {
    if (oracle.assessment === '') expectValue(currentAssessment,'','assessment not yet created');
    else expectValue(assessmentProjection(currentAssessment),oracle.assessment.projection,'case assessment projection');
  }
  if (oracle.snapshotHash !== undefined) expectValue(currentSnapshot.snapshot_hash,oracle.snapshotHash,'snapshot hash');
  if (oracle.expectedExistingSnapshotHash !== undefined) expectValue(currentSnapshot.snapshot_hash,oracle.expectedExistingSnapshotHash,'preserved snapshot hash');
  if (oracle.expectedExistingAssessmentProjection) expectValue(assessmentProjection(currentAssessment),oracle.expectedExistingAssessmentProjection,'preserved assessment projection');
  if (oracle.expectedSubmissionHash !== undefined) expectValue(getRead(after,'get_revision',[order.id,targetRevision]).submission_hash,oracle.expectedSubmissionHash,'rollback retained submission');
  if (oracle.currentSnapshot !== undefined && oracle.revision === undefined) expectValue(currentSnapshot,oracle.currentSnapshot,'snapshot absence');
  if (oracle.currentAssessment !== undefined && oracle.revision === undefined) expectValue(currentAssessment,oracle.currentAssessment,'assessment absence');
  if (oracle.absentRevision) {
    const absent = after.get(canonicalEvidenceJson([oracle.absentRevision.method,oracle.absentRevision.args]));
    ensure(absent?.error && absent.error.message.includes(oracle.absentRevision.expectedError),'Missing actual absent-revision error readback');
  }
  if (planned.method === 'evaluate' && !oracle.rollback && transactionDatetime !== undefined) expectValue(currentAssessment.assessed_at,transactionDatetime,'assessment transaction datetime');
  return {verified:true,rollbackVerified:oracle.rollback===true,deploymentZeroBaselineVerified:false};
}
export const HISTORICAL_TRANSACTIONS = Object.freeze([
  {
    "hash": "0x165cf7c5ec1034706c2b69495f362f814cee7feb91b3e2c95cc64561b4c5161b",
    "operation": "deploy",
    "role": "owner",
    "submittedAfterBlock": "216418",
    "contractAddress": "0x503b620680306533D43D57a859aB308eE9a9F7e1",
    "sourceFile": "contracts/archive/research_receipt_v1.py",
    "sourceSha256": "3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3",
    "classification": "historical-v1",
    "initialReadback": {
      "method": "get_order_count",
      "args": [],
      "expected": 0
    }
  },
  {
    "hash": "0x642326605fb1c629e1064f95dd6faafabb8a9440ccd31206647cbec05153ed4e",
    "operation": "create_order",
    "role": "owner",
    "submittedAfterBlock": "216437",
    "contractAddress": "0x503b620680306533D43D57a859aB308eE9a9F7e1",
    "sourceFile": "contracts/archive/research_receipt_v1.py",
    "sourceSha256": "3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3",
    "classification": "historical-v1"
  },
  {
    "hash": "0x15d3b833061b89ede1e5888b23a79d601d842f5d368f92d5a727a82dbbbf50e9",
    "operation": "submit_revision",
    "role": "owner",
    "submittedAfterBlock": "216456",
    "contractAddress": "0x503b620680306533D43D57a859aB308eE9a9F7e1",
    "sourceFile": "contracts/archive/research_receipt_v1.py",
    "sourceSha256": "3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3",
    "classification": "historical-v1"
  },
  {
    "hash": "0x9fa815aa73a7bac515811960bd9368e25958d5b43ae20f63d86b59cc05eeca3e",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "216496",
    "contractAddress": "0x503b620680306533D43D57a859aB308eE9a9F7e1",
    "sourceFile": "contracts/archive/research_receipt_v1.py",
    "sourceSha256": "3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3",
    "classification": "historical-v1"
  },
  {
    "hash": "0xc78c86d823ddc2e5a4f8ce459a9aa36e3ccdee566e482a1726b257588766ab81",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "216596",
    "contractAddress": "0x503b620680306533D43D57a859aB308eE9a9F7e1",
    "sourceFile": "contracts/archive/research_receipt_v1.py",
    "sourceSha256": "3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3",
    "classification": "historical-v1"
  },
  {
    "hash": "0x1923ca36b3db8874e03de50e728e3d2250b60eb5a30d67b792b2b1815ac2dd6c",
    "operation": "deploy",
    "role": "owner",
    "submittedAfterBlock": "216651",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2",
    "initialReadback": {
      "method": "get_order_count",
      "args": [],
      "expected": 0
    }
  },
  {
    "hash": "0x025e6c275b53d5d4fb9a34375a478b4d0355dbfbb8fba89c956f9e5afa301a81",
    "operation": "create_order",
    "role": "owner",
    "submittedAfterBlock": "216668",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0x4d276506bd6c03160386c552545dc127baa92d6a35cf32d32ce1cfb6b51b11db",
    "operation": "submit_revision",
    "role": "owner",
    "submittedAfterBlock": "216686",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0xd98baf35614086fbde25d844814dfb54079455ff2b1662dde532c3ee3923a23c",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "216723",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0x62f75af7f5d9950c9ba1bb8482746635ddf595939c277fffc085d3f28c248532",
    "operation": "submit_revision",
    "role": "owner",
    "submittedAfterBlock": "216746",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0x80ca07a9dc78451ba1fba1ce557a3f90fc7f2dd6a2c3928754c128570d101f2d",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "216777",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0x3dc9d06e19a67c1b175f42f5cdca3214fe38260e3c0c35fdf2e07b427d3311f6",
    "operation": "create_order",
    "role": "owner",
    "submittedAfterBlock": "216878",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0x69c09902573b7c147411b8d76e250ed2afc39b8027a55f56f44b979bf0ed5ee4",
    "operation": "submit_revision",
    "role": "owner",
    "submittedAfterBlock": "216915",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0x2b00f80e8046baf05ccfd8861ff9ef75bb4c6d05454882d39a2a78f99bfb4c19",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "216931",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0x13b8b97e11233d172466b19b4c88a8323ddab8ac0dfae5ce22e2ac2f48288c68",
    "operation": "create_order",
    "role": "owner",
    "submittedAfterBlock": "216984",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0x73fb585e610bf678975dfaf3c898c4d93646606fe4df7f6475b05dc93a6cb1d6",
    "operation": "submit_revision",
    "role": "owner",
    "submittedAfterBlock": "217003",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0xdadd4bab5ecae0f5344e4a495dc4adb408d66ee81632fb141d7830a934fa7c6a",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "217021",
    "contractAddress": "0xEE2F34aF1ef90938341a95B466769C92A96E61A8",
    "sourceFile": "contracts/archive/research_receipt_v2.py",
    "sourceSha256": "cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745",
    "classification": "historical-v2"
  },
  {
    "hash": "0x811fb897a3dc207b7a6b3e55f6c4b61c169aac0a555eaa93367a5db56bbe9a5c",
    "operation": "deploy",
    "role": "owner",
    "submittedAfterBlock": "217128",
    "contractAddress": "0x4e95cB64A0AD4fb443B0304dA850162BbEF7d973",
    "sourceFile": "contracts/archive/research_receipt_v4_f5a656.py",
    "sourceSha256": "f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61",
    "classification": "historical-v4",
    "initialReadback": {
      "method": "get_order_count",
      "args": [],
      "expected": 0
    }
  },
  {
    "hash": "0x0c11c9f25bc36f9cb8b0b0984e488ee1ba97919d4d0b743d7c088ce2df4c46b0",
    "operation": "create_order",
    "role": "owner",
    "submittedAfterBlock": "217152",
    "contractAddress": "0x4e95cB64A0AD4fb443B0304dA850162BbEF7d973",
    "sourceFile": "contracts/archive/research_receipt_v4_f5a656.py",
    "sourceSha256": "f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61",
    "classification": "historical-v4"
  },
  {
    "hash": "0xadda1aec9b57f5c872e0be112599cacc90e998ad436b6be02799ce84df84ec47",
    "operation": "submit_revision",
    "role": "owner",
    "submittedAfterBlock": "217172",
    "contractAddress": "0x4e95cB64A0AD4fb443B0304dA850162BbEF7d973",
    "sourceFile": "contracts/archive/research_receipt_v4_f5a656.py",
    "sourceSha256": "f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61",
    "classification": "historical-v4"
  },
  {
    "hash": "0x1d7706bced5cba28771e37252469039e312401b40be166fa5eacb91e1591aea8",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "217211",
    "contractAddress": "0x4e95cB64A0AD4fb443B0304dA850162BbEF7d973",
    "sourceFile": "contracts/archive/research_receipt_v4_f5a656.py",
    "sourceSha256": "f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61",
    "classification": "historical-v4"
  },
  {
    "hash": "0xe02c2548d34facec52dfef7e619d47e802f0c260311b9dcdd7b86e4deee53cad",
    "operation": "deploy",
    "role": "owner",
    "submittedAfterBlock": "217301",
    "contractAddress": "0x7825b6e308152e6B980142A0Ba2c34B95b104A58",
    "sourceFile": "contracts/research_receipt_source_probe.py",
    "sourceSha256": "54e47ed1ebd4c92832723e242dc86acf5d665a0b46a1b0bdc1611ca5d5b47a5d",
    "classification": "auxiliary-source-only-probe"
  },
  {
    "hash": "0xccbd92b3e0dc0787d2c528de8188b0c1ef0f4eebabfe24ec98a837be8c638ac2",
    "operation": "deploy",
    "role": "owner",
    "submittedAfterBlock": "217358",
    "contractAddress": "0xf8a4Ac4A0CdD72841513b536fed4690D14c18670",
    "sourceFile": "contracts/research_receipt_inline_probe.py",
    "sourceSha256": "ded346ad9d6b8f454401074b95b246e25526075cc809122726165ecf8d2ad75c",
    "classification": "auxiliary-inline-source-probe"
  },
  {
    "hash": "0x0211015cf386239dadbcb41dec60e8dc1a265cf73f27c705afa4ce396dc7518a",
    "operation": "deploy",
    "role": "owner",
    "submittedAfterBlock": "217520",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5",
    "initialReadback": {
      "method": "get_order_count",
      "args": [],
      "expected": 0
    }
  },
  {
    "hash": "0xdb894df1d306e84d053d5ea8618e58473fdb3ad196c905535374f7da8acdfd46",
    "operation": "create_order",
    "role": "owner",
    "submittedAfterBlock": "217553",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5"
  },
  {
    "hash": "0x235f47cdf8704e155cab141c10785a9283a2ad381fd2c4adee122d320baf6939",
    "operation": "submit_revision",
    "role": "owner",
    "submittedAfterBlock": "217571",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5"
  },
  {
    "hash": "0x18cd267e1499b06742f6cff09eb25d4fdecf854bc9da3b80de52c512127d650c",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "217584",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5"
  },
  {
    "hash": "0xbef35aebd0917ea069e1a90db2edbd7e190ede43bf362b74360b3283885dd417",
    "operation": "verify_evidence",
    "role": "owner",
    "submittedAfterBlock": "217623",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5"
  },
  {
    "hash": "0xe8460b11d05f26843d74d500a255e72f610eb3bb8e324be0e4c8841df021ba02",
    "operation": "verify_evidence",
    "role": "owner",
    "submittedAfterBlock": "217655",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5"
  },
  {
    "hash": "0x70e2502b568fd82f75e5b37daef56fca992bb86cf632edbc5bc2adb704a17e34",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "217680",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5"
  },
  {
    "hash": "0x823bc539f053b0081f7bc4b6543f83f0cc586f195285f66d7e92d8f86ad9f38e",
    "operation": "submit_revision",
    "role": "owner",
    "submittedAfterBlock": "217697",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5"
  },
  {
    "hash": "0x1af98bf8a6b394939a5bbc3b1fb6d1f53180fea5716f5db5129dfb6eb5a25927",
    "operation": "verify_evidence",
    "role": "owner",
    "submittedAfterBlock": "217734",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5"
  },
  {
    "hash": "0x016b18b61ec9f10c24299d5245c96778666b6a4e6c32a6382fb1dcc33ab41ba0",
    "operation": "evaluate",
    "role": "owner",
    "submittedAfterBlock": "217750",
    "contractAddress": "0xF21F4c3e49963a093F7e5b4De414f43E503f09B5",
    "sourceFile": "contracts/archive/research_receipt_v5_60b89e.py",
    "sourceSha256": "60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65",
    "classification": "historical-v5"
  }
]);

export const HISTORICAL_METADATA_SHA256 = sha(canonicalEvidenceJson(HISTORICAL_TRANSACTIONS));
export const HISTORICAL_UNDETERMINED = Object.freeze({
  '0x9fa815aa73a7bac515811960bd9368e25958d5b43ae20f63d86b59cc05eeca3e':'NO_MAJORITY',
  '0xc78c86d823ddc2e5a4f8ce459a9aa36e3ccdee566e482a1726b257588766ab81':'MAJORITY_DISAGREE',
  '0x80ca07a9dc78451ba1fba1ce557a3f90fc7f2dd6a2c3928754c128570d101f2d':'MAJORITY_DISAGREE',
  '0x2b00f80e8046baf05ccfd8861ff9ef75bb4c6d05454882d39a2a78f99bfb4c19':'MAJORITY_DISAGREE',
  '0x1d7706bced5cba28771e37252469039e312401b40be166fa5eacb91e1591aea8':'MAJORITY_DISAGREE',
  '0x016b18b61ec9f10c24299d5245c96778666b6a4e6c32a6382fb1dcc33ab41ba0':'MAJORITY_DISAGREE',
});

export function verifyHistoryAccounting(session,ledger,{separateWalletRun = false} = {}) {
  ensure(session.chainId===BRADBURY.chainId && session.genesisHash?.toLowerCase()===BRADBURY.genesisHash && sameAddress(session.actors?.owner,OWNER),'Public session network or owner mismatch');
  ensure(Array.isArray(session.transactions),'Missing public session history');
  const tracked = new Map();
  for (const row of session.transactions) { ensure(hash(row.hash) && !tracked.has(row.hash.toLowerCase()),'Duplicate tracked protocol hash');tracked.set(row.hash.toLowerCase(),row); }
  for (const old of HISTORICAL_TRANSACTIONS) {
    const row=tracked.get(old.hash.toLowerCase());
    ensure(row && row.operation===old.operation && row.role===old.role && String(row.submittedAfterBlock)===old.submittedAfterBlock,'Missing or altered historical metadata');
    if (old.operation==='deploy') ensure(row.sourceSha256===old.sourceSha256,'Changed historical deployment source');
    else ensure(sameAddress(row.address,old.contractAddress),'Changed historical contract assignment');
    if (old.initialReadback) ensure(row.readback?.method===old.initialReadback.method && String(row.readback.expected)==='0','Historical zero deployment baseline cannot be overwritten by latest nonzero state');
  }
  const current=new Map(ledger.attempts.filter(row=>hash(row.hash)).map(row=>[row.hash.toLowerCase(),row]));
  const oldHashes=new Set(HISTORICAL_TRANSACTIONS.map(row=>row.hash.toLowerCase()));
  if (separateWalletRun) {
    ensure(tracked.size===33 && [...tracked.keys()].every(id=>oldHashes.has(id)),'Frozen historical session must remain at 33 transactions without wallet-run mutation');
    for (const id of current.keys()) ensure(!oldHashes.has(id) && !tracked.has(id),'Historical or auxiliary transaction cannot satisfy a V6 case');
    return {historicalCount:33,historicalMetadataSha256:HISTORICAL_METADATA_SHA256,trackedCount:tracked.size,allTrackedDeclared:true,separateWalletRun:true,historicalSessionUnchanged:true};
  }
  for (const [id,row] of tracked) {
    if (oldHashes.has(id)) ensure(!current.has(id),'Historical or auxiliary transaction cannot satisfy a V6 case');
    else {
      const attempt=current.get(id);ensure(attempt,'Extra tracked transaction or undeclared same-input resampling');
      const planned=attempt.sequence===1?'deploy':null;
      ensure(row.role==='owner' || attempt.sequence===1,'Unexpected current session actor role');
      if (planned) ensure(row.operation==='deploy' && row.sourceSha256===DEPLOYMENT_SOURCE_SHA256,'Unexpected V6 deployment metadata');
    }
  }
  // A dedicated deployment transport signer may not append to the old owner
  // session. Its single explicit case-1 ledger row is audited independently.
  for (const [id,row] of current) ensure(tracked.has(id) || row.sequence===1 && ledger.transportAddendum,'Known V6 protocol hash missing from retained public session');
  return {historicalCount:33,historicalMetadataSha256:HISTORICAL_METADATA_SHA256,trackedCount:tracked.size,allTrackedDeclared:true};
}

function typedArgsEqual(actual,expected) {
  return Array.isArray(actual) && actual.length===expected.length && expected.every((value,index)=>typeof value==='number' ? Number.isSafeInteger(value) && (typeof actual[index]==='bigint'?actual[index]===BigInt(value):typeof actual[index]==='number' && actual[index]===value) : typeof value==='string' && typeof actual[index]==='string' && actual[index]===value);
}
function decodedTransaction(tx) {
  if (tx.txDataDecoded) return tx.txDataDecoded;
  ensure(typeof tx.tx_data==='string','Missing decoded transaction input');
  return decodeInputData(tx.tx_data.startsWith('0x')?tx.tx_data:'0x'+tx.tx_data,tx.recipient);
}
const emptyConstructor = value => value instanceof Map ? value.size===0 : value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===0;

export function verifyTransactionIdentity(inputs,planned,attempt,tx,release,{transportAddendum,historical} = {}) {
  const actualHash=tx.txId || tx.hash || tx.tx_id;
  ensure(typeof actualHash==='string' && actualHash.toLowerCase()===attempt.hash.toLowerCase(),'Wrong protocol hash returned');
  const planOwner=inputs?.plan?.actorCommitment?.actors?.owner?.toLowerCase() || OWNER;
  const actor=historical?OWNER:planned.sequence===1 && transportAddendum?transportAddendum.deploymentSender:planOwner;
  ensure(sameAddress(tx.sender,actor),'Wrong actor sender');
  ensure(sameAddress(tx.recipient,release.contractAddress),'Wrong contract recipient');
  const decoded=decodedTransaction(tx);
  ensure(decoded && decoded.leaderOnly===false,'Missing or enabled leader-only flag');
  const isDeploy=(historical?.operation ?? planned.op)==='deploy';
  if (isDeploy) {
    ensure(decoded.type==='deploy' && sameAddress(decoded.contractAddress,release.contractAddress),'Wrong deployed contract identity');
    ensure(typeof decoded.code==='string' && sha(Buffer.from(decoded.code,'utf8'))===release.sourceSha256,'Wrong actual deployed source hash');
    if (!historical) ensure(emptyConstructor(decoded.constructorArgs),'V6 deployment constructor must decode to an empty calldata object');
  } else {
    ensure(decoded.type==='call' && field(decoded.callData,'')===(historical?.operation ?? planned.method),'Wrong exact call method');
    if (!historical) {
      ensure(emptyConstructor(field(decoded.callData,'kwargs') ?? {}),'V6 call must not include unexpected keyword arguments');
      ensure(typedArgsEqual(field(decoded.callData,'args') ?? [],expectedCaseArgs(inputs.plan,inputs.fixture,planned)),'Wrong ABI-typed or byte-exact fixture arguments');
    }
  }
  return {sender:actor.toLowerCase(),recipient:release.contractAddress.toLowerCase(),operation:isDeploy?'deploy':field(decoded.callData,''),sourceSha256:release.sourceSha256,leaderOnly:false,argumentCommitment:isDeploy?sha('[]'):historical?null:sha(canonicalEvidenceJson(expectedCaseArgs(inputs.plan,inputs.fixture,planned)))};
}

export function transactionOutcome(tx,expectedExecution) {
  const final=tx.statusName==='FINALIZED',accepted=consensusAccepted(tx);
  return {status:tx.statusName || null,execution:tx.txExecutionResultName || null,consensusOutcome:tx.lifecycle?.outcome || null,consensusResult:tx.resultName || (tx.result===undefined?null:String(tx.result)),finalized:final,consensusAccepted:accepted,passed:final && accepted && tx.txExecutionResultName===`FINISHED_WITH_${expectedExecution}`};
}

// rc.2 returns on-chain Created as createdTimestamp, not a datetime member.
// The retained v5 assessment stores 2026-11-05T10:12:06Z for Created=1793873526;
// its currentTimestamp=1793873653 is a later observation and must not be used.
// Runtime time semantics: https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context
export function runtimeTransactionDatetime(tx) {
  const seconds=String(tx.createdTimestamp ?? '');
  ensure(decimal(seconds) && BigInt(seconds)<=8640000000000n,'Missing or invalid on-chain transaction creation timestamp');
  const value=new Date(Number(seconds)*1000).toISOString().replace('.000Z','Z');
  if(Object.hasOwn(tx,'datetime')) ensure(tx.datetime===value,'Unexpected datetime disagrees with on-chain creation timestamp');
  return value;
}

export function expectedGuardMessage(inputs,planned) {
  ensure(typeof planned.expectedError==='string' && planned.expectedError,'Missing frozen guard expectation');
  // Exact literal from the committed deployed source, selected by the frozen
  // plan fragment. Never search arbitrary transaction/debug fields for a match.
  const messages=[...new Set([...inputs.source.matchAll(/fail\((?:"([^"\\]*)"|'([^'\\]*)')\)/g)].map(match=>match[1]??match[2]))].filter(message=>message.includes(planned.expectedError));
  ensure(messages.length===1,'Frozen guard expectation does not resolve to one exact source error');
  return messages[0];
}

export function validateExpectedGuardError(inputs,planned,tx,stored) {
  ensure(stored && typeof stored==='object','Public stored execution output is unavailable');
  const normalize=value=>String(value||'').replaceAll('_','').toLowerCase();
  const round=Number(tx.lastRound?.round);
  ensure(Number.isSafeInteger(round) && round>=0 && round<=255 && stored.round===round,'Stored execution round identity mismatch');
  ensure(stored.id?.toLowerCase()===(tx.txId||tx.hash||tx.tx_id)?.toLowerCase() && sameAddress(stored.sender,tx.sender) && sameAddress(stored.recipient,tx.recipient) && hash(tx.txExecutionHash) && stored.txExecutionHash?.toLowerCase()===tx.txExecutionHash.toLowerCase(),'Stored execution transaction identity mismatch');
  ensure(typeof stored.txCallData==='string' && typeof tx.txCalldata==='string' && stored.txCallData.replace(/^0x/,'').toLowerCase()===tx.txCalldata.replace(/^0x/,'').toLowerCase(),'Stored execution call-data mismatch');
  ensure(normalize(stored.statusName)==='finalized' && stored.result===1 && stored.txExecutionResult===2 && normalize(stored.txExecutionResultName)==='finishedwitherror','Stored execution is not an accepted finalized error');
  ensure(String(stored.timestamps?.Created)===String(tx.createdTimestamp),'Stored creation timestamp identity mismatch');
  ensure(typeof stored.returnData==='string' && /^0x(?:[a-fA-F0-9]{2})+$/.test(stored.returnData) && stored.returnData.length<=8194,'Public stored UserError return bytes are absent');
  const bytes=Buffer.from(stored.returnData.slice(2),'hex');
  let decoded;
  try {decoded=abi.calldata.decode(bytes);} catch {throw new Error('Unsupported public UserError return encoding');}
  // Real GenVM stored errors are calldata maps: kind identifies the error
  // class, data is its own message. Never search backtraces or arbitrary fields.
  ensure(decoded instanceof Map && decoded.get('kind')==='UserError' && typeof decoded.get('data')==='string' && Buffer.from(abi.calldata.encode(decoded)).equals(bytes),'Stored result is not an exact calldata UserError map');
  const message=decoded.get('data');
  const expected=expectedGuardMessage(inputs,planned);
  ensure(message===expected,'Actual public guard error differs from the prelocked source error');
  return {verified:true,source:'gen_getTransactionData-stored-only',round,protocolTxId:stored.id,executionHash:stored.txExecutionHash,encoding:'genvm-calldata-user-error-map/1',ownUserError:message,returnDataSha256:sha(bytes),returnDataBytes:bytes.length};
}

const NEW_TRANSACTION = parseAbiItem('event NewTransaction(bytes32 indexed txId,address indexed recipient,address indexed activator)');
export async function verifyV6Inclusion(connection,attempt,release,actor,{inclusion=protocolInclusion} = {}) {
  const proof=await inclusion(connection,attempt.hash,attempt.submittedAfterBlock);
  ensure(proof?.verified===true && proof.event==='NewTransaction' && proof.protocolTxId?.toLowerCase()===attempt.hash.toLowerCase() && hash(proof.envelopeHash) && hash(proof.blockHash) && decimal(String(proof.blockNumber)) && Number.isSafeInteger(proof.logIndex),'Missing exact NewTransaction inclusion');
  if (attempt.envelopeHash) ensure(attempt.envelopeHash.toLowerCase()===proof.envelopeHash.toLowerCase(),'Envelope hash conflicts with ledger');
  const [receipt,envelope,block]=await Promise.all([
    connection.publicClient.getTransactionReceipt({hash:proof.envelopeHash}),
    connection.publicClient.getTransaction({hash:proof.envelopeHash}),
    connection.publicClient.getBlock({blockNumber:BigInt(proof.blockNumber)}),
  ]);
  const core=connection.metadata.addresses.ConsensusMain;
  ensure(receipt.status==='success' && receipt.transactionHash?.toLowerCase()===proof.envelopeHash.toLowerCase() && receipt.blockHash?.toLowerCase()===proof.blockHash.toLowerCase() && String(receipt.blockNumber)===String(proof.blockNumber) && block.hash?.toLowerCase()===proof.blockHash.toLowerCase(),'EVM receipt/block identity mismatch');
  ensure(envelope.hash?.toLowerCase()===proof.envelopeHash.toLowerCase() && sameAddress(envelope.to,core) && sameAddress(receipt.to,core) && sameAddress(envelope.from,actor),'EVM envelope target/actor differs from actual sealed core');
  const logs=receipt.logs.filter(row=>row.logIndex===proof.logIndex && !row.removed && sameAddress(row.address,core));
  ensure(logs.length===1,'Missing or duplicate actual-core event');
  const event=decodeEventLog({abi:[NEW_TRANSACTION],data:logs[0].data,topics:logs[0].topics,strict:true});
  ensure(event.eventName==='NewTransaction' && event.args.txId.toLowerCase()===attempt.hash.toLowerCase() && sameAddress(event.args.recipient,release.contractAddress),'Actual-core event names another protocol transaction or recipient');
  return {verified:true,protocolTxId:attempt.hash,envelopeHash:proof.envelopeHash,blockHash:proof.blockHash,blockNumber:String(proof.blockNumber),logIndex:proof.logIndex,event:'NewTransaction',coreAddress:core,envelopeTarget:envelope.to};
}

export function validateManualTransportProof(addendum,proof) {
  ensure(proof?.format==='research-receipt/v6-manual-gas-exact-call-proof/1' && proof.verified===true && proof.simulationOnly===true && proof.consensusProven===false && proof.ethCall?.success===true && !Object.hasOwn(proof,'error') && proof.ethCallRequestsStarted===1 && proof.signatures===0 && proof.chainTransactionsSent===0 && proof.modelCalls===0,'Missing explicit simulation-only exact call proof');
  const request=proof.deploymentRequest;
  exact(request,['chainId','from','to','data','value','nonce','gas','gasPrice','type'],'exact unsigned deployment request');
  ensure(request.chainId==='4221' && sameAddress(request.from,addendum.deploymentSender) && sameAddress(request.to,addendum.registryAddresses.ConsensusMain) && typeof request.data==='string' && /^0x[0-9a-fA-F]+$/.test(request.data) && decimal(request.value) && decimal(request.nonce) && request.gas===addendum.gasLimit && request.gasPrice===addendum.gasPriceWei && request.type==='legacy','Unsigned request differs from reviewed sender/core/caps');
  ensure(sha(canonicalEvidenceJson(request))===addendum.deploymentRequestHash,'Unsigned deployment request hash mismatch');
  ensure(BigInt(request.value)+BigInt(request.gas)*BigInt(request.gasPrice)===BigInt(addendum.maxTotalCostWei),'Manual deployment total does not include exact deposit and gas');
  for (const key of ['planSha256','sourceSha256','chainId','genesisHash','addressManager','registryAddresses','l2Endpoint','gasLimit','gasPriceWei','maxTotalCostWei','validUntil']) ensure(equal(proof[key],addendum[key]),`Manual proof/addendum mismatch: ${key}`);
  ensure(date(proof.verifiedAt) && decimal(String(proof.ethCall.blockNumber)) && hash(proof.ethCall.blockHash) && /^0x[0-9a-fA-F]{64}$/.test(proof.ethCall.result),'Invalid pinned eth_call proof');
  const quantity=value=>'0x'+BigInt(value).toString(16);
  expectValue(proof.ethCall.request,{from:request.from,to:request.to,data:request.data,value:quantity(request.value),gas:quantity(request.gas),gasPrice:quantity(request.gasPrice)},'six exact eth_call fields');
  ensure(proof.ethCall.response?.httpStatus>=200 && proof.ethCall.response.httpStatus<300 && proof.ethCall.response.body?.jsonrpc==='2.0' && proof.ethCall.response.body?.id===1 && !Object.hasOwn(proof.ethCall.response.body,'error') && proof.ethCall.response.body.result===proof.ethCall.result,'Unsuccessful or altered eth_call response');
  ensure(proof.nonceEvidence?.latest===request.nonce && proof.nonceEvidence.pending===request.nonce && proof.nonceEvidence.blockNumber===String(proof.ethCall.blockNumber) && proof.networkEvidence?.blockHash?.toLowerCase()===proof.ethCall.blockHash.toLowerCase() && proof.networkEvidence.registryCodeMatches===true && proof.networkEvidence.l2ChainId===4221 && proof.networkEvidence.l2GenesisHash===BRADBURY.genesisHash,'Manual proof network/nonce/pinned block mismatch');
  return request;
}

export function notCollectedEvidence({planFile = PLAN_FILE, planSha256 = PLAN_SHA256, executionRun, owner} = {}) {
  return {format:'research-receipt/bradbury-v6-e2e/1',policyVersion:POLICY,status:'NOT_COLLECTED',ready:false,allRequiredCasesPassed:false,suiteComplete:false,plan:{file:planFile,sha256:planSha256,...(executionRun?{executionRun}:{}),...(owner?{owner}:{})},requiredSignedCaseCount:51,expectedReturns:40,expectedErrors:11,historicalCommitment:{count:33,sha256:HISTORICAL_METADATA_SHA256},networkRequests:0,reason:'No V6 signed business proofs have been collected. Offline tests and transport simulations are not committee execution.'};
}

export async function collectV6Evidence(ledger,options = {},dependencies = {}) {
  ensure(options.ack===COLLECT_ACK,'Read-only network collection requires explicit ACK');
  const inputs=dependencies.inputs || await loadV6Inputs({requireArchivedEvidence:true,planFile:options.planFile || PLAN_FILE,planSha256:options.planSha256 || PLAN_SHA256,deploymentSourceSha256:options.deploymentSourceSha256 || DEPLOYMENT_SOURCE_SHA256});
  ensure(inputs.dependenciesComplete===true,'Real collection requires every archived dependency byte commitment');
  const isWalletRun=inputs.plan.executionAuthority==='user-controlled-wallet';
  if (isWalletRun) ensure(!ledger.transportAddendum && !options.transportAddendumSha256,'User-wallet run uses the locked wallet owner for all 51 cases; transport addendum is forbidden');
  let addendum,manualRequest,manualVerifiedAt;
  if (ledger.transportAddendum) {
    ensure(typeof options.transportAddendumSha256==='string' && options.transportAddendumSha256===ledger.transportAddendum.sha256,'Ledger cannot self-authorize a transport actor exception');
    const bytes=await localBytes(ledger.transportAddendum.file);
    addendum=validateTransportAddendum(JSON.parse(bytes),options.transportAddendumSha256,{rawBytes:bytes,contractAddress:ledger.release?.contractAddress});
    const proofBytes=await localBytes(addendum.manualProofFile);ensure(sha(proofBytes)===addendum.manualProofSha256,'Manual transport proof file hash mismatch');
    const proof=JSON.parse(proofBytes);manualRequest=validateManualTransportProof(addendum,proof);manualVerifiedAt=proof.verifiedAt;
  }
  validateV6Ledger(ledger,inputs,{transportAddendum:addendum});
  // Only public fields are read from this existing account file. No key access.
  const session=dependencies.session || JSON.parse(await localBytes(SESSION_FILE));
  const accounting=verifyHistoryAccounting(session,ledger,{separateWalletRun:isWalletRun});
  const connection=dependencies.connection || await connectBradbury();
  ensure(connection.metadata.chainId===BRADBURY.chainId && connection.metadata.genesisHash?.toLowerCase()===BRADBURY.genesisHash,'Collector connection identity mismatch');
  if (addendum) ensure(equal(connection.metadata.addresses,addendum.registryAddresses) && sameAddress(connection.metadata.addressManager,addendum.addressManager),'Fresh sealed registry differs from reviewed transport');
  const publicTransactions=[],caseProofs=[],failures=[],history=[];
  const collectTransaction = async (attempt,release,planned,historical) => {
    const tx=await connection.client.getTransaction({hash:attempt.hash});
    const identity=verifyTransactionIdentity(inputs,planned,attempt,tx,release,{transportAddendum:addendum,historical});
    const inclusion=await verifyV6Inclusion(connection,attempt,release,identity.sender,{inclusion:dependencies.inclusion || protocolInclusion});
    const outcome=transactionOutcome(tx,planned?.expectedTransaction.executionResult || 'RETURN');
    const row={protocolTxId:attempt.hash,sequence:planned?.sequence || null,caseName:planned?.name || null,classification:historical?.classification || 'v6-business-case',...identity,...outcome,inclusion};
    publicTransactions.push(row);return {tx,row};
  };
  // Historical failures are audited under their original profile, never counted
  // as V6 successes or discarded merely because a new source is selected.
  for (const old of HISTORICAL_TRANSACTIONS) {
    try {
      const {row}=await collectTransaction(old,{contractAddress:old.contractAddress,sourceSha256:old.sourceSha256},null,old);
      const expectedUndetermined=HISTORICAL_UNDETERMINED[old.hash.toLowerCase()];
      ensure(row.finalized && (expectedUndetermined ? row.consensusOutcome==='undetermined' && row.consensusResult===expectedUndetermined : row.consensusAccepted),'Historical consensus outcome changed or is not final');
      history.push({...row,historicalVerified:true,passedBusinessCase:false,...(old.initialReadback?{archivedInitialReadback:old.initialReadback,latestStateUsedToReplaceInitialBaseline:false}:{})});
    } catch (error) { history.push({protocolTxId:old.hash,classification:old.classification,historicalVerified:false,error:safeError(error)}); }
  }
  let previousBlock=-1n,previousFinalizedAt=null,firstGatePassed=false;
  const immutable=new Map();
  for (const attempt of ledger.attempts) {
    const planned=inputs.plan.cases[attempt.sequence-1];
    if (!hash(attempt.hash)) { caseProofs.push({sequence:attempt.sequence,name:attempt.name,state:attempt.state,passed:false,protocolTxId:null});continue; }
    try {
      const {tx,row}=await collectTransaction(attempt,ledger.release,planned);
      ensure(row.passed,`Case did not finalize with accepted ${planned.expectedTransaction.executionResult}`);
      ensure(BigInt(row.inclusion.blockNumber)>previousBlock,'Case protocol inclusion is not strictly causal');
      ensure(previousFinalizedAt===null || Date.parse(attempt.submittedAt)>=Date.parse(previousFinalizedAt),'Case submitted before preceding finalized observation');
      previousBlock=BigInt(row.inclusion.blockNumber);previousFinalizedAt=attempt.finalizedAt;
      if (attempt.sequence>13) ensure(firstGatePassed,'Remaining cases attempted without an independently verified first-13 gate');
      if (attempt.sequence===1 && addendum) {
        ensure(Date.parse(addendum.reviewedAt)<=Date.parse(attempt.submittedAt) && BigInt(Date.parse(attempt.submittedAt))<=BigInt(addendum.validUntil)*1000n && Date.parse(attempt.submittedAt)>=Date.parse(manualVerifiedAt) && Date.parse(attempt.submittedAt)-Date.parse(manualVerifiedAt)<=600000,'Deployment actor review or exact-call proof was late, expired or stale');
        const envelope=await connection.publicClient.getTransaction({hash:row.inclusion.envelopeHash});
        const actual={chainId:String(envelope.chainId),from:envelope.from.toLowerCase(),to:envelope.to.toLowerCase(),data:envelope.input,value:String(envelope.value),nonce:String(envelope.nonce),gas:String(envelope.gas),gasPrice:String(envelope.gasPrice),type:envelope.type};
        expectValue(actual,manualRequest,'actual reviewed deployment envelope');
      }
      let errorEvidence;
      if(planned.expectedTransaction.executionResult==='ERROR') {
        const round=Number(tx.lastRound?.round);ensure(Number.isSafeInteger(round)&&round>=0&&round<=255,'Missing actual error execution round');
        // Official API guarantees stored outputs only and never replays:
        // https://docs.genlayer.com/api-references/genlayer-node/gen/gen_getTransactionData
        const stored=dependencies.storedData?await dependencies.storedData(tx,round):await connection.publicClient.request({method:'gen_getTransactionData',params:[{txId:attempt.hash,round}]});
        errorEvidence=validateExpectedGuardError(inputs,planned,tx,stored);
      }
      const transactionDatetime=planned.method==='evaluate'&&!planned.readbackOracle.rollback?runtimeTransactionDatetime(tx):undefined;
      const readback=await validateCaseReadbacks(inputs,planned,attempt,{transactionDatetime});
      for (const read of attempt.afterReads) if (['get_revision','get_evidence_snapshot','get_assessment'].includes(read.method) && read.value!==undefined && read.value!=='' && read.value!==null) {
        const key=canonicalEvidenceJson([read.method,read.args]);
        if (immutable.has(key)) expectValue(read.value,immutable.get(key),'old revision/snapshot/assessment changed');
        else immutable.set(key,read.value);
      }
      caseProofs.push({sequence:attempt.sequence,name:attempt.name,state:attempt.state,protocolTxId:attempt.hash,passed:attempt.state==='confirmed',...readback,...(errorEvidence?{errorEvidence}:{})});
      if (attempt.sequence===13) firstGatePassed=caseProofs.length===13 && caseProofs.every(item=>item.passed);
    } catch (error) { failures.push({sequence:attempt.sequence,name:attempt.name,protocolTxId:attempt.hash,error:safeError(error)});caseProofs.push({sequence:attempt.sequence,name:attempt.name,state:attempt.state,protocolTxId:attempt.hash,passed:false}); }
  }
  const freshReads=[],freshOrders=[];
  const read = async (method,args=[]) => {
    const value=await connection.client.readContract({address:ledger.release.contractAddress,functionName:method,args,transactionHashVariant:'latest-final'});
    freshReads.push({method,args,variant:'latest-final',value});return parsed(value);
  };
  let latestFinalVerified=false;
  if (ledger.attempts.length===51 && caseProofs.every(item=>item.passed)) {
    try {
      expectValue(await read('get_order_count'),9,'fresh final nine orders');
      expectValue(await read('get_policy_version'),POLICY,'fresh policy');expectValue(await read('get_field_catalog'),inputs.catalog,'fresh full catalog');
      for (let id=1;id<=9;id++) {
        const order=await read('get_order',[id]);
        const expectedCount=Math.max(0,...inputs.plan.expected.filter(row=>row.orderId===id).map(row=>row.revision));
        ensure(order.id===id && order.revision_count===expectedCount && order.revision_count<=5,'Fresh order identity/revision bound');
        const creates=inputs.plan.cases.find(row=>row.method==='create_order' && !row.readbackOracle.rollback && row.readbackOracle.orderId===id);
        expectValue(order.spec_hash,creates.readbackOracle.specHash,'fresh prelocked spec mapping');
        expectValue(await read('get_order_id',[inputs.fixture[creates.inputCase].client_ref]),id,'fresh client_ref mapping');
        const revisions=[];
        for(let number=1;number<=order.revision_count;number++) {
          const revision=await read('get_revision',[id,number]),snapshot=await read('get_evidence_snapshot',[id,number]),assessment=await read('get_assessment',[id,number]);
          await validateEvidenceSnapshot({order,revision,snapshot,assessment,expectedRevision:number});
          for (const [method,value] of [['get_revision',revision],['get_evidence_snapshot',snapshot],['get_assessment',assessment]]) {
            const old=immutable.get(canonicalEvidenceJson([method,[id,number]]));ensure(old!==undefined,'Fresh revision absent from causal ledger');expectValue(parsed(old),value,'fresh immutable history');
          }
          const expected=inputs.plan.expected.find(row=>row.orderId===id && row.revision===number);ensure(expected,'Unexpected extra fresh revision');
          expectValue(assessmentProjection(assessment),expected.assessment.projection,'fresh full projection');
          revisions.push({number,revision,snapshot,assessment});
        }
        freshOrders.push({order,revisions});
      }
      latestFinalVerified=true;
    } catch(error) {failures.push({stage:'fresh-final-readback',error:safeError(error)});}
  }
  const allRequiredCasesPassed=caseProofs.length===51 && caseProofs.every(row=>row.passed) && firstGatePassed && latestFinalVerified && history.length===33 && history.every(row=>row.historicalVerified) && ledger.attempts.every(row=>row.state==='confirmed');
  const baseEvidence=notCollectedEvidence({planFile:inputs.planFile || PLAN_FILE,planSha256:inputs.planSha256 || PLAN_SHA256,executionRun:inputs.plan.executionRun,owner:isWalletRun?inputs.plan.actorCommitment.actors.owner.toLowerCase():undefined});
  const reason=allRequiredCasesPassed?'All 51 prelocked V6 signed business cases collected and verified against Bradbury Phase 2 finality, consensus, and readback commitments.':'V6 signed business proof collection is incomplete or encountered verification failures.';
  return {...baseEvidence,reason,generatedAt:new Date().toISOString(),status:allRequiredCasesPassed?'COLLECTED':'INCOMPLETE',networkRequests:'READ_ONLY_COLLECTION_PERFORMED',ready:allRequiredCasesPassed,allRequiredCasesPassed,suiteComplete:allRequiredCasesPassed,release:ledger.release,transportAddendum:addendum || null,dependenciesComplete:inputs.dependenciesComplete,commitments:inputs.commitments,firstGatePassed,latestFinalVerified,historyAccounting:accounting,historicalTransactions:history,transactions:publicTransactions,cases:caseProofs,transportFailures:ledger.transportFailures.map(row=>({intentId:row.intentId,stage:row.stage,sourceSha256:row.sourceSha256,nonceBefore:String(row.nonceBefore),nonceAfter:String(row.nonceAfter),protocolHash:null,envelopeHash:null,reasonCode:row.reasonCode})),failures,orders:freshOrders,reads:freshReads,limits:['No model traces or private validator reasons collected.','eth_call transport proofs do not establish committee success.','Historical initial zero-baseline observations are archived; latest nonzero state never replaces them.']};
}

async function main() {
  const args=process.argv.slice(2);
  if (!args.includes('--collect')) {
    const inputs=await loadV6Inputs();
    console.log(JSON.stringify({...notCollectedEvidence(),dependenciesComplete:inputs.dependenciesComplete,missingArchivedEvidence:inputs.missingArchivedEvidence,commitments:inputs.commitments,selfTest:args.includes('--self-test')?(inputs.dependenciesComplete?'LOCAL_COMMITMENTS_VERIFIED':'AVAILABLE_LOCAL_COMMITMENTS_VERIFIED'):undefined},null,2));return;
  }
  ensure(process.env.RESEARCH_RECEIPT_V6_COLLECT_ACK===COLLECT_ACK,'Set explicit RESEARCH_RECEIPT_V6_COLLECT_ACK for read-only collection');
  const option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
  const ledger=JSON.parse(await localBytes(option('--ledger') || LEDGER_FILE));
  const evidence=await collectV6Evidence(ledger,{ack:COLLECT_ACK,transportAddendumSha256:option('--transport-addendum-sha')});
  const output=resolve(PROJECT_ROOT,OUTPUT_FILE);await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({output:OUTPUT_FILE,status:evidence.status,ready:evidence.ready,passed:evidence.cases.filter(row=>row.passed).length,required:51,retainedHistory:evidence.historicalTransactions.length}));
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{console.error(safeError(error));process.exitCode=1;});
