import { readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { normalizeSpec, normalizeBoundSubmission, canonical } from './collect-bradbury-evidence.mjs';
import { hashEvidenceJson, evidenceContentFingerprint } from '../src/lib/evidence-snapshot.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceFile='contracts/research_receipt.py', sourceSha256=sha(await readFile(sourceFile));
if(sourceSha256!=='60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65')throw new Error('Unreviewed v5 source.');
const oldBytes=await readFile('artifacts/bradbury/v4-e2e-input.json');
if(sha(oldBytes)!=='a423530364c4c65fd5c3ef23db2e23f1cefa8a27a587f9dbe692ec0453930dfc')throw new Error('Old frozen oracle changed.');
const fixture=JSON.parse(oldBytes), prior=JSON.parse(await readFile('docs/evidence/v4-validation-plan.json','utf8'));
for(const key of ['spec','specStrict','specMissing','permissionSpec'])fixture[key].client_ref=randomUUID();
const materials=await Promise.all(['Ownable.sol','Context.sol'].map(async name=>new TextDecoder('utf-8',{fatal:true}).decode(await readFile('artifacts/bradbury/'+name))));
for(let i=0;i<2;i++){const b=Buffer.from(materials[i],'utf8'),s=fixture.positive.sources[i];if(b.length!==s.byte_length||sha(b)!==s.sha256)throw new Error('Source materials changed.');}
const expectedSnapshots=[];
for(const entry of [{id:'negative',spec:'spec',submission:'negative',orderId:1,revision:1},{id:'positive',spec:'spec',submission:'positive',orderId:1,revision:2},{id:'hashMismatch',spec:'specMissing',submission:'missing',orderId:2,revision:1},{id:'strictUnknown',spec:'specStrict',submission:'positive',orderId:4,revision:1}]){
  const spec=normalizeSpec(fixture[entry.spec]),submission=normalizeBoundSubmission(fixture[entry.submission],spec);
  const source_checks=submission.sources.map((s,index)=>({index,status:entry.id==='hashMismatch'&&index===0?'HASH_MISMATCH':'VERIFIED',sha256:fixture.positive.sources[index].sha256}));
  const binding={policy_version:'research-receipt/5',order_id:entry.orderId,revision:entry.revision,spec_hash:sha(canonical(spec)),submission_hash:sha(canonical(submission)),content_hash:await evidenceContentFingerprint(submission),sources:submission.sources};
  const snapshot={snapshot_version:'research-receipt/evidence-snapshot/1',binding,source_checks,materials:materials.map((body,index)=>source_checks[index].status==='VERIFIED'?body:null)};
  expectedSnapshots.push({...entry,binding,sourceChecks:source_checks,snapshotHash:await hashEvidenceJson(snapshot),materialByteLengths:snapshot.materials.map(s=>s===null?null:Buffer.byteLength(s,'utf8'))});
}
const fixtureFile='artifacts/bradbury/v5-e2e-input.json',serialized=JSON.stringify(fixture,null,2)+'\n';
const plan={format:'research-receipt/v5-prelocked-plan/1',policyVersion:'research-receipt/5',frozenBeforeExecutionAt:new Date().toISOString(),sourceCommitment:{file:sourceFile,sha256:sourceSha256},fixtureFile,fixtureSha256:sha(serialized),feeProfileSha256:sha(await readFile('src/fee-profile.json')),expected:prior.expected,expectedSnapshots,guardExpectations:[...prior.guardExpectations,'evaluate before snapshot rejected with no state change','duplicate verify rejected; snapshot immutable','snapshot bound to current order/revision/spec/submission/content/all sources','assessment snapshot_hash and source_checks exactly match accepted snapshot','failure sources have null material and cannot be rescued by model or allowed unknown'],requiredPublicCaseCount:24,rule:'Preserve all four original criteria and exact classification oracles. Only references are renewed; evidence and statements are unchanged. Source verification and model assessment are separate transactions. No automatic retries.',availabilityLimit:'One immutable snapshot per revision, including a failed fetch. A transient UNAVAILABLE is therefore fixed for that revision; evaluate the actual evidence result, then genuinely correct evidence for a new revision. Changing labels or meaningless prose is not a supported recovery.',historicalEvidence:'Retain all v1/v2/v4 attempts and source-only/inline diagnostics separately; isolated diagnostic success is not business E2E success.'};
await writeFile(fixtureFile,serialized,{flag:'wx'});
await writeFile('tests/fixtures/bradbury-v5-input.json',serialized,{flag:'wx'});
await writeFile('docs/evidence/v5-validation-plan.json',JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
await writeFile('contracts/archive/research_receipt_v5_60b89e.py',await readFile(sourceFile),{flag:'wx'});
console.log(JSON.stringify({prepared:true,sourceSha256,fixtureSha256:plan.fixtureSha256,planSha256:sha(await readFile('docs/evidence/v5-validation-plan.json')),expectedSnapshotHashes:expectedSnapshots.map(s=>({case:s.id,hash:s.snapshotHash})),clientRefs:Object.fromEntries(['spec','specMissing','permissionSpec','specStrict'].map(k=>[k,fixture[k].client_ref]))}));
