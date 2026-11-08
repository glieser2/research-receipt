// Independent public readback/inclusion proof. No signer or model execution.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {connectBradbury,verifyDeploymentEvidence,publicJson,contractSource,safeError} from './bradbury-client.mjs';
import {sha256} from './probe-public-codec.mjs';
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const planBytes=await readFile('docs/evidence/typed-probe-plan.json'),plan=JSON.parse(planBytes),fixtureBytes=await readFile(plan.fixtureFile);
const source=await contractSource(plan.sourceFile);
assert.equal(source.sourceSha256,plan.sourceSha256);assert.equal(sha256(fixtureBytes),plan.fixtureSha256);
assert.deepEqual(plan.simulationOrder,['positive','negative','falseCautionOtherSource','unknownWithPromise','boundaryIncomplete']);
assert.deepEqual(plan.committeeOrder,['positive','negative']);
const id=arg('case'),hash=arg('hash'),fromBlock=arg('from-block');
assert.ok(['positive','negative'].includes(id)&&/^0x[0-9a-fA-F]{64}$/.test(hash||'')&&/^\d+$/.test(fromBlock||''),'An exact case, protocol ID and bounded start block are required');
for(const prior of plan.simulationOrder){const r=JSON.parse(await readFile(`artifacts/bradbury/typed-probe/${plan.sourceSha256}-${prior}.json`));assert.equal(r.planSha256,sha256(planBytes));assert.equal(r.case,prior);assert.equal(r.sourceSha256,plan.sourceSha256);assert.equal(r.fixtureSha256,plan.fixtureSha256);assert.equal(r.result?.passed,true);}
if(id==='negative'){const positive=JSON.parse(await readFile('docs/evidence/typed-probe-positive-independent.json'));assert.equal(positive.fullyVerified,true);assert.equal(positive.planSha256,sha256(planBytes));assert.equal(positive.case,'positive');assert.equal(positive.sourceVerification?.sourceSha256,plan.sourceSha256);}
const expected=plan.expected.find(x=>x.id===id),input=JSON.parse(fixtureBytes)[id];
const connection=await connectBradbury();
const tx=await connection.client.getTransaction({hash});
const observedAt=new Date().toISOString(),observationFile=`artifacts/bradbury/typed-probe/${hash}-${Date.now()}-observation.json`;
await writeFile(observationFile,publicJson({observedAt,transaction:tx})+'\n',{flag:'wx'});
if(!['FINALIZED','CANCELED'].includes(tx.statusName)){
 console.log(JSON.stringify({pendingObservation:true,status:tx.statusName,observationFile,noTransactionSent:true}));
 process.exit(0);
}
let proof;
try{
assert.equal(tx.statusName,'FINALIZED','A canceled deployment cannot satisfy the proof');
const decoded=tx.txDataDecoded;
const ctor=decoded?.constructorArgs instanceof Map?Object.fromEntries(decoded.constructorArgs):decoded?.constructorArgs;
const params=ctor?.args;
const inputVerified=!!ctor&&Object.keys(ctor).length===1&&Array.isArray(params)&&params.length===1&&typeof params[0]==='string'&&canonical(JSON.parse(params[0]))===canonical(input);
assert.ok(inputVerified&&decoded?.type==='deploy'&&decoded.leaderOnly===false,'Actual constructor input and non-leader-only mode must equal the prelocked case');
// Reuse exactly this FINALIZED snapshot for identity, source, inputs and votes.
const sameSnapshot={...connection,client:{getTransaction:async({hash:requested})=>{assert.equal(requested,hash);return tx;},readContract:connection.client.readContract}};
proof=await verifyDeploymentEvidence(sameSnapshot,{hash,actorAddress:'0x29EB14D10ec2E406E5d1419ED08D803b8B18aB70',sourceSha256:plan.sourceSha256,fromBlock,readback:{method:'get_receipt',args:[],expected:canonical(expected.expectedReceipt)}});
const full={...proof,planSha256:sha256(planBytes),fixtureSha256:sha256(fixtureBytes),case:id,inputVerification:{verified:inputVerified,constructorArgumentCount:1,leaderOnly:false},checkedAt:new Date().toISOString(),scope:'Isolated typed diagnostic only, not production lifecycle E2E.'};
assert.equal(proof.fullyVerified,true,'Complete independent deployment proof failed');
const assessmentRaw=await connection.client.readContract({address:proof.contractAddress,functionName:'get_assessment',args:[],transactionHashVariant:'latest-final'});
const assessment=JSON.parse(assessmentRaw);
const projection={verdict:assessment.verdict,findings:assessment.findings.map(({criterion_id,claim_type,validity,status,delivery_status,evidence_indices})=>({criterion_id,claim_type,validity,status,delivery_status,evidence_indices})),source_checks:assessment.source_checks};
assert.equal(canonical(projection),canonical(expected.expectedReceipt.assessment),'Full assessment must match every consensus-bearing field');
full.fullAssessmentProjectionMatch=true;
full.consensusObservation={round:String(tx.lastRound?.round),votes:tx.lastRound?.validatorVotes?.map(Number)||[]};
await writeFile(`artifacts/bradbury/typed-probe/${id}-assessment.json`,publicJson({variant:'latest-final',assessment})+'\n',{flag:'wx'});
await writeFile(`docs/evidence/typed-probe-${id}-independent.json`,publicJson(full)+'\n',{flag:'wx'});
console.log(publicJson({fullyVerified:full.fullyVerified,case:id,contractAddress:full.contractAddress,fullReceiptMatch:true,protocolTxId:hash,envelopeHash:full.blockEvidence.envelopeHash}));
}catch(error){
 const failure={fullyVerified:false,case:id,protocolTxId:hash,sourceSha256:plan.sourceSha256,planSha256:sha256(planBytes),observedAt,observationFile,proof:proof||null,error:safeError(error),noTransactionSent:true};
 const failureFile=`artifacts/bradbury/typed-probe/${hash}-${Date.now()}-failed-proof.json`;
 await writeFile(failureFile,publicJson(failure)+'\n',{flag:'wx'});
 console.log(JSON.stringify({fullyVerified:false,case:id,failureFile,error:failure.error}));process.exitCode=1;
}
