// Unsigned, bounded EVM-call diagnostics only. No signer, key, send or GenVM replay API.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { decodeFunctionData, encodeFunctionData, decodeErrorResult, encodeErrorResult } from 'viem';
import { testnetBradbury } from 'genlayer-js/chains';
import { deploymentData } from './probe-v3-assessment.mjs';
import { BRADBURY, PROJECT_ROOT, connectBradbury, quoteDevelopmentProfile, publicJson } from './bradbury-client.mjs';

const ACTOR = '0x29EB14D10ec2E406E5d1419ED08D803b8B18aB70';
const MAIN = '0x2E2766cbc3E5e61Ce93bBcdCBb3eAcB82082A019';
const ZERO = '0x0000000000000000000000000000000000000000';
const SOURCE_SHA = 'b931e3b582ad96e934a985ca1d21a955ce3e2ea910eae2e3918e2c7896f290de';
const FIXTURE_SHA = '73703b4f60883ae6c51eeca9dd42a4dc945e97d020d88e6616af10679982b0d9';
const sha = value => createHash('sha256').update(value).digest('hex');
const abi = testnetBradbury.consensusMainContract.abi;
const errorAbi = Object.values(testnetBradbury).flatMap(value => value?.abi || []).filter(item => item.type === 'error');
const safeScalar = value => typeof value === 'bigint' ? value.toString() : typeof value === 'boolean' ? value : typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? value : '[omitted]';

export function summarizeRevert(error) {
  const found = new Set();
  const visit = (value, depth = 0) => {
    if (depth > 6) return;
    if (typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value)) found.add(value);
    else if (value && typeof value === 'object') for (const key of ['data', 'error', 'cause', 'originalError', 'result']) if (Object.hasOwn(value, key)) visit(value[key], depth + 1);
  };
  visit(error);
  return [...found].map(data => {
    const result = { selector: data.length >= 10 ? data.slice(0, 10).toLowerCase() : null, bytes: (data.length - 2) / 2, sha256: sha(data) };
    try {
      const decoded = decodeErrorResult({ abi: errorAbi, data });
      // Only names declared by this installed official SDK ABI, and numeric/address args.
      if (errorAbi.some(item => item.name === decoded.errorName)) Object.assign(result, { knownError: decoded.errorName, args: (decoded.args || []).map(safeScalar) });
    } catch { /* Unknown errors remain selector/hash only; raw bytes stay in ignored artifact. */ }
    return result;
  });
}

export function verifyRequest(input, { code, constructorInput, profile }) {
  const raw = input?.method === 'eth_estimateGas' && Array.isArray(input.params) ? input.params[0] : input.request || input;
  assert.ok(raw && typeof raw === 'object' && !Array.isArray(raw), 'An original unsigned request object is required');
  assert.deepEqual(Object.keys(raw).sort(), ['data', 'from', 'to', 'value'], 'Only the exact SDK estimate request fields are accepted; no gas override');
  assert.equal(raw.from.toLowerCase(), ACTOR.toLowerCase());
  assert.equal(raw.to.toLowerCase(), MAIN.toLowerCase());
  assert.match(raw.data, /^0x(?:[0-9a-fA-F]{2})+$/);
  assert.match(raw.value, /^0x[0-9a-fA-F]+$/);
  const decoded = decodeFunctionData({ abi, data: raw.data });
  assert.equal(decoded.functionName, 'addTransaction');
  assert.equal(decoded.args.length, 1);
  const params = decoded.args[0];
  assert.equal(params.sender.toLowerCase(), ACTOR.toLowerCase());
  assert.equal(params.recipient, ZERO);
  assert.equal(params.numOfInitialValidators, BigInt(testnetBradbury.defaultNumberOfInitialValidators));
  assert.equal(params.maxRotations, BigInt(testnetBradbury.defaultConsensusMaxRotations));
  assert.equal(params.saltNonce, 0n); assert.equal(params.userValue, 0n);
  assert.equal(params.messageAllocations.length, 0);
  assert.equal(params.txCalldata.toLowerCase(), deploymentData(code, [JSON.stringify(constructorInput)]).toLowerCase());
  const distribution = params.feesDistribution;
  for (const key of ['leaderTimeunitsAllocation', 'validatorTimeunitsAllocation', 'executionBudgetPerRound', 'appealRounds']) assert.equal(distribution[key], BigInt(profile[key]), `Fee profile differs: ${key}`);
  assert.equal(distribution.executionConsumed, 0n); assert.equal(distribution.totalMessageFees, 0n);
  assert.deepEqual(distribution.rotations, Array.from({length: Number(distribution.appealRounds + 1n)}, () => BigInt(testnetBradbury.defaultConsensusMaxRotations)));
  assert.ok(BigInt(raw.value) > 0n);
  // This includes original validUntil, fee caps and deposit: no refreshed quote or guessed timestamp.
  assert.equal(encodeFunctionData({ abi, functionName: 'addTransaction', args: [params] }).toLowerCase(), raw.data.toLowerCase());
  return { request: raw, params, abiRoundTripExact: true, feeQuoteProvenance: 'Supplied request fields; profile allocations checked. Current fee adequacy is NOT asserted.' };
}

async function selfTest() {
  const src = await readFile(resolve(PROJECT_ROOT, 'contracts/research_receipt_sufficiency_probe.py'), 'utf8');
  const fixture = JSON.parse(await readFile(resolve(PROJECT_ROOT, 'artifacts/bradbury/structured-probe-input.json')));
  const profile = JSON.parse(await readFile(resolve(PROJECT_ROOT, 'src/fee-profile.json')));
  const distribution = { leaderTimeunitsAllocation: 600n, validatorTimeunitsAllocation: 600n, appealRounds: 0n, executionBudgetPerRound: 10000000000000000n, executionConsumed: 0n, totalMessageFees: 0n, rotations: [3n], maxPriceGenPerTimeUnit: 2n, storageFeeMaxGasPrice: 300000000n, receiptFeeMaxGasPrice: 300000000n };
  const params = { sender: ACTOR, recipient: ZERO, numOfInitialValidators: BigInt(testnetBradbury.defaultNumberOfInitialValidators), maxRotations: BigInt(testnetBradbury.defaultConsensusMaxRotations), validUntil: 1n, saltNonce: 0n, userValue: 0n, feesDistribution: distribution, txCalldata: deploymentData(src, [JSON.stringify(fixture.positive)]), messageAllocations: [] };
  const request = { from: ACTOR, to: MAIN, value: '0x8e1bc9bf040000', data: encodeFunctionData({abi, functionName:'addTransaction', args:[params]}) };
  const context = { code: src, constructorInput: fixture.positive, profile };
  assert.equal(verifyRequest(request, context).abiRoundTripExact, true);
  assert.throws(() => verifyRequest({...request, gas:'0x100000'}, context));
  assert.throws(() => verifyRequest({...request, from:ZERO}, context));
  assert.throws(() => verifyRequest(request, {...context, constructorInput: fixture.negative}));
  assert.throws(() => verifyRequest(request, {...context, profile:{...profile,appealRounds:1}}));
  const revert = encodeErrorResult({abi:errorAbi,errorName:'ExecutionBudgetExceeded',args:[2n,1n]});
  assert.equal(summarizeRevert({data:revert})[0].knownError,'ExecutionBudgetExceeded');
  assert.deepEqual(summarizeRevert({data:revert})[0].args,['2','1']);
  assert.equal(summarizeRevert({data:'0x12345678',message:'secret text'})[0].knownError,undefined);
  console.log(JSON.stringify({selfTest:true,checks:8,networkRequests:0,filesWritten:0}));
}

async function main() {
  if (process.argv.includes('--self-test')) return selfTest();
  const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
  assert.equal(arg('case') || 'positive', 'positive', 'This diagnosis is bound to the one failed positive send');
  const rebuild = process.argv.includes('--rebuild-sdk-equivalent');
  assert.notEqual(!!arg('original-request'), rebuild, 'Choose original request OR explicitly labelled SDK-equivalent reconstruction');
  if (rebuild) assert.ok(process.argv.includes('--run'), 'Fresh fee/clock reconstruction requires explicit --run read-only network authorization');
  const planBytes = await readFile(resolve(PROJECT_ROOT, 'docs/evidence/sufficiency-probe-plan.json'));
  const plan = JSON.parse(planBytes);
  const source = await readFile(resolve(PROJECT_ROOT, plan.sourceFile));
  const fixtureBytes = await readFile(resolve(PROJECT_ROOT, plan.fixtureFile));
  const feeBytes = await readFile(resolve(PROJECT_ROOT, 'src/fee-profile.json'));
  assert.equal(sha(source), SOURCE_SHA); assert.equal(plan.sourceSha256, SOURCE_SHA);
  assert.equal(sha(fixtureBytes), FIXTURE_SHA); assert.equal(plan.fixtureSha256, FIXTURE_SHA);
  assert.equal(sha(feeBytes), plan.feeProfileSha256);
  const context = {code:source.toString('utf8'),constructorInput:JSON.parse(fixtureBytes).positive,profile:JSON.parse(feeBytes)};
  let originalBytes, checked, connection, reconstruction;
  if (rebuild) {
    connection = await connectBradbury();
    const {quote} = await quoteDevelopmentProfile(connection.client);
    const latestBlock = await connection.publicClient.getBlock({blockTag:'latest'});
    const localSeconds = Math.floor(Date.now()/1000);
    // Exact installed SDK rc.2 default: floor(Date.now()/1000) + 3600 (index.js:2304).
    const params = {sender:ACTOR,recipient:ZERO,numOfInitialValidators:BigInt(connection.chain.defaultNumberOfInitialValidators),maxRotations:BigInt(connection.chain.defaultConsensusMaxRotations),validUntil:BigInt(localSeconds+3600),saltNonce:0n,userValue:0n,feesDistribution:quote.distribution,txCalldata:deploymentData(context.code,[JSON.stringify(context.constructorInput)]),messageAllocations:[]};
    const request = {from:ACTOR,to:MAIN,data:encodeFunctionData({abi,functionName:'addTransaction',args:[params]}),value:'0x'+quote.feeValue.toString(16)};
    checked = verifyRequest(request,context);
    reconstruction = {mode:'fresh-sdk-equivalent-not-original-bytes',originalRequestAvailable:false,localUnixSeconds:localSeconds,sdkDefaultValidUntil:params.validUntil.toString(),latestBlock:{number:latestBlock.number.toString(),hash:latestBlock.hash,timestamp:latestBlock.timestamp.toString()},localMinusBlockSeconds:(BigInt(localSeconds)-latestBlock.timestamp).toString(),validUntilMinusBlockSeconds:(params.validUntil-latestBlock.timestamp).toString(),quote,warning:'Fresh validUntil, fee caps and fee value. This is NOT byte-identical replay of the rejected request. Clock difference alone does not establish a chain halt or revert cause.'};
  } else {
    originalBytes = await readFile(resolve(PROJECT_ROOT, arg('original-request')));
    assert.ok(originalBytes.length < 2 * 1024 * 1024, 'Unsigned request artifact exceeds diagnostic size limit');
    checked = verifyRequest(JSON.parse(originalBytes),context);
    reconstruction = {mode:'saved-original-unsigned-request',originalRequestAvailable:true};
  }
  const directory = resolve(PROJECT_ROOT, 'artifacts/bradbury/sufficiency-probe');
  await mkdir(directory,{recursive:true});
  const output = resolve(directory, 'positive-gas-diagnostic-request.json');
  const record = {format:'research-receipt/unsigned-gas-diagnostic/1',preparedAt:new Date().toISOString(),sourceSha256:SOURCE_SHA,fixtureSha256:FIXTURE_SHA,planSha256:sha(planBytes),feeProfileSha256:sha(feeBytes),...(originalBytes?{originalRequestFile:arg('original-request'),originalRequestSha256:sha(originalBytes)}:{}),requestDataSha256:sha(checked.request.data),...checked,reconstruction,noSignature:true,chainTransactionsSent:0,gasOverride:false,scope:'EVM addTransaction read-only simulation; no gen_call, trace, model replay, send or appeal.'};
  await writeFile(output,publicJson(record)+'\n',{flag:'wx'});
  console.log(JSON.stringify({prepared:true,requestArtifact:output,requestDataSha256:record.requestDataSha256,validUntil:checked.params.validUntil.toString(),valueWei:BigInt(checked.request.value).toString(),mode:reconstruction.mode,abiRoundTripExact:true,originalByteReplay:!rebuild}));
  if (!process.argv.includes('--run')) return;
  connection ||= await connectBradbury(); // Read-only network/genesis/registry checks, no account supplied.
  assert.equal(connection.metadata.addresses.ConsensusMain.toLowerCase(),MAIN.toLowerCase());
  for (const method of ['eth_call','eth_estimateGas']) {
    const params = method === 'eth_call' ? [checked.request,'latest'] : [checked.request];
    const rawFile = resolve(directory,`positive-gas-diagnostic-${method}.json`);
    const capture = {method,startedAt:new Date().toISOString(),requestDataSha256:record.requestDataSha256,network:connection.metadata};
    await writeFile(rawFile,publicJson(capture)+'\n',{flag:'wx'}); // A failed/uncertain read consumes this slot; never auto retry.
    try {
      const response = await fetch(BRADBURY.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)});
      const body = await response.text();
      capture.httpStatus=response.status;
      try { capture.response=JSON.parse(body); } catch { capture.nonJsonBody=body; }
      capture.finishedAt=new Date().toISOString();
      await writeFile(rawFile,publicJson(capture)+'\n');
      console.log(JSON.stringify({method,rawArtifact:rawFile,httpStatus:response.status,rpcCode:capture.response?.error?.code??null,revert:summarizeRevert(capture.response?.error),resultBytes:typeof capture.response?.result==='string'?(capture.response.result.length-2)/2:null,resultSha256:typeof capture.response?.result==='string'?sha(capture.response.result):null}));
    } catch (error) {
      capture.finishedAt=new Date().toISOString();capture.transportError={name:error.name,code:error.cause?.code||null};
      await writeFile(rawFile,publicJson(capture)+'\n');
      console.log(JSON.stringify({method,rawArtifact:rawFile,transportFailure:true}));
      break;
    }
  }
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) main().catch(error=>{console.error(JSON.stringify({diagnosticFailed:true,name:error.name,summary:'Input/identity validation or read-only diagnostic failed; no transaction sent.'}));process.exitCode=1;});
