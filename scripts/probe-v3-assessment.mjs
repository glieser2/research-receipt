// Diagnostic deploy simulation. Never signs, sends a transaction, or changes business state.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { abi, decodeInputData } from 'genlayer-js';
import { PROJECT_ROOT, projectFile, contractSource, connectBradbury, publicJson } from './bradbury-client.mjs';
import { sha256, publicResponse, publicError } from './probe-public-codec.mjs';
const ZERO = '0x0000000000000000000000000000000000000000';
const ACTOR = '0x29EB14D10ec2E406E5d1419ED08D803b8B18aB70';
const PLAN = 'docs/evidence/v3-validation-plan.json';
const VERSION = 'research-receipt-v3-probe/1';
const support = `
# Diagnostic wrappers only: values returned to the original helper are unchanged.
def probe_v3_emit(phase, stage, **values):
    print("RR_V3_PROBE_JSON " + json.dumps({"probe_version": "research-receipt-v3-probe/1", "phase": phase, "stage": stage, **values}, sort_keys=True, separators=(",", ":")))


def probe_v3_error_type(error):
    name = type(error).__name__
    return name if name in ("UserError", "ValueError", "TypeError", "KeyError", "UnicodeError", "JSONDecodeError", "Forbidden", "BudgetExceeded") else "OTHER_EXCEPTION"


def probe_v3_web(metrics, phase, index, expected_byte_length, *args, **kwargs):
    metrics["web_calls"] += 1
    probe_v3_emit(phase, "source_begin", index=index, expected_byte_length=expected_byte_length)
    try:
        response = gl.nondet.web.request(*args, **kwargs)
        body = response.body
        if isinstance(body, bytes):
            probe_v3_emit(phase, "source_bytes", index=index, byte_length=len(body), sha256=hashlib.sha256(body).hexdigest())
        return response
    except Exception as error:
        probe_v3_emit(phase, "source_exception", index=index, error_type=probe_v3_error_type(error))
        raise


def probe_v3_prompt(metrics, phase, criterion, claim, materials, *args, **kwargs):
    metrics["model_calls"] += 1
    if "FORMAT_REPAIR_ERROR_CODE:" in args[0]:
        metrics["format_repairs"] += 1
    probe_v3_emit(phase, "model_begin", criterion_id=criterion["id"], **metrics)
    try:
        result = gl.nondet.exec_prompt(*args, **kwargs)
    except Exception as error:
        probe_v3_emit(phase, "model_exception", criterion_id=criterion["id"], error_type=probe_v3_error_type(error), **metrics)
        raise
    # Pure normalization is repeated for observation only, with no changed response.
    finding, error_code = decode_model_finding(result, criterion, claim, materials)
    probe_v3_emit(phase, "model_shape", criterion_id=criterion["id"], error_code=error_code,
                  status=finding["status"] if finding else None,
                  delivery_status=finding["delivery_status"] if finding else None,
                  evidence_indices=finding["evidence_indices"] if finding else None,
                  reason_bytes=len(finding["reason"].encode("utf-8")) if finding else None, **metrics)
    return result


`;
const ctor = `
class ResearchReceiptV3Probe(gl.contract.Contract):
    """Read-only deployment simulation diagnostic; never application acceptance."""
    def __init__(self, spec_json: str, submission_json: str, case_id: str):
        spec = normalize_spec(spec_json)
        submission = normalize_submission(submission_json, spec)
        probe_v3_emit("constructor", "fixture", case_id=case_id, spec_hash=digest(spec), submission_hash=digest(submission), content_hash=content_fingerprint(submission))

        def leader_fn():
            probe_v3_emit("leader", "begin", case_id=case_id)
            return probe_v3_assessment(spec, submission, "leader")

        def validator_fn(leader_result) -> bool:
            probe_v3_emit("validator", "begin", case_id=case_id)
            if not isinstance(leader_result, gl.vm.Return):
                probe_v3_emit("validator", "leader_type_invalid")
                return False
            try:
                validate_assessment(leader_result.calldata, spec, submission)
                probe_v3_emit("validator", "leader_validated", projection=stable_projection(leader_result.calldata))
                independent = probe_v3_assessment(spec, submission, "validator")
                same = stable_projection(leader_result.calldata) == stable_projection(independent)
                probe_v3_emit("validator", "comparison", equal=same)
                return same
            except Exception as error:
                probe_v3_emit("validator", "exception", error_type=probe_v3_error_type(error))
                return False

        result = validate_assessment(gl.vm.run_nondet_default(leader_fn, validator_fn), spec, submission)
        probe_v3_emit("constructor", "complete", case_id=case_id, verdict=result["verdict"])
`;
function replaceOnce(value, from, to) {
  assert.equal(value.split(from).length - 1, 1, `Expected one exact instrumentation site: ${from.slice(0,80)}`);
  return value.replace(from,to);
}
export function buildProbe(code) {
  const boundary = 'class ResearchReceipt(gl.contract.Contract):';
  assert.equal(code.split(boundary).length,2,'Expected exact production class boundary');
  const prefix = code.split(boundary)[0];
  const start = prefix.indexOf('def independent_assessment(spec, submission):');
  const end = prefix.indexOf('def stable_projection(assessment):', start);
  assert.ok(start >= 0 && end > start,'Frozen source helper boundaries unavailable');
  const original = prefix.slice(start,end);
  const replacements = [
    ['def independent_assessment(spec, submission):','def probe_v3_assessment(spec, submission, phase):'],
    ['    checks = []','    metrics = {"model_calls": 0, "web_calls": 0, "format_repairs": 0}\n    checks = []'],
    ['gl.nondet.web.request(source["url"], method="GET")','probe_v3_web(metrics, phase, index, source["byte_length"], source["url"], method="GET")'],
    ['        checks.append(check)','        checks.append(check)\n        probe_v3_emit(phase, "source_check", **check)'],
    ['gl.nondet.exec_prompt(prompt, response_format="json")','probe_v3_prompt(metrics, phase, criterion, claim, materials, prompt, response_format="json")'],
    ['gl.nondet.exec_prompt(repair_prompt, response_format="json")','probe_v3_prompt(metrics, phase, criterion, claim, materials, repair_prompt, response_format="json")'],
    ['    return {"findings": findings, "source_checks": checks, "verdict": aggregate_verdict(spec, findings)}','    result = {"findings": findings, "source_checks": checks, "verdict": aggregate_verdict(spec, findings)}\n    probe_v3_emit(phase, "independent_complete", projection=stable_projection(result), **metrics)\n    return result'],
  ];
  let instrumented = original;
  for (const [from,to] of replacements) instrumented = replaceOnce(instrumented,from,to);
  let recovered = instrumented;
  for (const [from,to] of [...replacements].reverse()) recovered = replaceOnce(recovered,to,from);
  assert.equal(recovered, original,'Instrumentation must reverse exactly to production helper');
  return { code: prefix+support+instrumented+ctor, prefixSha256: sha256(prefix), independentHelperSha256: sha256(original), recoveredHelperSha256: sha256(recovered), instrumentedHelperSha256: sha256(instrumented), reversibleSites: replacements.length };
}
export function deploymentData(code, args) {
  const data = abi.transactions.serialize([code,abi.calldata.encode(abi.calldata.makeCalldataObject(undefined,args)),false]);
  const decoded = decodeInputData(data,ZERO);
  assert.equal(decoded.type,'deploy'); assert.equal(decoded.code,code);
  assert.deepEqual(decoded.constructorArgs instanceof Map ? decoded.constructorArgs.get('args') : decoded.constructorArgs.args,args);
  return data;
}
export function caseResult(item, leader, validator) {
  const completed = (view,phase) => view?.markers?.filter(marker => marker.phase === phase && marker.stage === 'independent_complete') || [];
  const lm = completed(leader,'leader'), vm = completed(validator,'validator');
  const expected = marker => marker && marker.projection?.verdict === item.verdict && JSON.stringify(marker.projection.findings.map(f=>f.status)) === JSON.stringify(item.statuses) && JSON.stringify(marker.projection.findings.map(f=>f.delivery_status)) === JSON.stringify(item.delivery) && marker.projection.source_checks.every(check => item.id === 'hashMismatch' ? ['HASH_MISMATCH','VERIFIED'].includes(check.status) : check.status === 'VERIFIED') && marker.model_calls <= 5 && marker.format_repairs <= 1 && (item.modelCalls === undefined || marker.model_calls === item.modelCalls);
  const comparison = validator?.markers?.find(marker => marker.phase === 'validator' && marker.stage === 'comparison');
  return { passed: leader?.status?.code === 0 && validator?.status?.code === 0 && validator?.nondetDisagreementCallNo == null && lm.length === 1 && vm.length === 1 && expected(lm[0]) && expected(vm[0]) && comparison?.equal === true && JSON.stringify(lm[0].projection) === JSON.stringify(vm[0].projection), leaderProjection: lm[0]?.projection ?? null, validatorProjection: vm[0]?.projection ?? null, leaderModelCalls: lm[0]?.model_calls ?? null, validatorModelCalls: vm[0]?.model_calls ?? null };
}
async function loadDraft(frozen,planFile) {
  const planBytes = await readFile(await projectFile(planFile,'.json')), plan = JSON.parse(planBytes);
  assert.ok(['research-receipt/3','research-receipt/4'].includes(plan.policyVersion),'Unsupported business policy for this diagnostic');
  const fixtureBytes = await readFile(await projectFile(plan.fixtureFile,'.json')), fixture = JSON.parse(fixtureBytes);
  assert.equal(sha256(fixtureBytes),plan.fixtureSha256,'Fixture no longer matches prelocked plan');
  const sourceFile = typeof plan.sourceCommitment === 'object' && plan.sourceCommitment?.file ? plan.sourceCommitment.file : 'contracts/research_receipt.py';
  const source = await contractSource(sourceFile);
  assert.ok(source.code.includes(`POLICY_VERSION = "${plan.policyVersion}"`),'Business source and plan policy must agree');
  const committedSource = typeof plan.sourceCommitment === 'string' ? plan.sourceCommitment : plan.sourceCommitment?.sha256;
  if (frozen) assert.equal(source.sourceSha256,committedSource,'Source must be explicitly frozen in the prelocked plan');
  const probe = buildProbe(source.code);
  return { plan, fixture, source, sourceFile, probe, committedSource, planFile, planSha256: sha256(planBytes), fixtureSha256: sha256(fixtureBytes) };
}
export async function writePublicSemanticSummary() {
  const releases = [
    {policyVersion:'research-receipt/3',source:'19d6cd9a6ac04328f50236922fad9985aead47b3db215ca847dd854e216d241e',archive:'contracts/archive/research_receipt_v3_candidate_19d6.py',fixture:'artifacts/bradbury/v3-e2e-input.json',plan:'docs/evidence/v3-validation-plan.json',cases:[['negative','negative-network-restored']]},
    {policyVersion:'research-receipt/4',source:'f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61',archive:'contracts/archive/research_receipt_v4_f5a656.py',fixture:'artifacts/bradbury/v4-e2e-input.json',plan:'docs/evidence/v4-validation-plan.json',cases:[['negative','negative'],['positive','positive'],['strictUnknown','strictUnknown']]},
  ];
  const pickProjection = projection => projection ? {verdict:projection.verdict,findings:projection.findings.map(item=>({criterion_id:item.criterion_id,status:item.status,delivery_status:item.delivery_status,evidence_indices:item.evidence_indices})),source_checks:projection.source_checks.map(item=>({index:item.index,status:item.status,sha256:item.sha256}))}:null;
  const entries=[];
  for(const release of releases) {
    const source=await contractSource(release.archive);assert.equal(source.sourceSha256,release.source);
    const fixtureBytes=await readFile(await projectFile(release.fixture,'.json'));
    const planBytes=await readFile(await projectFile(release.plan,'.json'));
    for(const [caseId,suffix]of release.cases) {
      const artifact=`artifacts/bradbury/${release.policyVersion.endsWith('/4')?'v4-probe':'v3-probe'}/${release.source}-${suffix}.json`;
      let bytes;try{bytes=await readFile(await projectFile(artifact,'.json'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
      const report=JSON.parse(bytes);
      assert.ok(report.completedAt,'An in-flight model attempt cannot be summarized as complete');
      assert.equal(report.businessSourceSha256,release.source);assert.equal(report.fixtureSha256,sha256(fixtureBytes));assert.equal(report.planSha256,sha256(planBytes));
      const phases={};
      for(const phase of ['leader','validator']) {
        const view=report[phase], complete=view?.markers?.find(item=>item.phase===phase&&item.stage==='independent_complete');
        const fixture=view?.markers?.find(item=>item.phase==='constructor'&&item.stage==='fixture');
        phases[phase]={vmStatusCode:view?.status?.code??null,inputCommitments:fixture?{specHash:fixture.spec_hash,submissionHash:fixture.submission_hash,contentHash:fixture.content_hash}:null,projection:pickProjection(complete?.projection),execPromptCalls:complete?.model_calls??null,webRequestCalls:complete?.web_calls??null,formatRepairs:complete?.format_repairs??null};
      }
      const comparison=report.validator?.markers?.find(item=>item.phase==='validator'&&item.stage==='comparison');
      entries.push({businessPolicyVersion:release.policyVersion,sourceArchive:release.archive,sourceSha256:release.source,fixtureFile:release.fixture,fixtureSha256:sha256(fixtureBytes),planFile:release.plan,planSha256:sha256(planBytes),probeSourceSha256:report.probeSourceSha256,caseId,startedAt:report.startedAt,completedAt:report.completedAt,rawArtifact:{file:artifact,sha256:sha256(bytes),published:false},genCallRequestsStarted:report.genCallsStarted??report.captures.length,capturedResponses:report.captures.length,...phases,validatorReturnedBool:typeof comparison?.equal==='boolean'?comparison.equal:null,nondetDisagreementCallNo:report.validator?.nondetDisagreementCallNo??null,matchedPrelockedOracleAndFullComparison:report.result?.passed===true});
    }
  }
  const preflightFile='artifacts/bradbury/v3-probe/19d6cd9a6ac04328f50236922fad9985aead47b3db215ca847dd854e216d241e-negative.json';
  const releaseFile=preflightFile.replace(/\.json$/,'-preflight-release.json');
  const preflight=await readFile(await projectFile(preflightFile,'.json')),audit=await readFile(await projectFile(releaseFile,'.json'));
  assert.equal(JSON.parse(audit).originalArtifactSha256,sha256(preflight));
  const reasonFile='artifacts/bradbury/v3-probe/19d6cd9a6ac04328f50236922fad9985aead47b3db215ca847dd854e216d241e-negative-public-leader-reasons.json';
  const reasonBytes=await readFile(await projectFile(reasonFile,'.json')),reasons=JSON.parse(reasonBytes);
  const summary={format:'research-receipt/public-semantic-simulations/1',generatedAt:new Date().toISOString(),method:'Official public Bradbury gen_call type=deploy, one leader call and its opaque leaderPublicData supplied to one validator call per executed case. No signed or on-chain transaction.',chainTransactionsSent:0,executedPairs:entries.length,genCallRequestsStarted:entries.reduce((total,item)=>total+item.genCallRequestsStarted,0),execPromptCalls:entries.reduce((total,item)=>total+(item.leader.execPromptCalls||0)+(item.validator.execPromptCalls||0),0),simulations:entries,preflightFailures:[{category:'SANDBOX_NETWORK_EACCES_BEFORE_CONNECT_COMPLETED',genCallRequestsStarted:0,execPromptCalls:0,countedAsModelAttempt:false,artifact:{file:preflightFile,sha256:sha256(preflight)},explicitZeroCallRecoveryAudit:{file:releaseFile,sha256:sha256(audit)}}],publicLeaderRationales:{policyVersion:'research-receipt/3',caseId:'negative',source:'Existing public leaderPublicData nd_outs[0], resultCode=0; these are public finding.reason strings, not hidden reasoning.',rawExtraction:{file:reasonFile,sha256:sha256(reasonBytes)},findings:reasons.findings.filter(item=>['permissions','limitations'].includes(item.criterion_id)).map(item=>({criterion_id:item.criterion_id,status:item.status,reason:item.reason}))},limitations:['These are read-only deployment simulations, not deployed contracts, EVM inclusion proofs, or actual multi-validator committee consensus.','No explicit time-unit allocation was requested; these simulations do not calibrate the 600-TU transaction fee profile.','Actual provider/model identity, provider caching/fallback behavior and private validator configuration are unknown.','Counts are observable contract exec_prompt invocations, not provider billing, token accounting, or proof of uncached upstream generations.','Only the explicitly executed cases are reported. No general accuracy, reliability percentage, or unseen-case claim is made.','V3 failure is retained; no oracle label was changed after its result. V4 is a separately frozen structured-input design, not a rerun of modified V3 evidence.','Raw opaque leaderPublicData, raw response bodies and debug logs remain excluded from this public summary.']};
  await writeFile(resolve(PROJECT_ROOT,'docs/evidence/public-semantic-simulations.json'),JSON.stringify(summary,null,2)+'\n');
  return summary;
}
async function main() {
  if(process.argv.includes('--public-summary')) {const summary=await writePublicSemanticSummary();console.log(JSON.stringify({file:'docs/evidence/public-semantic-simulations.json',executedPairs:summary.executedPairs,genCallRequestsStarted:summary.genCallRequestsStarted,execPromptCalls:summary.execPromptCalls,chainTransactionsSent:0}));return;}
  const run = process.argv.includes('--run'), selfTest = process.argv.includes('--self-test');
  const planFile = process.argv.find(arg=>arg.startsWith('--plan='))?.slice(7) || PLAN;
  const prepared = await loadDraft(!selfTest,planFile);
  const { plan,fixture,source,probe } = prepared;
  const dir = resolve(PROJECT_ROOT,plan.policyVersion === 'research-receipt/4' ? 'artifacts/bradbury/v4-probe' : 'artifacts/bradbury/v3-probe'); await mkdir(dir,{recursive:true});
  const codeFile = resolve(dir,`probe-${source.sourceSha256}.py`); await writeFile(codeFile,probe.code);
  for (const item of plan.expected) deploymentData(probe.code,[JSON.stringify(fixture[item.spec]),JSON.stringify(fixture[item.submission]),item.id]);
  const metadata = { format: VERSION, diagnosticOnly: true, chainTransactionsSent: 0, businessPolicyVersion:plan.policyVersion, businessSourceFile:prepared.sourceFile, sourceFrozen: source.sourceSha256 === prepared.committedSource, businessSourceSha256: source.sourceSha256, fixtureSha256: prepared.fixtureSha256, planFile, planSha256: prepared.planSha256, probeSourceSha256: sha256(probe.code), helperExtraction: { prefixSha256:probe.prefixSha256, original:probe.independentHelperSha256,recovered:probe.recoveredHelperSha256,instrumented:probe.instrumentedHelperSha256,reversibleSites:probe.reversibleSites }, cases:plan.expected.map(item=>item.id), limitations:['Read-only gen_call deploy simulation is not a deployed contract or real multi-validator committee result.','The request does not specify time-unit allocation; results do not calibrate the 600-TU transaction fee profile.','Actual provider/model identity is not exposed by the public response.'] };
  if (selfTest) {
    const child = spawnSync('python',['tests/python/probe_v3_stub.py',codeFile,await projectFile(plan.fixtureFile,'.json'),await projectFile(planFile,'.json')],{cwd:PROJECT_ROOT,encoding:'utf8'});
    assert.equal(child.status,0,child.stderr || child.stdout);
    console.log(publicJson({...metadata,offlineStub:JSON.parse(child.stdout),networkRequests:0,limitation:'Controlled model outputs test instrumentation/control flow, not semantic accuracy or consensus.'})); return;
  }
  await writeFile(resolve(dir,`prepared-${source.sourceSha256}.json`),`${publicJson(metadata)}\n`);
  if (!run) { console.log(publicJson({...metadata,networkRequests:0})); return; }
  assert.equal(process.env.RR_V3_PROBE_ACK,source.sourceSha256,'Explicit root-approved frozen source acknowledgement required');
  const id = process.argv.find(arg=>arg.startsWith('--case='))?.slice(7), item = plan.expected.find(entry=>entry.id===id);
  assert.ok(item && ['positive','negative','strictUnknown'].includes(id),'Only one explicitly selected authorized model case per invocation');
  const initialOutput = resolve(dir,`${source.sourceSha256}-${id}.json`);
  let output = initialOutput, preflightRelease = null;
  if (process.argv.includes('--restore-preflight')) {
    const initialBytes = await readFile(initialOutput);
    preflightRelease = JSON.parse(await readFile(resolve(dir,`${source.sourceSha256}-${id}-preflight-release.json`),'utf8'));
    assert.equal(preflightRelease.originalArtifactSha256,sha256(initialBytes));
    assert.equal(preflightRelease.confirmedGenCallsStarted,0); assert.equal(preflightRelease.rootAuthorizedRecovery,true);
    assert.equal(preflightRelease.reason,'SANDBOX_NETWORK_EACCES_BEFORE_CONNECT_COMPLETED');
    output=resolve(dir,`${source.sourceSha256}-${id}-network-restored.json`);
  }
  const report = {...metadata,case:id,expected:item,actor:ACTOR,maximumSimulationCalls:2,maximumModelCalls:10,startedAt:new Date().toISOString(),genCallsStarted:0,stage:'network-preflight',...(preflightRelease?{preflightRelease}:{}),captures:[]};
  // Exclusive create makes an interrupted/failed call consume its case allowance.
  await writeFile(output,`${publicJson(report)}\n`,{flag:'wx'});
  const save = () => writeFile(output,`${publicJson(report)}\n`);
  const rpc = async request => {
    const mode = request.leader_public_data ? 'validator':'leader';
    report.genCallsStarted++; report.stage=`${mode}-gen-call-started`; await save();
    const response = await fetch('https://rpc-bradbury.genlayer.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'gen_call',params:[request]}),signal:AbortSignal.timeout(240000)});
    const text = await response.text(); let json;
    try { json = JSON.parse(text); } catch { report.captures.push({mode,httpStatus:response.status,bodyByteLength:Buffer.byteLength(text),bodySha256:sha256(text),category:'NON_JSON'}); await save(); throw new Error('NON_JSON_PUBLIC_RESPONSE'); }
    const capture = {mode,requestDataSha256:sha256(request.data),requestDataBytes:Buffer.byteLength(request.data),httpStatus:response.status,bodyByteLength:Buffer.byteLength(text),bodySha256:sha256(text),result:json.result?publicResponse(json.result):null,error:json.error?publicError(json.error):null};
    report.captures.push(capture); await save(); // Persist allowed public payload BEFORE classification/throw.
    if (!response.ok || json.error) throw new Error('PUBLIC_RPC_ERROR');
    return json.result;
  };
  try {
    await connectBradbury();
    const data = deploymentData(probe.code,[JSON.stringify(fixture[item.spec]),JSON.stringify(fixture[item.submission]),id]);
    const request={type:'deploy',from:ACTOR,to:ZERO,data,status:'finalized',transaction_hash_variant:'latest-final'};
    const leader=await rpc(request); report.leader=publicResponse(leader); await save();
    if (leader.status?.code!==0 || !report.leader.publicData.decoded || !report.leader.publicData.nonemptyHex || !report.leader.markers.some(marker=>marker.phase==='leader'&&marker.stage==='independent_complete')) throw new Error('LEADER_INSUFFICIENT_PUBLIC_EVIDENCE');
    const validator=await rpc({...request,leader_public_data:leader.leaderPublicData}); report.validator=publicResponse(validator);
    report.result=caseResult(item,report.leader,report.validator);
  } catch(error) { report.error={category:['PUBLIC_RPC_ERROR','NON_JSON_PUBLIC_RESPONSE','LEADER_INSUFFICIENT_PUBLIC_EVIDENCE'].includes(error.message)?error.message:'DIAGNOSTIC_ABORTED',name:error.name,...(typeof error.cause?.code==='string'?{transportCode:error.cause.code}: {})}; }
  report.completedAt=new Date().toISOString(); await save();
  console.log(publicJson({case:id,evidenceFile:output,passed:report.result?.passed===true,leader:report.leader?.status,validator:report.validator?.status,result:report.result,error:report.error}));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main().catch(error=>{console.error(JSON.stringify({error:error.name,message:error instanceof assert.AssertionError?error.message:'V3 diagnostic preparation failed'}));process.exitCode=1;});
