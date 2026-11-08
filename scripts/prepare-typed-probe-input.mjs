import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await readFile('artifacts/bradbury/inline-probe-input.json');
if(sha(bytes)!=='c9e9884c2467106aa76449f28830f8323e831801450ee0f012bae9429606bb96')throw new Error('Original inline fixture changed');
const original=JSON.parse(bytes),input={};
for(const [key,value]of Object.entries(original)){
 const row=structuredClone(value);
 for(const criterion of row.spec.criteria){criterion.verification_kind=criterion.id==='limitations'?'boundary_review':'evidence_review';criterion.allowed_claim_types=criterion.id==='limitations'?['boundary_disclosure']:['factual_assertion','unknown_disclosure'];if(criterion.id==='limitations')criterion.text='明确研究只覆盖提交的固定commit源码；列出未覆盖的派生重写、代理和实际部署状态，不把本报告当作协议整体安全或未来收益保证。';}
 for(const claim of row.submission.claims){
  claim.claim_type=claim.criterion_id==='permissions'?'factual_assertion':claim.criterion_id==='limitations'?'boundary_disclosure':'unknown_disclosure';
  if(claim.criterion_id==='withdrawals'){claim.statement='本次提交的Ownable与Context源码均未提供具体协议的提现或赎回流程证据，因此提现等待期和能否即时退出在本次证据范围内未知，不作即时提现承诺。';claim.evidence_indices=[0,1];}
  if(claim.criterion_id==='audit'){claim.statement='本次提交的Ownable与Context两份固定commit源码都不是审计报告；本次材料未提供审计覆盖范围或版本的证据，审计状态在本次证据范围内未知，不宣称任何部署已通过安全审计。';claim.evidence_indices=[0,1];}
  if(claim.criterion_id==='limitations'){claim.statement='本报告只核查本次提交的固定commit版Ownable与Context默认基类源码及逐项陈述；不覆盖派生重写、代理或实际部署状态，也不把本报告当作协议整体安全或未来收益保证。';claim.evidence_indices=[0,1];}
 }
 row.submission.report_body=row.submission.claims.map(c=>c.statement).join('\n');input[key]=row;
}
const add=(key,criterionId,statement,type)=>{const row=structuredClone(input.positive),claim=row.submission.claims.find(c=>c.criterion_id===criterionId);claim.statement=statement;claim.claim_type=type;row.submission.report_body=row.submission.claims.map(c=>c.statement).join('\n');input[key]=row;return claim;};
add('falseCautionOtherSource','permissions','在本次提交的所有材料中，_msgSender()是否返回msg.sender仍然未知。','unknown_disclosure').evidence_indices=[0];
add('unknownWithPromise','withdrawals','在本次提交的材料范围内，某未提供源码或部署地址的外部协议的提现机制未知，因此该协议用户能够随时即时退出。','unknown_disclosure');
add('contradictionWithUnknown','permissions',input.negative.submission.claims[0].statement+'其余权限未知。','unknown_disclosure');
add('boundaryIncomplete','limitations','本报告有局限性。','boundary_disclosure');
add('falsePermissionsAsBoundary','permissions',input.negative.submission.claims[0].statement,'boundary_disclosure');
add('unknownAsFactual','audit',input.positive.submission.claims.find(c=>c.criterion_id==='audit').statement,'factual_assertion');
const serialized=JSON.stringify(input,null,2)+'\n';
await writeFile('artifacts/bradbury/typed-probe-input.json',serialized,{flag:'wx'});
await writeFile('tests/fixtures/bradbury-typed-probe-input.json',serialized,{flag:'wx'});
console.log(JSON.stringify({prepared:true,fixtureSha256:sha(serialized),cases:Object.keys(input),migration:'New explicit typed schema. Unknown scope includes all submitted materials; boundary requirement is more explicit and its derived label becomes BOUNDARY_DISCLOSED. Old v5 inputs and failed oracles remain unchanged.'}));
