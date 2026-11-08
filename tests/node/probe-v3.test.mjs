import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { abi } from 'genlayer-js';
import { buildProbe, deploymentData, caseResult } from '../../scripts/probe-v3-assessment.mjs';
import { trustedMarkers, publicError, publicResponse, publicDataSummary } from '../../scripts/probe-public-codec.mjs';
test('generated instrumentation reverses byte-for-byte and SDK deploy encoding roundtrips',async()=>{
  const code=await readFile(new URL('../../contracts/archive/research_receipt_v4_f5a656.py',import.meta.url),'utf8');
  const probe=buildProbe(code);
  assert.equal(probe.independentHelperSha256,probe.recoveredHelperSha256);
  assert.equal(probe.reversibleSites,7);
  assert.ok(probe.code.startsWith(code.split('class ResearchReceipt(gl.contract.Contract):')[0]));
  deploymentData(probe.code,['{}','{}','offline']);
  assert.throws(()=>buildProbe(code.replace('checks.append(check)','checks.append({})')));
});
test('public codec preserves known own VM payload before classification and filters credentials',()=>{
  const data=Buffer.from(abi.calldata.encode({kind:'UserError',message:'Model output rejected: RR_MODEL_EVIDENCE_INVALID'}));
  const go=bytes=>`execution failed: &genvm.VMResult{Kind:0x1, Data:[]uint8{${[...bytes].map(i=>`0x${i.toString(16)}`).join(',')}}}`;
  const error=publicError({code:-32000,message:go(data)});
  assert.equal(error.vmResult.rawDataHex,`0x${data.toString('hex')}`);
  assert.equal(error.vmResult.decodedWhitelist.message.ownUserError,'Model output rejected: RR_MODEL_EVIDENCE_INVALID');
  assert.equal(publicError({message:go(Buffer.from([255,255]))}).vmResult.rawDataHex,undefined);
  const secret=Buffer.from(abi.calldata.encode({config:{api_key:'fixture-only'}}));
  assert.equal(publicError({message:go(secret)}).vmResult.rawDataHex,undefined);
});
test('public capture accepts unprefixed opaque leader data and only trusted marker keys',()=>{
  const hex=Buffer.from(abi.calldata.encode({nd_outs:[]})).toString('hex');
  assert.equal(publicDataSummary(hex).decoded,true);
  assert.equal(publicResponse({data:hex,leaderPublicData:hex}).rawPublicFields.leaderPublicData,hex);
  const marker='RR_V3_PROBE_JSON '+JSON.stringify({probe_version:'research-receipt-v3-probe/1',phase:'validator',stage:'comparison',equal:false,reason:'must not be copied',config:'exclude'});
  assert.deepEqual(trustedMarkers('noise\n'+marker),[{probe_version:'research-receipt-v3-probe/1',phase:'validator',stage:'comparison',equal:false}]);
});
test('matrix pass requires both exact projections, successful calls, comparison and no disagreement',()=>{
  const item={statuses:['SUPPORTED'],delivery:['FULFILLED'],verdict:'ACCEPTED'};
  const projection={findings:[{status:'SUPPORTED',delivery_status:'FULFILLED'}],source_checks:[{status:'VERIFIED'}],verdict:'ACCEPTED'};
  const view=phase=>({status:{code:0},nondetDisagreementCallNo:null,markers:[{phase,stage:'independent_complete',projection,model_calls:1,format_repairs:0},...(phase==='validator'?[{phase,stage:'comparison',equal:true}]:[])]});
  assert.equal(caseResult(item,view('leader'),view('validator')).passed,true);
  const disagreement=view('validator'); disagreement.nondetDisagreementCallNo=0;
  assert.equal(caseResult(item,view('leader'),disagreement).passed,false);
  const absent=view('validator'); absent.markers=[];
  assert.equal(caseResult(item,view('leader'),absent).passed,false);
  const error=view('validator'); error.status.code=1;
  assert.equal(caseResult(item,view('leader'),error).passed,false);
});
