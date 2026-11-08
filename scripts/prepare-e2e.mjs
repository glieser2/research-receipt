import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const sessionFile=process.env.RR_E2E_SESSION || 'artifacts/live/session.json';
const outputFile=process.env.RR_E2E_OUTPUT || 'artifacts/live/e2e-input.json';
for (const path of [sessionFile,outputFile]) if (!/^artifacts\/(live|bradbury)\/[a-zA-Z0-9_.-]+\.json$/.test(path)) throw new Error('Fixture paths must remain inside ignored test artifacts');
const session=JSON.parse(await readFile(sessionFile,'utf8'));
const author=session.actors[process.env.RR_E2E_AUTHOR_ROLE || 'author'];
if (!/^0x[0-9a-fA-F]{40}$/.test(author || '')) throw new Error('Invalid independent test actor');
const source={url:'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/3e6c86392c97fbc30d3d20a378a6f58beba08eba/contracts/access/Ownable.sol',sha256:'38578bd71c0a909840e67202db527cc6b4e6b437e0f39f0c909da32c1e30cb81',byte_length:3102};
const criteria=[
  {id:'permissions',text:'说明材料可支持的管理员与升级权限，材料未涉及的权限明确标为未知，区分源文件事实和真实部署状态。',required:true},
  {id:'withdrawals',text:'说明材料可支持的提现、赎回或退出限制；材料未提供机制时明确未知，不得无证据承诺即时退出。',required:true},
  {id:'audit',text:'准确说明审计覆盖范围及版本，未获得审计证据必须承认未知。',required:true},
  {id:'limitations',text:'明确研究的证据边界，不把未发现问题表述为安全或收益保证。',required:true}
];
const spec={client_ref:randomUUID(),title:'OpenZeppelin Ownable · 公开源文件研究验收',protocol:'OpenZeppelin Ownable (commit-scoped)',chain:'EVM source only; no deployment claim',as_of:new Date().toISOString().slice(0,10),author,allowed_hosts:['raw.githubusercontent.com'],source_roots:['raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/'],criteria};
const claims=[
  {criterion_id:'permissions',statement:'这份Ownable源码的transferOwnership受onlyOwner限制；renounceOwnership也只允许owner调用。它不能证明任意部署是否有升级权限。',evidence_indices:[0]},
  {criterion_id:'withdrawals',statement:'本次只提交Ownable权限模块源码，没有协议提现或赎回流程证据，因此提现等待期与能否即时退出均为未知，不作即时提现承诺。',evidence_indices:[0]},
  {criterion_id:'audit',statement:'本次材料不含审计报告，无法核查具体审计覆盖版本，审计状态未知，不宣称任何部署已通过安全审计。',evidence_indices:[0]},
  {criterion_id:'limitations',statement:'本报告只核查指定commit文件及上述陈述，不证明某个实际部署状态、协议整体安全或未来收益。',evidence_indices:[0]}
];
const positive={report_title:'Ownable source-scoped research · corrected',report_version:'v2',report_body:claims.map(c=>c.statement).join('\n'),sources:[{url:source.url,sha256:source.sha256,byte_length:source.byte_length}],claims};
const negative=structuredClone(positive);negative.report_title='Ownable source-scoped research · initial';negative.report_version='v1';negative.claims[0].statement='这份Ownable源码的transferOwnership任何人都可调用，不要求调用者是owner。';negative.report_body=negative.claims.map(c=>c.statement).join('\n');
const missing=structuredClone(positive);missing.report_version='v1';missing.sources[0].sha256='0'.repeat(64);
const cases={spec,negative,positive,missing,specMissing:{...spec,client_ref:randomUUID(),title:'证据完整性负例 · 摘要不匹配'},scope:'Public immutable source consistency; no actual deployment or investment claims'};
// Exclusive creation preserves client_ref and submitted evidence across resumed tests.
await writeFile(outputFile,JSON.stringify(cases,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({clientRef:spec.client_ref,author:spec.author,source:source.url,caseCount:3}));
