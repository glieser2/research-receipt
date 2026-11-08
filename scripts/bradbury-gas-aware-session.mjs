// One fresh in-memory deployment signer. Import/default CLI does not connect,
// generate an account, sign, or send. No old account/key or raw signed envelope
// is read, printed, persisted, or exported. This is not a business write session.
import {createHash} from 'node:crypto';
import {readFile,open,mkdir,realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {abi,createAccount,decodeInputData,normalizeTransactionFees} from 'genlayer-js';
import {createPublicClient,http,encodeFunctionData,decodeFunctionData,decodeEventLog,parseAbi,parseAbiItem,keccak256,zeroAddress,parseTransaction,recoverTransactionAddress} from 'viem';
import {BRADBURY,REQUIRED_NAMES,PROJECT_ROOT,connectBradbury,quoteDevelopmentProfile,publicJson} from './bradbury-client.mjs';

export const SOURCE_FILE='contracts/research_receipt_v6_compact.py';
export const SOURCE_SHA='e053f1b4250b6a0e7717722c54dfe97717a5d341b374d9404d7b5b2c057e1fcb';
export const PLAN_FILE='docs/evidence/v6-validation-plan.json';
export const PLAN_SHA='c731fb736abc2bf2c70e48d5a72cd1e72195a0bc25aa50070d7a9a28564b506e';
export const ENDPOINTS=Object.freeze([BRADBURY.rpcUrl,'https://rpc.testnet-chain.genlayer.com']);
export const MANUAL_GAS=100000000n;
export const MAX_TOTAL_COST=50000000000000000n; // Hard 0.05 test GEN envelope+deposit bound.
export const ACK='AUTHORIZE_ONE_FRESH_V6_TESTNET_DEPLOYMENT';
export const MAX_PUBLIC_DOCUMENT_BYTES=1048576;
const PROOF_AGE_MS=600000,INTENT_AGE_MS=600000;
const ADDRESS=/^0x[0-9a-fA-F]{40}$/,HASH=/^0x[0-9a-fA-F]{64}$/,SHA=/^[0-9a-f]{64}$/;
const REQUEST_KEYS=['chainId','from','to','data','value','nonce','gas','gasPrice','type'];
export class GuardError extends Error {constructor(code){super(code);this.name='GuardError';this.code=code;}}
const guard=(condition,code)=>{if(!condition)throw new GuardError(code);};
export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const same=(a,b)=>canonical(a)===canonical(b);
const exactKeys=(value,keys,code)=>guard(value&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),[...keys].sort()),code);
const amount=value=>{guard(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value),'DECIMAL_AMOUNT_REQUIRED');const n=BigInt(value);guard(n<(1n<<256n),'AMOUNT_TOO_LARGE');return n;};
const quantity=value=>'0x'+BigInt(value).toString(16);
const lower=value=>String(value).toLowerCase();
export const deploymentRequestHash=request=>sha256(canonical(request));
export const callProjection=request=>({from:request.from,to:request.to,data:request.data,value:quantity(request.value),gas:quantity(request.gas),gasPrice:quantity(request.gasPrice)});
export function safeFailure(error){return {code:error instanceof GuardError?error.code:'UNTRUSTED_OPERATION_FAILED',detailSha256:sha256(String(error?.shortMessage||error?.message||'Operation failed.'))};}
export function validateEndpoint(endpoint){guard(ENDPOINTS.includes(endpoint),'UNREVIEWED_L2_ENDPOINT');return endpoint;}

export function validateRequest(request){
 exactKeys(request,REQUEST_KEYS,'UNSIGNED_REQUEST_SHAPE');
 guard(request.chainId==='4221'&&request.type==='legacy','UNSIGNED_REQUEST_CHAIN_OR_TYPE');
 for(const key of ['chainId','value','nonce','gas','gasPrice'])amount(request[key]);
 guard(ADDRESS.test(request.from)&&request.from===lower(request.from)&&ADDRESS.test(request.to)&&request.to===lower(request.to),'UNSIGNED_REQUEST_ADDRESS');
 guard(/^0x(?:[0-9a-f]{2})+$/.test(request.data),'UNSIGNED_REQUEST_DATA');
 guard(amount(request.gas)>=21000n&&amount(request.gas)<=MANUAL_GAS&&amount(request.gasPrice)>0n,'GAS_BOUND');
 guard(amount(request.nonce)<=BigInt(Number.MAX_SAFE_INTEGER),'NONCE_RANGE');
 const cost=amount(request.value)+amount(request.gas)*amount(request.gasPrice);
 guard(cost<=MAX_TOTAL_COST,'TOTAL_COST_HARD_CAP');return cost;
}

export function buildDeploymentRequest({source,address,context,validUntil,gas,expectedSourceSha=SOURCE_SHA}){
 guard(sha256(Buffer.from(source,'utf8'))===expectedSourceSha,'SOURCE_COMMITMENT_MISMATCH');
 guard(ADDRESS.test(address)&&context.chain.defaultNumberOfInitialValidators===5&&context.chain.defaultConsensusMaxRotations===3,'DEPLOYMENT_PROFILE_MISMATCH');
 const ctor=abi.calldata.makeCalldataObject(undefined,[]);
 guard(same(ctor,{}),'SDK_EMPTY_CONSTRUCTOR_CHANGED');
 const appData=abi.transactions.serialize([source,abi.calldata.encode(ctor),false]);
 const decoded=decodeInputData(appData,zeroAddress);
 const constructor=decoded?.constructorArgs instanceof Map?Object.fromEntries(decoded.constructorArgs):decoded?.constructorArgs;
 guard(decoded?.type==='deploy'&&decoded.code===source&&decoded.leaderOnly===false&&same(constructor,{}),'SDK_DEPLOYMENT_CODEC_MISMATCH');
 const fees=normalizeTransactionFees({distribution:context.quote.distribution,feeValue:BigInt(context.quote.feeValue)});
 guard(same(fees.messageAllocations,[]),'UNEXPECTED_MESSAGE_ALLOCATIONS');
 const params={sender:address,recipient:zeroAddress,numOfInitialValidators:5n,maxRotations:3n,validUntil:BigInt(validUntil),saltNonce:0n,userValue:0n,feesDistribution:fees.distribution,txCalldata:appData,messageAllocations:[]};
 const data=encodeFunctionData({abi:context.chain.consensusMainContract.abi,functionName:'addTransaction',args:[params]}).toLowerCase();
 const roundtrip=decodeFunctionData({abi:context.chain.consensusMainContract.abi,data});
 guard(roundtrip.functionName==='addTransaction'&&encodeFunctionData({abi:context.chain.consensusMainContract.abi,functionName:'addTransaction',args:roundtrip.args}).toLowerCase()===data,'SDK_ENVELOPE_ROUNDTRIP_FAILED');
 const request={chainId:'4221',from:lower(address),to:lower(context.metadata.addresses.ConsensusMain),data,value:String(context.quote.feeValue),nonce:String(context.latestNonce),gas:String(gas),gasPrice:String(context.gasPrice),type:'legacy'};
 validateRequest(request);return request;
}

function validateContext(context,address,{allowPending=false}={}){
 guard(context?.metadata?.chainId===4221&&lower(context.metadata.genesisHash)===BRADBURY.genesisHash&&lower(context.metadata.addressManager)===lower(BRADBURY.addressManager),'NETWORK_IDENTITY_MISMATCH');
 guard(context.registryCodeMatches===true&&HASH.test(context.headHash)&&BigInt(context.headNumber)>=0n,'REGISTRY_OR_BLOCK_UNVERIFIED');
 for(const key of REQUIRED_NAMES)guard(ADDRESS.test(context.metadata.addresses?.[key])&&lower(context.metadata.addresses[key])!==zeroAddress,'REGISTRY_ADDRESS_MISSING');
 guard(context.address===lower(address)&&(allowPending||String(context.latestNonce)===String(context.pendingNonce)),'PENDING_OR_WRONG_ACCOUNT_NONCE');
 guard(BigInt(context.latestNonce)>=0n&&BigInt(context.gasPrice)>0n,'FRESH_NONCE_OR_PRICE_INVALID');
 const d=context.quote?.distribution;
 guard(d&&BigInt(d.leaderTimeunitsAllocation)===600n&&BigInt(d.validatorTimeunitsAllocation)===600n&&BigInt(d.appealRounds)===0n&&BigInt(d.executionBudgetPerRound)===10000000000000000n&&same(d.rotations,[3n]),'FEE_PROFILE_MISMATCH');
 guard(BigInt(context.quote.feeValue)>0n,'FEE_VALUE_INVALID');
}

export async function validateSignedEnvelope(serialized,request){
 const parsed=parseTransaction(serialized);
 guard(parsed.type==='legacy'&&String(parsed.chainId)===request.chainId&&String(parsed.nonce)===request.nonce&&lower(parsed.to)===request.to&&lower(parsed.data)===request.data&&String(parsed.value)===request.value&&String(parsed.gas)===request.gas&&String(parsed.gasPrice)===request.gasPrice,'SIGNED_ENVELOPE_REQUEST_MISMATCH');
 guard(lower(await recoverTransactionAddress({serializedTransaction:serialized}))===request.from,'SIGNED_ENVELOPE_SENDER_MISMATCH');
 return true;
}

export function validateManualProof(proof,inspection,now=Date.now()){
 guard(proof&&proof.format==='research-receipt/v6-manual-gas-exact-call-proof/1'&&proof.verified===true&&!Object.hasOwn(proof,'error'),'MANUAL_PROOF_NOT_FULLY_VERIFIED');
 guard(proof.planSha256===PLAN_SHA&&proof.sourceSha256===SOURCE_SHA&&proof.chainId===4221&&lower(proof.genesisHash)===BRADBURY.genesisHash,'MANUAL_PROOF_IDENTITY');
 guard(lower(proof.addressManager)===lower(BRADBURY.addressManager)&&same(proof.registryAddresses,inspection.registryAddresses)&&proof.l2Endpoint===inspection.l2Endpoint,'MANUAL_PROOF_REGISTRY');
 guard(same(proof.deploymentRequest,inspection.deploymentRequest)&&proof.deploymentRequestHash===inspection.deploymentRequestHash&&deploymentRequestHash(proof.deploymentRequest)===inspection.deploymentRequestHash,'MANUAL_PROOF_REQUEST');
 guard(proof.gasLimit==='100000000'&&proof.gasLimit===inspection.gasLimit&&proof.gasPriceWei===inspection.gasPriceWei&&proof.maxTotalCostWei===inspection.maxTotalCostWei&&proof.validUntil===inspection.validUntil,'MANUAL_PROOF_CAPS');
 guard(proof.simulationOnly===true&&proof.consensusProven===false&&proof.signatures===0&&proof.chainTransactionsSent===0&&proof.modelCalls===0&&proof.ethCallRequestsStarted===1,'MANUAL_PROOF_SCOPE');
 const verifiedAt=Date.parse(proof.verifiedAt);
 guard(Number.isFinite(verifiedAt)&&verifiedAt<=now&&now-verifiedAt<=PROOF_AGE_MS,'MANUAL_PROOF_EXPIRED');
 const call=proof.ethCall;
 guard(call?.success===true&&HASH.test(call.blockHash)&&typeof call.blockNumber==='string'&&/^(0|[1-9][0-9]*)$/.test(call.blockNumber)&&same(call.request,callProjection(inspection.deploymentRequest)),'MANUAL_PROOF_EXACT_CALL');
 guard(HASH.test(call.result)&&call.response?.httpStatus>=200&&call.response.httpStatus<300&&call.response?.body?.jsonrpc==='2.0'&&call.response?.body?.id===1&&!Object.hasOwn(call.response.body,'error')&&call.response.body.result===call.result,'MANUAL_PROOF_CALL_RESPONSE');
 guard(proof.nonceEvidence?.latest===inspection.deploymentRequest.nonce&&proof.nonceEvidence?.pending===inspection.deploymentRequest.nonce&&proof.nonceEvidence?.blockNumber===call.blockNumber,'MANUAL_PROOF_NONCE');
 const net=proof.networkEvidence;
 guard(net?.chainId===4221&&lower(net.genesisHash)===BRADBURY.genesisHash&&net.l2ChainId===4221&&lower(net.l2GenesisHash)===BRADBURY.genesisHash&&lower(net.addressManager)===lower(BRADBURY.addressManager)&&same(net.addresses,inspection.registryAddresses)&&net.blockNumber===call.blockNumber&&net.blockHash===call.blockHash&&net.registryCodeMatches===true,'MANUAL_PROOF_NETWORK_EVIDENCE');
 guard(amount(proof.balanceWei)>=amount(inspection.maxTotalCostWei),'MANUAL_PROOF_FUNDING');
 return {blockNumber:call.blockNumber,blockHash:call.blockHash,verifiedAt:proof.verifiedAt,requestHash:proof.deploymentRequestHash};
}

export function validateAddendum(addendum,inspection,{proofFile=null,proofSha256=null,originalOwner}={}){
 guard(addendum?.format==='research-receipt/v6-deployment-transport-addendum/1'&&addendum.planSha256===PLAN_SHA&&addendum.sequence===1&&addendum.caseName==='deployment','TRANSPORT_ADDENDUM_IDENTITY');
 guard(lower(addendum.originalOwner)===lower(originalOwner)&&lower(addendum.remainingCasesActor)===lower(originalOwner)&&lower(addendum.deploymentSender)===inspection.deploymentRequest.from&&inspection.deploymentRequest.from!==lower(originalOwner),'TRANSPORT_SENDER_EXCEPTION');
 guard(addendum.contractAddress===null||ADDRESS.test(addendum.contractAddress),'TRANSPORT_CONTRACT_ADDRESS');
 guard(addendum.chainId===4221&&lower(addendum.genesisHash)===BRADBURY.genesisHash&&lower(addendum.addressManager)===lower(BRADBURY.addressManager)&&same(addendum.registryAddresses,inspection.registryAddresses)&&addendum.l2Endpoint===inspection.l2Endpoint,'TRANSPORT_NETWORK');
 guard(addendum.sourceSha256===SOURCE_SHA&&same(addendum.constructorArgs,[])&&addendum.leaderOnly===false&&addendum.reasonCode==='DEFAULT_ESTIMATE_REVERT_TRANSPORT','TRANSPORT_SOURCE_OR_SCOPE');
 guard(addendum.deploymentRequestHash===inspection.deploymentRequestHash&&addendum.gasLimit===inspection.gasLimit&&addendum.gasPriceWei===inspection.gasPriceWei&&addendum.maxTotalCostWei===inspection.maxTotalCostWei&&addendum.validUntil===inspection.validUntil,'TRANSPORT_EXACT_REQUEST_CAPS');
 guard(addendum.manualProofFile===proofFile&&addendum.manualProofSha256===proofSha256&&Number.isFinite(Date.parse(addendum.reviewedAt)),'TRANSPORT_PROOF_APPROVAL');
 return true;
}

export function createGasAwareSession({address,source,originalOwner,writeCapability=false,deps}){
 guard(ADDRESS.test(address)&&lower(address)!==lower(originalOwner),'FRESH_ACCOUNT_REQUIRED');
 guard(sha256(Buffer.from(source,'utf8'))===SOURCE_SHA,'SOURCE_COMMITMENT_MISMATCH');
 let phase='CREATED',inspection=null,inspectionRecord=null,intent=null,intentRecord=null,proof=null,expectedEvmHash=null,sendAttempted=false;
 const now=()=>deps.now?deps.now():Date.now();
 const persist=(stage,value)=>deps.persist(stage,value);
 const summary=()=>({address:lower(address),phase,writeCapability,privateKeysPersisted:false,rawSignedEnvelopePersisted:false,resubmissionAllowed:false,inspection:inspectionRecord,intent:intentRecord,expectedEvmHash});
 async function fresh(needFunding=false,enforceFrozen=true){
  const context=await deps.fresh();validateContext(context,address,{allowPending:!enforceFrozen});
  if(inspection){
   guard(same(context.metadata.addresses,inspection.registryAddresses),'REGISTRY_DRIFT');
   if(!enforceFrozen)return context;
   guard(String(context.latestNonce)===inspection.deploymentRequest.nonce,'NONCE_DRIFT');
   guard(String(context.gasPrice)===inspection.gasPriceWei,'GAS_PRICE_DRIFT');
   const rebuilt=buildDeploymentRequest({source,address,context,validUntil:inspection.validUntil,gas:inspection.gasLimit});
   guard(same(rebuilt,inspection.deploymentRequest),'FEE_OR_PAYLOAD_DRIFT');
   guard(BigInt(inspection.validUntil)>=BigInt(context.headTimestamp)+60n,'VALID_UNTIL_EXPIRED');
   if(needFunding)guard(BigInt(context.balance)>=amount(inspection.maxTotalCostWei),'INSUFFICIENT_DEPLOYMENT_FUNDING');
  }
  return context;
 }
 async function inspect(options={}){
  if(inspectionRecord)return {state:summary(),inspectionFile:inspectionRecord.path,inspectionSha256:inspectionRecord.sha256,cached:true};
  guard(phase==='CREATED','INSPECTION_ALREADY_CONSUMED');phase='INSPECTING';
  try{
   const mode=options.gasMode??'default';guard(['default','manual'].includes(mode),'UNKNOWN_GAS_MODE');
   const capPrice=amount(options.maxGasPriceWei),capTotal=amount(options.totalCostCapWei);
   guard(capPrice>0n&&capTotal>0n&&capTotal<=MAX_TOTAL_COST,'OPERATOR_CAP_INVALID');
   const c=await fresh();guard(BigInt(c.gasPrice)<=capPrice,'GAS_PRICE_ABOVE_OPERATOR_CAP');
   const validUntil=String(BigInt(c.headTimestamp)+3600n);
   let gas=MANUAL_GAS;
   if(mode==='default'){
    const candidate=buildDeploymentRequest({source,address,context:c,validUntil,gas:MANUAL_GAS});
    const call=callProjection(candidate);delete call.gas;
    gas=BigInt(await deps.estimate(call));guard(gas>=21000n&&gas<=MANUAL_GAS,'ESTIMATED_GAS_ABOVE_CAP');
   }
   const request=buildDeploymentRequest({source,address,context:c,validUntil,gas});
   const cost=validateRequest(request);guard(cost<=capTotal,'TOTAL_COST_ABOVE_OPERATOR_CAP');
   inspection={format:'research-receipt/v6-gas-aware-inspection/1',planSha256:PLAN_SHA,sourceSha256:SOURCE_SHA,chainId:4221,genesisHash:BRADBURY.genesisHash,addressManager:BRADBURY.addressManager,registryAddresses:c.metadata.addresses,l2Endpoint:validateEndpoint(c.l2Endpoint),deploymentRequest:request,deploymentRequestHash:deploymentRequestHash(request),gasMode:mode,gasLimit:String(gas),gasPriceWei:request.gasPrice,maxGasPriceWei:String(capPrice),maxTotalCostWei:String(cost),totalCostCapWei:String(capTotal),validUntil,inspectedAt:new Date(now()).toISOString(),inspectedBlockNumber:String(c.headNumber),inspectedBlockHash:c.headHash,feeQuote:{distribution:c.quote.distribution,feeValueWei:String(c.quote.feeValue),scope:c.feeScope},balanceWei:String(c.balance),fundingRequiredWei:String(cost),constructorArgs:[],sdkDecodedConstructor:{},leaderOnly:false,nonceEvidence:{latest:String(c.latestNonce),pending:String(c.pendingNonce)},feeProfileSha256:c.feeProfileSha256,signatures:0,chainTransactionsSent:0};
   inspectionRecord=await persist('inspection',inspection);phase='INSPECTED';
   return {state:summary(),inspectionFile:inspectionRecord.path,inspectionSha256:inspectionRecord.sha256,deploymentRequestHash:inspection.deploymentRequestHash,gasMode:mode,gasLimit:String(gas),gasPriceWei:request.gasPrice,maxTotalCostWei:String(cost),balanceWei:String(c.balance),validUntil};
  }catch(error){phase='INSPECTION_BLOCKED';await persist('inspection-blocked',{address:lower(address),planSha256:PLAN_SHA,sourceSha256:SOURCE_SHA,error:safeFailure(error),noSignature:true,noBroadcast:true});throw error;}
 }
 async function prepare(request){
  guard(phase==='INSPECTED'&&inspection&&inspectionRecord,'NO_REUSABLE_INSPECTION');
  guard(request.inspectionSha256===inspectionRecord.sha256,'INSPECTION_REVIEW_HASH_REQUIRED');
  guard(SHA.test(request.addendumSha256),'ADDENDUM_REVIEW_HASH_REQUIRED');
  const addendum=await deps.readReviewed(request.addendumFile,request.addendumSha256);
  let proofSummary=null;
  if(inspection.gasMode==='manual'){
   guard(SHA.test(request.manualProofSha256),'MANUAL_PROOF_REVIEW_HASH_REQUIRED');
   proof=await deps.readReviewed(request.manualProofFile,request.manualProofSha256);
   proofSummary=validateManualProof(proof,inspection,now());
  }else guard(request.manualProofFile==null&&request.manualProofSha256==null,'DEFAULT_MODE_MUST_NOT_CLAIM_MANUAL_PROOF');
  validateAddendum(addendum,inspection,{proofFile:request.manualProofFile??null,proofSha256:request.manualProofSha256??null,originalOwner});
  phase='PREPARING';
  intent={format:'research-receipt/v6-gas-aware-deployment-intent/1',inspectionFile:inspectionRecord.path,inspectionSha256:inspectionRecord.sha256,planSha256:PLAN_SHA,sourceSha256:SOURCE_SHA,deploymentRequest:inspection.deploymentRequest,deploymentRequestHash:inspection.deploymentRequestHash,gasMode:inspection.gasMode,gasLimit:inspection.gasLimit,gasPriceWei:inspection.gasPriceWei,maxTotalCostWei:inspection.maxTotalCostWei,validUntil:inspection.validUntil,addendumFile:request.addendumFile,addendumSha256:request.addendumSha256,manualProofFile:request.manualProofFile??null,manualProofSha256:request.manualProofSha256??null,manualProofSummary:proofSummary,preparedAt:new Date(now()).toISOString(),expiresAt:new Date(now()+INTENT_AGE_MS).toISOString(),resubmissionAllowed:false};
  // The immutable intent exists before any fresh revalidation or signature.
  intentRecord=await persist('intent',intent);
  try{
   await fresh(true);
   if(proofSummary)guard(await deps.blockHash(proofSummary.blockNumber)===proofSummary.blockHash,'PROOF_BLOCKHASH_DRIFT');
   phase='PREPARED';await persist('prepared',{intentSha256:intentRecord.sha256,preparedAt:new Date(now()).toISOString(),requestHash:intent.deploymentRequestHash});
   return {state:summary(),intentFile:intentRecord.path,intentSha256:intentRecord.sha256,maxTotalCostWei:intent.maxTotalCostWei,expiresAt:intent.expiresAt};
  }catch(error){phase='PREPARE_BLOCKED';await persist('prepare-blocked',{intentSha256:intentRecord.sha256,error:safeFailure(error),noSignature:true,noBroadcast:true});throw error;}
 }
 async function submit(request){
  guard(writeCapability&&request.ack===ACK,'EXPLICIT_SIGNING_ACK_REQUIRED');
  guard(phase==='PREPARED'&&intent&&request.intentSha256===intentRecord.sha256&&!sendAttempted,'INTENT_NOT_SIGNABLE_OR_ALREADY_CONSUMED');
  phase='SIGNING'; // Terminal until read-only recovery, even if later checks fail.
  let serialized;
  try{
   guard(now()<=Date.parse(intent.expiresAt),'INTENT_EXPIRED');
   const reviewedAddendum=await deps.readReviewed(intent.addendumFile,intent.addendumSha256);
   validateAddendum(reviewedAddendum,inspection,{proofFile:intent.manualProofFile,proofSha256:intent.manualProofSha256,originalOwner});
   if(inspection.gasMode==='manual'){
    const currentProof=await deps.readReviewed(intent.manualProofFile,intent.manualProofSha256);
    const checked=validateManualProof(currentProof,inspection,now());
    guard(await deps.blockHash(checked.blockNumber)===checked.blockHash,'PROOF_BLOCKHASH_DRIFT');
   }
   await fresh(true);
   await persist('signing-authorized',{intentSha256:intentRecord.sha256,requestHash:intent.deploymentRequestHash,nonce:intent.deploymentRequest.nonce,approvedAt:new Date(now()).toISOString()});
   const r=intent.deploymentRequest;
   serialized=await deps.sign({type:'legacy',chainId:4221,nonce:Number(r.nonce),to:r.to,data:r.data,value:BigInt(r.value),gas:BigInt(r.gas),gasPrice:BigInt(r.gasPrice)});
   guard(typeof serialized==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(serialized),'SIGNER_RETURNED_INVALID_ENVELOPE');
   guard(await deps.verifySigned(serialized,r)===true,'SIGNED_ENVELOPE_UNVERIFIED');
   expectedEvmHash=keccak256(serialized);phase='SIGNED';
   // fsync this public hash/nonce BEFORE sending. Raw remains only local memory.
   await persist('signed-envelope-hash',{intentSha256:intentRecord.sha256,requestHash:intent.deploymentRequestHash,expectedEvmHash,nonce:r.nonce,signedAt:new Date(now()).toISOString(),rawSignedEnvelopePersisted:false});
   sendAttempted=true;phase='SEND_UNKNOWN';
   const returned=await deps.broadcast(serialized);
   guard(HASH.test(returned)&&lower(returned)===lower(expectedEvmHash),'BROADCAST_HASH_MISMATCH');
   phase='SENT';await persist('broadcast-observed',{intentSha256:intentRecord.sha256,expectedEvmHash,broadcastHash:returned,nonce:r.nonce,observedAt:new Date(now()).toISOString(),protocolConsensusVerified:false});
   return {state:summary(),expectedEvmHash,broadcastObserved:true,protocolConsensusVerified:false};
  }catch(error){
   phase=sendAttempted?'SEND_UNKNOWN':'SIGN_OR_PRE_SEND_BLOCKED';
   await persist('send-blocked',{intentSha256:intentRecord.sha256,expectedEvmHash,sendAttempted,error:safeFailure(error),resubmissionAllowed:false});throw error;
  }finally{serialized=undefined;}
 }
 async function recover(){
  const c=await fresh(false,false);
  if(!expectedEvmHash)return {state:summary(),latestNonce:String(c.latestNonce),pendingNonce:String(c.pendingNonce),knownEnvelope:false,resubmissionAllowed:false};
  const observation=await deps.recover(expectedEvmHash,inspection.deploymentRequest,c);
  await persist('recovery',{intentSha256:intentRecord.sha256,expectedEvmHash,observation,observedAt:new Date(now()).toISOString(),resubmissionAllowed:false});
  return {state:summary(),observation,resubmissionAllowed:false};
 }
 return {inspect,prepare,submit,recover,state:summary,balance:async()=>{const c=await fresh(false,false);return {address:lower(address),balanceWei:String(c.balance),latestNonce:String(c.latestNonce),pendingNonce:String(c.pendingNonce)};}};
}

export async function readReviewedPublicFile(path,expectedHash,{root=PROJECT_ROOT}={}){
 guard(typeof path==='string'&&!isAbsolute(path)&&!path.includes('\\')&&!path.split('/').some(x=>!x||x==='.'||x==='..'),'PUBLIC_DOCUMENT_PATH');
 guard((path.startsWith('artifacts/bradbury/')||path.startsWith('docs/evidence/'))&&path.endsWith('.json')&&!/(?:private|credential|secret|(^|\/)session-)/i.test(path),'PUBLIC_DOCUMENT_NAMESPACE');
 guard(SHA.test(expectedHash),'PUBLIC_DOCUMENT_HASH_REQUIRED');
 const resolvedRoot=await realpath(root),file=await realpath(resolve(root,path)),rel=relative(resolvedRoot,file);
 guard(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'PUBLIC_DOCUMENT_ESCAPE');
 const details=await stat(file);guard(details.isFile()&&details.size<=MAX_PUBLIC_DOCUMENT_BYTES,'PUBLIC_DOCUMENT_SIZE');
 const bytes=await readFile(file);guard(sha256(bytes)===expectedHash,'PUBLIC_DOCUMENT_HASH_MISMATCH');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

async function commitments(){
 const planBytes=await readFile(resolve(PROJECT_ROOT,PLAN_FILE));guard(sha256(planBytes)===PLAN_SHA,'PLAN_COMMITMENT_MISMATCH');
 const plan=JSON.parse(planBytes);guard(plan.deploymentSourceCommitment.file===SOURCE_FILE&&plan.deploymentSourceCommitment.sha256===SOURCE_SHA,'PLAN_DEPLOYMENT_COMMITMENT');
 for(const item of [plan.sourceCommitment,plan.deploymentSourceCommitment,plan.catalogCommitment,plan.buildCommitment,plan.feeProfileCommitment])guard(sha256(await readFile(resolve(PROJECT_ROOT,item.file)))===item.sha256,'DEPENDENCY_COMMITMENT_MISMATCH');
 const source=new TextDecoder('utf-8',{fatal:true}).decode(await readFile(resolve(PROJECT_ROOT,SOURCE_FILE)));
 return {plan,source};
}

async function liveContext(address,l2Endpoint){
 await commitments();
 const connection=await connectBradbury();
 const reader=createPublicClient({transport:http(validateEndpoint(l2Endpoint),{retryCount:0,timeout:25000})});
 const [chainId,genesis,head]=await Promise.all([reader.getChainId(),reader.getBlock({blockNumber:0n}),reader.getBlock()]);
 guard(chainId===4221&&lower(genesis.hash)===BRADBURY.genesisHash,'L2_NETWORK_IDENTITY');
 guard((await connection.publicClient.getBlock({blockNumber:head.number})).hash===head.hash,'L2_COMMON_BLOCK_MISMATCH');
 const registryAbi=parseAbi(['function getAddress(string) view returns (address)']);
 for(const name of REQUIRED_NAMES){
  const resolved=await reader.readContract({address:BRADBURY.addressManager,abi:registryAbi,functionName:'getAddress',args:[name],blockNumber:head.number});
  guard(lower(resolved)===lower(connection.metadata.addresses[name]),'L2_REGISTRY_MISMATCH');
  const [code,primaryCode]=await Promise.all([reader.getCode({address:resolved,blockNumber:head.number}),connection.publicClient.getCode({address:resolved,blockNumber:head.number})]);
  guard(code&&code!=='0x'&&code===primaryCode,'L2_REGISTRY_CODE_MISMATCH');
 }
 const registry=await reader.readContract({address:connection.metadata.addresses.ConsensusData,abi:parseAbi(['function addressManager() view returns (address)']),functionName:'addressManager',blockNumber:head.number});
 guard(lower(registry)===lower(BRADBURY.addressManager),'L2_DATA_REGISTRY_MISMATCH');
 const [{quote,scope},latest,pending,balance,gasPrice]=await Promise.all([quoteDevelopmentProfile(connection.client),reader.getTransactionCount({address,blockTag:'latest'}),reader.getTransactionCount({address,blockTag:'pending'}),reader.getBalance({address}),reader.getGasPrice()]);
 return {metadata:connection.metadata,chain:connection.chain,reader,connection,l2Endpoint,address:lower(address),headNumber:head.number,headHash:head.hash,headTimestamp:head.timestamp,registryCodeMatches:true,latestNonce:latest,pendingNonce:pending,balance,gasPrice,quote,feeScope:scope,feeProfileSha256:sha256(await readFile(resolve(PROJECT_ROOT,'src/fee-profile.json')))};
}

export async function recoverEnvelope(hash,request,context){
 const reader=context.reader;
 let receipt;
 try{receipt=await reader.getTransactionReceipt({hash});}catch{return {receiptObserved:false,expectedEvmHash:hash,protocolConsensusVerified:false};}
 const tx=await reader.getTransaction({hash});
 guard(lower(receipt.transactionHash)===lower(hash)&&lower(tx.hash)===lower(hash)&&lower(tx.from)===request.from&&lower(tx.to)===request.to&&String(tx.nonce)===request.nonce&&tx.input.toLowerCase()===request.data&&String(tx.value)===request.value&&String(tx.gas)===request.gas&&String(tx.gasPrice)===request.gasPrice,'RECOVERY_ENVELOPE_MISMATCH');
 guard((await reader.getBlock({blockNumber:receipt.blockNumber})).hash===receipt.blockHash,'RECOVERY_BLOCKHASH_MISMATCH');
 const ids=new Set(),recipients=[];
 for(const log of receipt.logs){
  const event=lower(log.address)===lower(context.metadata.addresses.ConsensusMain)?parseAbiItem('event NewTransaction(bytes32 indexed txId,address indexed recipient,address indexed activator)'):lower(log.address)===lower(context.metadata.addresses.TransactionManager)?parseAbiItem('event CreatedTransaction(bytes32 indexed txId,uint256 txSlot)'):null;
  if(!event||log.removed)continue;
  try{const decoded=decodeEventLog({abi:[event],topics:log.topics,data:log.data,strict:true});if(HASH.test(decoded.args.txId)){ids.add(lower(decoded.args.txId));if(decoded.eventName==='NewTransaction')recipients.push(decoded.args.recipient);}}catch{/* Unrelated log at the same contract address. */}
 }
 guard(ids.size<=1,'AMBIGUOUS_PROTOCOL_EVENT_IDS');
 const eventVerified=receipt.status==='success'&&ids.size===1&&recipients.length===1;
 return {receiptObserved:true,evmReceiptStatus:receipt.status,expectedEvmHash:hash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,protocolTxId:eventVerified?[...ids][0]:null,candidateContractAddress:eventVerified?recipients[0]:null,newTransactionEventVerified:eventVerified,envelopeIdentityVerified:true,protocolConsensusVerified:false};
}

async function runLive(options){
 const {plan,source}=await commitments();
 const account=createAccount(); // Only created under explicit --start; never exported.
 const address=lower(account.address),directory=resolve(PROJECT_ROOT,'artifacts/bradbury/gas-aware',address);
 await mkdir(directory,{recursive:true});let sequence=0;
 const persist=async(stage,value)=>{
  const filename=String(++sequence).padStart(3,'0')+'-'+stage+'.json',file=resolve(directory,filename);
  const bytes=Buffer.from(publicJson(value)+'\n','utf8');
  const handle=await open(file,'wx');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  return {path:relative(PROJECT_ROOT,file).split('\\').join('/'),sha256:sha256(bytes)};
 };
 const l2Endpoint=validateEndpoint(options.l2Endpoint??BRADBURY.rpcUrl);
 let latestContext;
 const machine=createGasAwareSession({address,source,originalOwner:plan.actorCommitment.actors.owner,writeCapability:process.env.RR_GAS_AWARE_DEPLOY_ACK==='1',deps:{
  persist,readReviewed:readReviewedPublicFile,
  fresh:async()=>latestContext=await liveContext(address,l2Endpoint),
  estimate:async call=>latestContext.reader.request({method:'eth_estimateGas',params:[call]}),
  blockHash:async number=>{
   const block=await latestContext.reader.getBlock({blockNumber:BigInt(number)}),primary=await latestContext.connection.publicClient.getBlock({blockNumber:BigInt(number)});
   guard(block.hash===primary.hash,'PROOF_PRIMARY_BLOCKHASH_MISMATCH');return block.hash;
  },
  sign:request=>account.signTransaction(request),
  verifySigned:validateSignedEnvelope,
  broadcast:serialized=>latestContext.reader.sendRawTransaction({serializedTransaction:serialized}),
  recover:recoverEnvelope,
 }});
 await persist('session',{format:'research-receipt/v6-gas-aware-session/1',address,planSha256:PLAN_SHA,sourceSha256:SOURCE_SHA,l2Endpoint,readOnlyUntilExplicitSubmit:true,writeCapability:process.env.RR_GAS_AWARE_DEPLOY_ACK==='1',privateKeysPersisted:false,rawSignedEnvelopePersisted:false});
 const output=value=>console.log(publicJson(value));
 // Even an unavailable network leaves this process/key alive for read-only
 // inspection; it never silently regenerates an account after funding.
 let balance;
 try{balance=await machine.balance();}catch(error){balance={unavailable:true,error:safeFailure(error)};}
 output({ready:true,...machine.state(),l2Endpoint,balance,requiredNextStep:'Independent review, explicit authorized funding, one inspection and reviewed proof/addendum. No writes have occurred.'});
 const keepAlive=setInterval(()=>{},60000);
 const lines=createInterface({input:process.stdin,terminal:false});let quitting=false;
 for await(const line of lines){
  if(!line.trim())continue;
  let request;
  try{
   guard(Buffer.byteLength(line,'utf8')<=8192,'COMMAND_TOO_LARGE');request=JSON.parse(line);
   const allowed={state:['op'],balance:['op'],inspect:['op','gasMode','maxGasPriceWei','totalCostCapWei'],prepare:['op','inspectionSha256','manualProofFile','manualProofSha256','addendumFile','addendumSha256'],submit:['op','ack','intentSha256'],recover:['op'],quit:['op']};
   guard(Object.hasOwn(allowed,request.op),'UNSUPPORTED_OPERATION');guard(Object.keys(request).every(key=>allowed[request.op].includes(key)),'UNSUPPORTED_COMMAND_FIELDS');
   if(request.op==='quit'){quitting=true;output({ok:true,closed:true,...machine.state()});break;}
   const result=request.op==='state'?machine.state():await machine[request.op](request);
   output({ok:true,op:request.op,result});
  }catch(error){output({ok:false,op:['state','balance','inspect','prepare','submit','recover','quit'].includes(request?.op)?request.op:null,error:safeFailure(error),state:machine.state()});}
 }
 if(quitting)clearInterval(keepAlive);
 else{
  await persist('input-closed',{address,phase:machine.state().phase,signingDisabled:true,privateKeyRetainedInProcessOnly:true});
  output({inputClosed:true,processKeptAlive:true,signingDisabled:true,address,warning:'Do not kill this process while a deployment outcome or funded account remains unresolved. No automatic action will run.'});
  await new Promise(()=>{});
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.argv.includes('--start'))console.log(publicJson({started:false,networkRequests:0,signatures:0,accountCreated:false,sourceSha256:SOURCE_SHA,planSha256:PLAN_SHA,usage:'--start [--l2-endpoint reviewedOfficialURL]; initial mode read-only; RR_GAS_AWARE_DEPLOY_ACK=1 only permits a later explicit submit.',manualGasLimit:MANUAL_GAS.toString(),maximumTotalCostWei:MAX_TOTAL_COST.toString()}));
 else{
  const index=process.argv.indexOf('--l2-endpoint');
  runLive({l2Endpoint:index<0?undefined:process.argv[index+1]}).catch(error=>{console.log(publicJson({ready:false,error:safeFailure(error)}));process.exitCode=1;});
 }
}
