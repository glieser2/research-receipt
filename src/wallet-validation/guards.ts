import {abi,decodeInputData} from 'genlayer-js';
import {decodeFunctionData,encodeFunctionData,zeroAddress} from 'viem';
import {BRADBURY,REQUIRED_NAMES} from '../lib/bradbury';

export const SOURCE_SHA='5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf';
export const FORMAT='research-receipt/wallet-deployment-review/1';
export const LOCKED_ACTOR='0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd';
export const LOCKED_PLAN_SHA='e65905d24990f7f1bc0fd20ae8b172d57c3290f7ae531b9711077205a46839d0';
export const LOCKED_EXECUTION_RUN='v6-wallet-4';
export const LOCKED_GAS_LIMIT='31800000';
export const MAX_TX_GAS_LIMIT=32000000n;
export const MIN_ESTIMATE_HEADROOM_GAS=1000000n;
export const OLD_ACTORS=['0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70','0x7036138ada2052af0b07dae5a4d450effd9a40e3','0xfdb942f537095d8e0c36b97a3b0324de81db9c3f'];
export const OLD_PLANS=['c731fb736abc2bf2c70e48d5a72cd1e72195a0bc25aa50070d7a9a28564b506e','04dbef08dc757f7457808d04f320b8cade446ca507596388e9f275e830753f77','306f742ac1b8bbdb8c01f0125c565dafe2c059ff1627cc1ed4f62c5804924b89','76c2583b393255b241e670e5ba418a7517003d56afdfd1316f0c5c746c8a1b1a'];
export const SUPERSEDED_CONTRACTS=['0xc7d9a5e9fa776f76b1348c7009ea23de6d873885'];
export const STORAGE_KEY='research-receipt/wallet-v6-deployment-intent/1';
export type Request={chainId:string;from:`0x${string}`;to:`0x${string}`;data:`0x${string}`;value:string;nonce:string;gas:string;gasPrice:string;type:string};
type JsonRecord=Record<string,unknown>;
export type EstimateProof={request:Record<string,string>;blockNumber:string;blockHash:`0x${string}`;maxTxGasLimit:string;estimatedGas:string;success:boolean;result:string;response:{httpStatus:number;body:JsonRecord}};
export type Review=JsonRecord&{format:string;verified:boolean;actor:`0x${string}`;source:string;sourceSha256:string;planFile:string;planSha256:string;planBytesUtf8:string;deploymentRequest:Request;deploymentRequestHash:string;maxTotalCostWei:string;validUntil:string;verifiedAt:string;registryAddresses:Record<string,`0x${string}`>;feeQuote:{distribution:unknown;feeValue:string};ethEstimateGas:EstimateProof;ethCall:{request:Record<string,string>;blockNumber:string;blockHash:`0x${string}`;success:boolean;result:string;response:{httpStatus:number;body:JsonRecord}}};
export type Pending={format:string;requestHash:string;from:string;nonce:string;state:'uncertain'|'submitted';createdAt:string;envelopeHash?:string};
export const canonical=(value:unknown):string=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
export function requireValue(condition:unknown,message:string):asserts condition{if(!condition)throw Error(message);}
export async function sha256(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export const quantity=(value:string|bigint)=>'0x'+BigInt(value).toString(16);
export const callProjection=(r:Request)=>({from:r.from,to:r.to,data:r.data,value:quantity(r.value),gas:quantity(r.gas),gasPrice:quantity(r.gasPrice)});
export function walletRequest(r:Request){return {...callProjection(r),chainId:quantity(r.chainId),nonce:quantity(r.nonce),type:'0x0'};}
export function storageKeyForReview(review?:Pick<Review,'planSha256'>|null){if(!review)return STORAGE_KEY;requireValue(review.planSha256===LOCKED_PLAN_SHA,'新钱包测试计划摘要不匹配。');return `${STORAGE_KEY}:${LOCKED_PLAN_SHA}`;}
export function assertLocalDevelopment(host:string,development:boolean){requireValue(development&&['127.0.0.1','localhost','[::1]'].includes(host),'此工具仅支持本机开发服务。');}
export function freshProofTime(review:Review,now=Date.now()){
 const at=Date.parse(review.verifiedAt);requireValue(Number.isFinite(at)&&at<=now&&now-at<=600000,'只读执行证明已过期或时间无效。');
 requireValue(typeof review.validUntil==='string'&&/^(0|[1-9][0-9]*)$/.test(review.validUntil)&&BigInt(review.validUntil)*1000n>=BigInt(now+60000),'部署请求有效期不足。');
}
export async function validateReview(raw:unknown,now=Date.now()):Promise<Review>{
 requireValue(raw&&typeof raw==='object'&&!Array.isArray(raw),'缺少本地审核资料。');const v=raw as Review;
 requireValue(v.format===FORMAT&&v.verified===true&&!Object.hasOwn(v,'error')&&v.executionAuthority==='user-controlled-wallet','审核资料未完整验证。');
 requireValue(v.sourceSha256===SOURCE_SHA&&await sha256(v.source)===SOURCE_SHA,'实际待部署源码摘要不匹配。');
 requireValue(/^0x[0-9a-f]{40}$/.test(v.actor)&&!OLD_ACTORS.includes(v.actor)&&v.actor===LOCKED_ACTOR,'部署账户、网络或 gas 上限不匹配。');
 requireValue(/^[0-9a-f]{64}$/.test(v.planSha256)&&!OLD_PLANS.includes(v.planSha256)&&v.planSha256===LOCKED_PLAN_SHA&&await sha256(v.planBytesUtf8)===LOCKED_PLAN_SHA,'新钱包测试计划摘要不匹配。');
 const plan=JSON.parse(v.planBytesUtf8);requireValue(plan.mode==='prepared'&&plan.executionRun===LOCKED_EXECUTION_RUN&&plan.executionAuthority==='user-controlled-wallet'&&plan.policyVersion==='research-receipt/6'&&plan.requiredSignedCaseCount===51&&plan.actorCommitment?.actors?.owner?.toLowerCase()===LOCKED_ACTOR&&plan.deploymentSourceCommitment?.sha256===SOURCE_SHA,'钱包与冻结计划不匹配。');
 const r=v.deploymentRequest;requireValue(same(Object.keys(r).sort(),['chainId','from','to','data','value','nonce','gas','gasPrice','type'].sort()),'部署请求字段不匹配。');
 for(const key of ['chainId','value','nonce','gas','gasPrice'] as const)requireValue(/^(0|[1-9][0-9]*)$/.test(r[key]),'部署金额或 nonce 格式无效。');
 const gasLimit=BigInt(r.gas);
 requireValue(r.chainId==='4221'&&r.type==='legacy'&&r.gas===LOCKED_GAS_LIMIT&&gasLimit>=21000n&&gasLimit<=MAX_TX_GAS_LIMIT&&BigInt(r.gasPrice)>0n&&/^0x[0-9a-f]{40}$/.test(r.from)&&r.from===LOCKED_ACTOR&&!OLD_ACTORS.includes(r.from),'部署账户、网络或 gas 上限不匹配。');
 compareRegistry(v.registryAddresses,v.registryAddresses); // 审核资料必须完整、有效地列出全部协议地址，缺项不得被视为相等。
 requireValue(typeof v.validUntil==='string'&&/^(0|[1-9][0-9]*)$/.test(v.validUntil)&&typeof v.maxTotalCostWei==='string'&&/^(0|[1-9][0-9]*)$/.test(v.maxTotalCostWei),'有效期或费用上限格式无效。');
 requireValue(typeof v.feeQuote?.feeValue==='string'&&v.feeQuote.feeValue===r.value,'协议预存费用与报价不一致。');
 requireValue(r.to===v.registryAddresses.ConsensusMain.toLowerCase()&&/^0x(?:[0-9a-f]{2})+$/.test(r.data),'目标或 calldata 无效。');
 requireValue(BigInt(r.value)+gasLimit*BigInt(r.gasPrice)===BigInt(v.maxTotalCostWei)&&BigInt(v.maxTotalCostWei)<=50000000000000000n,'最大费用超过 0.05 测试 GEN。');
 requireValue(await sha256(canonical(r))===v.deploymentRequestHash,'精确部署请求摘要不匹配。');
 requireValue(v.officialSchemaVerified===true&&v.signatures===0&&v.chainTransactionsSent===0&&v.modelCalls===0&&v.ethEstimateGasRequestsStarted===1&&v.ethCallRequestsStarted===1,'审核资料声明了不允许的执行范围。');
 const call=v.ethCall;requireValue(call?.success===true&&same(call.request,callProjection(r))&&/^0x[0-9a-f]{64}$/i.test(call.blockHash)&&/^(0|[1-9][0-9]*)$/.test(call.blockNumber),'缺少精确请求只读执行证明。');
 requireValue(call.response.httpStatus>=200&&call.response.httpStatus<300&&call.response.body.jsonrpc==='2.0'&&call.response.body.id===1&&!Object.hasOwn(call.response.body,'error')&&/^0x[0-9a-f]{64}$/i.test(call.result)&&call.response.body.result===call.result,'只读执行响应无效。');
 const est=v.ethEstimateGas;requireValue(est?.success===true&&same(est.request,callProjection(r))&&est.blockNumber===call.blockNumber&&est.blockHash.toLowerCase()===call.blockHash.toLowerCase()&&/^(0|[1-9][0-9]*)$/.test(est.estimatedGas)&&/^(0|[1-9][0-9]*)$/.test(est.maxTxGasLimit),'缺少同区块 eth_estimateGas 边界证明。');
 requireValue(est.response.httpStatus>=200&&est.response.httpStatus<300&&est.response.body.jsonrpc==='2.0'&&est.response.body.id===1&&!Object.hasOwn(est.response.body,'error')&&/^0x[0-9a-f]+$/i.test(est.result)&&est.response.body.result===est.result&&BigInt(est.result)===BigInt(est.estimatedGas),'eth_estimateGas 响应无效。');
 requireValue(BigInt(est.estimatedGas)>=21000n&&BigInt(est.estimatedGas)+MIN_ESTIMATE_HEADROOM_GAS<=gasLimit&&gasLimit<BigInt(est.maxTxGasLimit)&&BigInt(est.maxTxGasLimit)<=MAX_TX_GAS_LIMIT,'估算 gas 超出 Bradbury 32M 单笔上限或安全余量不足。');
 freshProofTime(v,now);return v;
}
export async function validateDeploymentCalldata(review:Review,consensusAbi:Parameters<typeof decodeFunctionData>[0]['abi']){
 const d=decodeFunctionData({abi:consensusAbi,data:review.deploymentRequest.data});requireValue(d.functionName==='addTransaction'&&d.args?.length===1,'不是单次协议部署。');
 requireValue(encodeFunctionData({abi:consensusAbi,functionName:'addTransaction',args:d.args})===review.deploymentRequest.data,'协议 calldata 重编码不匹配。');
 const p=d.args[0] as {sender:string;recipient:string;numOfInitialValidators:bigint;maxRotations:bigint;validUntil:bigint;saltNonce:bigint;userValue:bigint;feesDistribution:unknown;txCalldata:`0x${string}`;messageAllocations:unknown[]};
 requireValue(p.sender.toLowerCase()===review.actor&&p.recipient===zeroAddress&&p.numOfInitialValidators===5n&&p.maxRotations===3n&&p.saltNonce===0n&&p.userValue===0n&&String(p.validUntil)===review.validUntil&&same(p.messageAllocations,[])&&same(p.feesDistribution,review.feeQuote.distribution),'部署字段与审核资料不匹配。');
 const deployed=decodeInputData(p.txCalldata,zeroAddress);requireValue(deployed&&deployed.type==='deploy'&&'constructorArgs' in deployed&&'code' in deployed,'部署解码类型不匹配。');const ctor=deployed.constructorArgs;
 requireValue(deployed.code===review.source&&deployed.leaderOnly===false&&same(ctor instanceof Map?Object.fromEntries(ctor):ctor,{}),'非空构造参数、源码或 leader 标记不匹配。');
 requireValue(same(p.txCalldata,abi.transactions.serialize([review.source,abi.calldata.encode(abi.calldata.makeCalldataObject(undefined,[],undefined)),false])),'部署内容不是已锁定的零参数编码。');
}
export function readPending(storage:Pick<Storage,'getItem'>,key=STORAGE_KEY):Pending|null{
 const raw=storage.getItem(key);if(raw===null)return null;try{const v=JSON.parse(raw);requireValue(v?.format===key&&['uncertain','submitted'].includes(v.state)&&typeof v.requestHash==='string'&&/^[0-9a-f]{64}$/.test(v.requestHash)&&typeof v.from==='string'&&/^0x[0-9a-f]{40}$/.test(v.from)&&typeof v.nonce==='string'&&/^(0|[1-9][0-9]*)$/.test(v.nonce)&&typeof v.createdAt==='string'&&Number.isFinite(Date.parse(v.createdAt))&&(v.state==='uncertain'||(typeof v.envelopeHash==='string'&&/^0x[0-9a-f]{64}$/i.test(v.envelopeHash))),'未决记录格式无效。');return v;}catch{throw Error('已有无法解析的部署恢复记录，停止发送。');}
}
export function persistUncertain(storage:Pick<Storage,'setItem'|'getItem'>,review:Review,now=Date.now(),key=STORAGE_KEY){
 requireValue(readPending(storage,key)===null,'已有部署意图，禁止重复发送。');const value:Pending={format:key,requestHash:review.deploymentRequestHash,from:review.actor,nonce:review.deploymentRequest.nonce,state:'uncertain',createdAt:new Date(now).toISOString()};
 const bytes=JSON.stringify(value);storage.setItem(key,bytes);requireValue(storage.getItem(key)===bytes,'未决意图保存失败，停止发送。');return value;
}
export function persistHash(storage:Pick<Storage,'setItem'|'getItem'>,pending:Pending,hash:unknown,key=pending.format){
 requireValue(typeof hash==='string'&&/^0x[0-9a-f]{64}$/i.test(hash),'钱包未返回有效 EVM 哈希，意图保持未决。');
 const value:Pending={...pending,state:'submitted',envelopeHash:hash},bytes=JSON.stringify(value);storage.setItem(key,bytes);requireValue(storage.getItem(key)===bytes,'哈希保存失败；请保留已显示的 EVM 哈希，勿重发。');return value;
}
export async function requestWalletDeployment({review,storage,provider,preflight,userConfirmed,onHash,storageKey=STORAGE_KEY}:{review:Review;storage:Pick<Storage,'setItem'|'getItem'>;provider:{request:(r:{method:string;params?:unknown[]})=>Promise<unknown>};preflight:()=>Promise<void>;userConfirmed:boolean;onHash?:(hash:string)=>void;storageKey?:string}){
 requireValue(userConfirmed,'必须由用户明确确认部署。');requireValue(readPending(storage,storageKey)===null,'已有部署意图，禁止重复发送。');await preflight();const intent=persistUncertain(storage,review,Date.now(),storageKey);
 const hash=await provider.request({method:'eth_sendTransaction',params:[walletRequest(review.deploymentRequest)]});requireValue(typeof hash==='string'&&/^0x[0-9a-f]{64}$/i.test(hash),'钱包未返回有效 EVM 哈希，意图保持未决。');onHash?.(hash);return persistHash(storage,intent,hash,storageKey);
}
export function compareRegistry(actual:Record<string,string>|undefined,expected:Record<string,string>|undefined){
  // 双方都缺失同一项时，旧的 undefined===undefined 比较会误判为一致；这里要求每项都是有效非零地址。
  requireValue(REQUIRED_NAMES.every(name=>{const a=actual?.[name],e=expected?.[name];return typeof a==='string'&&typeof e==='string'&&/^0x[0-9a-fA-F]{40}$/.test(a)&&/^0x[0-9a-fA-F]{40}$/.test(e)&&a.toLowerCase()!==zeroAddress&&a.toLowerCase()===e.toLowerCase();}),'协议 registry 已变化或不完整。');
}
export const CASE_FORMAT='research-receipt/wallet-case-review/1';
export const CASE_STORAGE_PREFIX='research-receipt/wallet-v6-case-intent/1';
export type CaseReview=JsonRecord&{format:string;verified:boolean;executionAuthority:string;executionRun:string;planSha256:string;sourceSha256:string;actor:`0x${string}`;contractAddress:`0x${string}`;sequence:number;caseName:string;phase:string;method:string;args:(string|number)[];expectedExecutionResult:'RETURN'|'ERROR';expectedError:string|null;callRequest:Request;callRequestHash:string;maxTotalCostWei:string;validUntil:string;verifiedAt:string;registryAddresses:Record<string,`0x${string}`>;feeQuote:{distribution:unknown;feeValue:string};ethEstimateGas:{blockNumber:string;blockHash:`0x${string}`;maxTxGasLimit:string;estimatedGas:string;selectedGas:string;result:string;success:boolean};ethCall:{request:Record<string,string>;blockNumber:string;blockHash:`0x${string}`;result:string;success:boolean}};
export function storageKeyForCase(review:Pick<CaseReview,'planSha256'|'sequence'>){
 requireValue(review.planSha256===LOCKED_PLAN_SHA&&Number.isInteger(review.sequence)&&review.sequence>=2&&review.sequence<=51,'用例审核资料计划或序号无效。');
 return `${CASE_STORAGE_PREFIX}:${LOCKED_PLAN_SHA}:${review.sequence}`;
}
export async function validateCaseReview(raw:unknown,now=Date.now()):Promise<CaseReview>{
 requireValue(raw&&typeof raw==='object'&&!Array.isArray(raw),'缺少用例审核资料。');const v=raw as CaseReview;
 requireValue(v.format===CASE_FORMAT&&v.verified===true&&!Object.hasOwn(v,'error')&&v.executionAuthority==='user-controlled-wallet'&&v.executionRun===LOCKED_EXECUTION_RUN,'用例审核资料未完整验证。');
 requireValue(v.planSha256===LOCKED_PLAN_SHA&&v.sourceSha256===SOURCE_SHA&&v.actor===LOCKED_ACTOR,'用例计划、源码或锁定账户不匹配。');
 requireValue(typeof v.contractAddress==='string'&&/^0x[0-9a-f]{40}$/.test(v.contractAddress)&&v.contractAddress!==zeroAddress&&!SUPERSEDED_CONTRACTS.includes(v.contractAddress),'合约地址无效或为已归档历史合约。');
 requireValue(Number.isInteger(v.sequence)&&v.sequence>=2&&v.sequence<=51&&typeof v.caseName==='string'&&v.caseName.length>0&&typeof v.method==='string'&&Array.isArray(v.args),'用例序号或方法无效。');
 const r=v.callRequest;requireValue(same(Object.keys(r).sort(),['chainId','from','to','data','value','nonce','gas','gasPrice','type'].sort()),'用例交易请求字段不匹配。');
 for(const key of ['chainId','value','nonce','gas','gasPrice'] as const)requireValue(/^(0|[1-9][0-9]*)$/.test(r[key]),'用例金额或 nonce 格式无效。');
 const gasLimit=BigInt(r.gas);
 requireValue(r.chainId==='4221'&&r.type==='legacy'&&gasLimit>200000n&&gasLimit<=BigInt(LOCKED_GAS_LIMIT)&&gasLimit<=MAX_TX_GAS_LIMIT&&BigInt(r.gasPrice)>0n&&r.from===LOCKED_ACTOR,'用例账户、网络或 gas 上限无效。');
 compareRegistry(v.registryAddresses,v.registryAddresses);
 requireValue(r.to===v.registryAddresses.ConsensusMain.toLowerCase()&&/^0x(?:[0-9a-f]{2})+$/.test(r.data),'用例目标或 calldata 无效。');
 requireValue(typeof v.feeQuote?.feeValue==='string'&&v.feeQuote.feeValue===r.value,'协议预存费用与报价不一致。');
 requireValue(BigInt(r.value)+gasLimit*BigInt(r.gasPrice)===BigInt(v.maxTotalCostWei)&&BigInt(v.maxTotalCostWei)<=50000000000000000n,'用例最大费用超过 0.05 测试 GEN。');
 requireValue(await sha256(canonical(r))===v.callRequestHash,'精确用例请求摘要不匹配。');
 const call=v.ethCall,est=v.ethEstimateGas;
 requireValue(call?.success===true&&same(call.request,callProjection(r))&&/^0x[0-9a-f]{64}$/i.test(call.result)&&est?.success===true&&est.blockNumber===call.blockNumber&&est.blockHash.toLowerCase()===call.blockHash.toLowerCase()&&/^0x[0-9a-f]+$/i.test(est.result)&&BigInt(est.result)===BigInt(est.estimatedGas)&&est.selectedGas===r.gas,'缺少同区块用例 eth_estimateGas / eth_call 证明或字段不一致。');
 requireValue(BigInt(est.estimatedGas)>200000n&&BigInt(est.estimatedGas)+MIN_ESTIMATE_HEADROOM_GAS<=gasLimit&&gasLimit<BigInt(est.maxTxGasLimit)&&BigInt(est.maxTxGasLimit)<=MAX_TX_GAS_LIMIT,'用例估算 gas 安全余量不足。');
 freshProofTime(v as unknown as Review,now);return v;
}
export async function validateCaseCalldata(review:CaseReview,consensusAbi:Parameters<typeof decodeFunctionData>[0]['abi']){
 const d=decodeFunctionData({abi:consensusAbi,data:review.callRequest.data});requireValue(d.functionName==='addTransaction'&&d.args?.length===1,'不是单次协议调用。');
 requireValue(encodeFunctionData({abi:consensusAbi,functionName:'addTransaction',args:d.args})===review.callRequest.data,'协议 calldata 重编码不匹配。');
 const p=d.args[0] as {sender:string;recipient:string;numOfInitialValidators:bigint;maxRotations:bigint;validUntil:bigint;saltNonce:bigint;userValue:bigint;feesDistribution:unknown;txCalldata:`0x${string}`;messageAllocations:unknown[]};
 requireValue(p.sender.toLowerCase()===LOCKED_ACTOR&&p.recipient.toLowerCase()===review.contractAddress&&p.numOfInitialValidators===5n&&p.maxRotations===3n&&p.saltNonce===0n&&p.userValue===0n&&String(p.validUntil)===review.validUntil&&same(p.messageAllocations,[])&&same(p.feesDistribution,review.feeQuote.distribution),'用例协议包络字段与审核资料不匹配。');
 const decoded=decodeInputData(p.txCalldata,review.contractAddress);
 requireValue(decoded&&decoded.type==='call'&&decoded.leaderOnly===false&&'callData' in decoded,'用例调用解码类型或 leaderOnly 不匹配。');
 const callMap=decoded.callData;const field=(k:string)=>callMap instanceof Map?callMap.get(k):(callMap as Record<string,unknown>)?.[k];
 const kwargs=field('kwargs');const emptyKw=kwargs===undefined||(kwargs instanceof Map?kwargs.size===0:typeof kwargs==='object'&&kwargs!==null&&Object.keys(kwargs).length===0);
 const actualArgs=field('args')||[];
 const sameArgs=Array.isArray(actualArgs)&&actualArgs.length===review.args.length&&review.args.every((exp,i)=>typeof exp==='number'?Number.isSafeInteger(exp)&&(typeof actualArgs[i]==='bigint'?actualArgs[i]===BigInt(exp):actualArgs[i]===exp):actualArgs[i]===exp);
 requireValue(field('')===review.method&&emptyKw&&sameArgs,'用例方法、参数或 kwargs 与冻结计划不一致。');
}
export async function requestWalletCase({review,storage,provider,preflight,userConfirmed,onHash}:{review:CaseReview;storage:Pick<Storage,'setItem'|'getItem'>;provider:{request:(r:{method:string;params?:unknown[]})=>Promise<unknown>};preflight:()=>Promise<void>;userConfirmed:boolean;onHash?:(hash:string)=>void}){
 const key=storageKeyForCase(review);requireValue(userConfirmed,'必须由用户明确确认该笔用例交易。');requireValue(readPending(storage,key)===null,'该用例已有发送意图，禁止重复发送。');await preflight();
 const value:Pending={format:key,requestHash:review.callRequestHash,from:review.actor,nonce:review.callRequest.nonce,state:'uncertain',createdAt:new Date().toISOString()};
 const bytes=JSON.stringify(value);storage.setItem(key,bytes);requireValue(storage.getItem(key)===bytes,'用例未决意图保存失败，停止发送。');
 const hash=await provider.request({method:'eth_sendTransaction',params:[walletRequest(review.callRequest)]});requireValue(typeof hash==='string'&&/^0x[0-9a-f]{64}$/i.test(hash),'钱包未返回有效 EVM 哈希，用例意图保持未决。');onHash?.(hash);return persistHash(storage,value,hash,key);
}
export {BRADBURY,REQUIRED_NAMES};
