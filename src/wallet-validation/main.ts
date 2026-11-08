import {createClient} from 'genlayer-js';
import {encodeFunctionData,decodeFunctionResult,parseAbi,formatEther} from 'viem';
import {verifiedBradburyChain,quoteBradburyFees} from '../lib/bradbury';
import {getLanguage,setLanguage,type Language} from '../lib/i18n';
import {BRADBURY,REQUIRED_NAMES,assertLocalDevelopment,validateReview,validateDeploymentCalldata,validateCaseReview,validateCaseCalldata,compareRegistry,freshProofTime,canonical,readPending,requestWalletDeployment,requestWalletCase,requireValue,sha256,storageKeyForReview,storageKeyForCase,type Review,type CaseReview} from './guards';
import './style.css';

const ARB_GAS_INFO='0x000000000000000000000000000000000000006C' as const;
const AUTO_POPUP_KEY='research-receipt/wallet-v6-auto-popup/1';
type Provider={request:(request:{method:string;params?:unknown[]})=>Promise<unknown>;on?:(event:string,listener:(...args:unknown[])=>void)=>void};
const root=document.querySelector<HTMLElement>('#wallet-validation')!;

let lang:Language=getLanguage();
setLanguage(lang);

// 双语字典定义（默认英文，支持一键切换中文）
const W_TEXT={
 en:{
  title:'ResearchReceipt · Local Wallet Deployment & Case Verification',
  notice:'For Bradbury Testnet only (v6-wallet-4 / compact_v3). Controlled by your wallet; never asks for private keys or seed phrases. Never auto-clicks final wallet confirmation or sends concurrent batches.',
  btnConnect:'Connect Test Wallet',
  btnSwitchChain:'Switch Wallet to Bradbury (4221)',
  btnLang:'EN / ZH',
  sec1Summary:'1. Single-Transaction Contract Deployment (Case #1 · compact_v3)',
  btnLoadDeploy:'Load Local Deployment Review Bundle',
  chkConfirmDeploy:'I have verified the test account, source SHA-256, plan, and fee cap, and will confirm this deployment in my wallet.',
  btnSendDeploy:'Verify & Request Wallet Deployment Once',
  h3DeployPending:'Deployment Recovery Record',
  btnExportDeploy:'Download Public Recovery Record',
  sec2Heading:'2. Sequential Business Case Execution (Hard Gate Cases #2..#13, then #14..#51)',
  gateSyncing:'Synchronizing current stage progress...',
  btnLoadCase:'Refresh Current Pending Case',
  chkAutoPopupBold:'Auto-open single-transaction wallet popup (user-authorized to skip web clicks)',
  chkAutoPopupRest:': once the previous transaction is finalized and verified on-chain and the next read-only proof is ready, automatically run preflight checks and open the MetaMask confirmation popup ( paused immediately on rejection or error).',
  chkConfirmCase:'I have verified the current case sequence, method arguments, and fee cap, and will confirm this transaction in my wallet.',
  btnSendCase:'Verify & Request Wallet Send for Current Case',
  h3CasePending:'Current Case Recovery Record',
  noPendingDeploy:'No pending deployment',
  noPendingCase:'No pending case transaction',
  notLoadedCase:'No pending case loaded yet',
  chainMatched:' · Matched Bradbury',
  chainNeedSwitch:' · Switch to 0x107d (4221)',
  notRead:'Not read yet',
  notConnected:'Not connected',
  rowWallet:'Connected Wallet',
  rowChainId:'Wallet Chain ID',
  rowLockedActor:'Locked Wallet',
  rowNetwork:'Network',
  rowSourceSha:'Source SHA-256',
  rowPlanSha:'Validation Plan SHA-256',
  rowDeployReqSha:'Deployment Request SHA-256',
  rowBundleSha:'Review Bundle SHA-256',
  rowEstGas:'Same-Block Estimated Gas',
  rowSelectedGas:'Selected Gas Limit',
  rowMaxL2Gas:'L2 Per-Tx Hard Cap Gas',
  rowGasPrice:'Fixed gasPrice (wei)',
  rowProtocolDeposit:'Protocol Deposit GEN',
  rowMaxTotalGen:'Max Total GEN',
  rowValidUntil:'Valid Until',
  rowReadOnlyProof:'Read-Only Execution Proof',
  rowReadOnlyProofVal:'eth_estimateGas + eth_call same-block dual verification passed; does not represent committee consensus',
  rowCaseSeq:'Case Sequence / Name',
  rowTargetContract:'Target Contract',
  rowMethod:'Method Call',
  rowExpected:'Expected',
  rowEstSelectedGas:'Estimated / Selected Gas',
  rowCallReqSha:'Exact Request SHA-256',
  msgLoadedDeploy:'Local deployment review bundle loaded. Connect the locked wallet and verify each field; no signature requested yet.',
  msgLoadedCase:(seq:number,name:string)=>`Loaded Case #${seq} (${name}); no signature requested yet.`,
  msgPreflightDeployOk:'Preflight on-chain and wallet checks passed; opening wallet popup—please confirm the deployment in your wallet...',
  msgPreflightCaseOk:(seq:number)=>`Case #${seq} preflight checks passed; opening wallet popup—please confirm in your wallet...`,
  msgPreflightDeployRunning:'Running preflight on-chain and wallet verification (approx. 5–10s), please wait...',
  msgDeployHashReturned:'Wallet returned EVM hash. On-chain deployment and committee consensus are not confirmed yet; linking to finalized state verification...',
  msgAutoPausedSuffix:' (Auto-popup paused; re-check after verifying)',
  msgCaseRunning:(seq:number)=>`Running preflight checks for Case #${seq}, please wait...`,
  msgCaseHashReturned:(seq:number,name:string)=>`Case #${seq} (${name}) returned EVM hash; awaiting on-chain and committee finalized verification.`,
  msgWalletConnected:(cid:string)=>`Wallet connected (chain ${cid}); public address read only, no signature requested.`,
  msgChainSwitched:(cid:string)=>`Switched wallet chain for this site to ${cid}.`,
  msgReady:'Local wallet verification page ready (v6-wallet-4 / compact_v3); connect the locked wallet and confirm transactions stage by stage.',
  gateAwaitingDeploy:'⏳ Pending Case #1 (compact_v3 zero-arg contract deployment): the page will verify and open the MetaMask confirmation popup.',
  gateAwaitingCase:(done:number,total:number,addr:string,seq:number,name:string)=>`Progress: ${done}/${total} completed · Contract ${addr} · Awaiting confirmation: Case #${seq} (${name})`,
  gateVerifying:(seq:number,name:string)=>`⏳ Case #${seq} (${name}) broadcast; waiting for committee FINALIZED state and readback verification (approx. 15–45s, do not resend)...`,
  gatePreparing:(seq:number,name:string)=>`⏳ Sampling pre-state and generating review bundle for Case #${seq} (${name})...`,
  gateCompleted:(done:number,total:number)=>`✅ Stage target completed (${done}/${total} cases)! Return to chat to view the verification report.`,
  gatePaused:(done:number,total:number)=>`⏸ Safely paused (${done}/${total} cases completed) · Next wallet popup not triggered; resume from Case #${done+1} when ready.`,
  gateStopped:(err:string)=>`⛔ Coordinator stopped: ${err}`,
 },
 zh:{
  title:'ResearchReceipt · 本地钱包部署与逐笔核验',
  notice:'仅用于 Bradbury 测试链（v6-wallet-4 / compact_v3）。钱包由你控制；不输入私钥或助记词。不会代点钱包最终确认，也不会批量并发发送。',
  btnConnect:'连接测试钱包',
  btnSwitchChain:'切换钱包至 Bradbury (4221)',
  btnLang:'中文 / EN',
  sec1Summary:'一、单笔合约部署（用例 #1 · compact_v3）',
  btnLoadDeploy:'读取本地部署审核资料',
  chkConfirmDeploy:'我已核对测试账户、源码哈希、计划和费用上限，并将亲自在钱包中确认这一笔部署。',
  btnSendDeploy:'核验后请求钱包部署一次',
  h3DeployPending:'部署恢复记录',
  btnExportDeploy:'下载公开恢复记录',
  sec2Heading:'二、业务用例逐笔执行（前 13 项硬 Gate：用例 #2..#13，后 #14..#51）',
  gateSyncing:'正在同步当前阶段进度…',
  btnLoadCase:'手动刷新当前待签用例',
  chkAutoPopupBold:'自动唤起单笔钱包弹窗（用户已授权省去网页点击）',
  chkAutoPopupRest:'：上一笔链上终态核验通过且下一笔只读证明就绪后，自动完成本页发送前核验并唤起 MetaMask 单笔确认窗（若拒绝或异常立即暂停自动唤起）。',
  chkConfirmCase:'我已核对当前用例序号、方法参数与费用上限，并将亲自在钱包中确认该笔交易。',
  btnSendCase:'核验后请求钱包发送当前用例',
  h3CasePending:'当前用例恢复记录',
  noPendingDeploy:'无未决部署',
  noPendingCase:'无未决用例交易',
  notLoadedCase:'尚未载入待签用例',
  chainMatched:' · 已匹配 Bradbury',
  chainNeedSwitch:' · 需切换至 0x107d (4221)',
  notRead:'尚未读取',
  notConnected:'尚未连接',
  rowWallet:'已连接钱包',
  rowChainId:'当前钱包链 ID',
  rowLockedActor:'锁定钱包',
  rowNetwork:'链',
  rowSourceSha:'实际源码 SHA-256',
  rowPlanSha:'新测试计划 SHA-256',
  rowDeployReqSha:'精确部署请求 SHA-256',
  rowBundleSha:'审核资料 SHA-256',
  rowEstGas:'同区块估算 Gas',
  rowSelectedGas:'选定 Gas 上限',
  rowMaxL2Gas:'L2 单笔硬上限 Gas',
  rowGasPrice:'固定 gasPrice (wei)',
  rowProtocolDeposit:'协议预存 GEN',
  rowMaxTotalGen:'最大合计 GEN',
  rowValidUntil:'请求有效至',
  rowReadOnlyProof:'只读执行证明',
  rowReadOnlyProofVal:'eth_estimateGas + eth_call 同区块双重验证通过；不表示委员会共识',
  rowCaseSeq:'用例序号 / 名称',
  rowTargetContract:'目标合约',
  rowMethod:'调用方法',
  rowExpected:'预期',
  rowEstSelectedGas:'估算 / 选定 Gas',
  rowCallReqSha:'精确请求 SHA-256',
  msgLoadedDeploy:'本地审核资料已读取。连接锁定钱包后逐项核对；尚未请求签名。',
  msgLoadedCase:(seq:number,name:string)=>`已读取用例 #${seq}（${name}），尚未请求签名。`,
  msgPreflightDeployOk:'发送前链上与钱包多重核验通过，正在唤起钱包弹窗，请在钱包中亲自确认部署交易…',
  msgPreflightCaseOk:(seq:number)=>`用例 #${seq} 发送前核验通过，正在唤起钱包弹窗，请在钱包中亲自确认…`,
  msgPreflightDeployRunning:'正在执行发送前链上与钱包多重核验（约 5–10 秒），请稍候…',
  msgDeployHashReturned:'钱包已返回 EVM 哈希。尚未确认链上部署或委员会结果，正在自动衔接链上终态核验…',
  msgAutoPausedSuffix:'（已暂停自动唤起，核实后可重新勾选）',
  msgCaseRunning:(seq:number)=>`正在执行用例 #${seq} 发送前核验，请稍候…`,
  msgCaseHashReturned:(seq:number,name:string)=>`用例 #${seq}（${name}）已返回 EVM 哈希，等待链上与委员会终态核验。`,
  msgWalletConnected:(cid:string)=>`钱包已连接（链 ${cid}）；仅取得公开地址，尚未签名。`,
  msgChainSwitched:(cid:string)=>`已切换钱包当前站点链至 ${cid}。`,
  msgReady:'本地钱包核验页已就绪（v6-wallet-4 / compact_v3）；请连接锁定钱包并按阶段确认单笔交易。',
  gateAwaitingDeploy:'⏳ 待执行用例 #1（compact_v3 零参数合约部署）：网页将自动核验并唤起 MetaMask 单笔确认弹窗，请在钱包内点击「确认」。',
  gateAwaitingCase:(done:number,total:number,addr:string,seq:number,name:string)=>`进度：已完成 ${done}/${total} · 合约 ${addr} · 当前待确认：用例 #${seq} (${name})`,
  gateVerifying:(seq:number,name:string)=>`⏳ 用例 #${seq} (${name}) 已上链，正在等待委员会 FINALIZED 终态与回读核验（约 15–45 秒，请勿重复操作）…`,
  gatePreparing:(seq:number,name:string)=>`⏳ 正在采样用例 #${seq} (${name}) 的前置状态并生成审核资料…`,
  gateCompleted:(done:number,total:number)=>`✅ 阶段目标已完成（已完成 ${done}/${total} 项）！请返回对话查看阶段核验报告。`,
  gatePaused:(done:number,total:number)=>`⏸ 已安全暂停（已完成 ${done}/${total} 项）· 未唤起下一笔钱包请求；回来后在对话中告知即可继续第 #${done+1} 项。`,
  gateStopped:(err:string)=>`⛔ 核验器已停止：${err}`,
 }
} as const;

root.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h1 id="w-title"></h1><button id="toggle-lang" type="button"></button></div><p id="w-notice" class="notice"></p><div id="status" role="status"></div><p><button id="connect"></button> <button id="switch-chain"></button></p><details id="deploy-panel" open><summary><b id="sec1-summary"></b></summary><section><p><button id="load"></button></p><dl id="review"></dl><label><input id="confirm" type="checkbox"><span id="chk-confirm-deploy"></span></label><p><button id="send" disabled></button></p><div id="send-status" class="notice" role="status"></div><h3 id="h3-deploy-pending"></h3><pre id="pending"></pre><button id="export"></button></section></details><section><h2 id="sec2-heading"></h2><div id="gate-banner" class="notice" role="status"></div><p><button id="load-case"></button></p><p><label><input id="auto-popup" type="checkbox"><b id="chk-auto-bold"></b><span id="chk-auto-rest"></span></label></p><dl id="case-review"></dl><label><input id="confirm-case" type="checkbox"><span id="chk-confirm-case"></span></label><p><button id="send-case" disabled></button></p><div id="case-status" class="notice" role="status"></div><h3 id="h3-case-pending"></h3><pre id="case-pending"></pre></section>`;
const deployPanel=root.querySelector<HTMLDetailsElement>('#deploy-panel')!;
const gateBanner=root.querySelector<HTMLElement>('#gate-banner')!;
const status=root.querySelector<HTMLElement>('#status')!,sendStatus=root.querySelector<HTMLElement>('#send-status')!,view=root.querySelector<HTMLElement>('#review')!,pendingView=root.querySelector<HTMLElement>('#pending')!;
const send=root.querySelector<HTMLButtonElement>('#send')!,confirm=root.querySelector<HTMLInputElement>('#confirm')!;
const caseView=root.querySelector<HTMLElement>('#case-review')!,casePendingView=root.querySelector<HTMLElement>('#case-pending')!,caseStatus=root.querySelector<HTMLElement>('#case-status')!;
const sendCaseBtn=root.querySelector<HTMLButtonElement>('#send-case')!,confirmCase=root.querySelector<HTMLInputElement>('#confirm-case')!,autoPopup=root.querySelector<HTMLInputElement>('#auto-popup')!;
autoPopup.checked=localStorage.getItem(AUTO_POPUP_KEY)!=='0';
autoPopup.addEventListener('change',()=>{localStorage.setItem(AUTO_POPUP_KEY,autoPopup.checked?'1':'0');});
let review:Review|null=null,bundleHash:string|null=null,caseReview:CaseReview|null=null,caseBundleHash:string|null=null,account:string|null=null,walletChainId:string|null=null,busy=false,lastAutoTriggeredHash:string|null=null;
const provider=()=>(window as unknown as {ethereum?:Provider}).ethereum;
const text=(value:unknown)=>typeof value==='string'?value:canonical(value);
const errorMessage=(error:unknown)=>error instanceof Error?error.message:(error&&typeof error==='object'&&'message' in error&&typeof (error as {message?:unknown}).message==='string'?(error as {message:string}).message:text(error));
function currentStorageKey(){return storageKeyForReview(review);}
function show(message:string){status.textContent=message;sendStatus.textContent=message;render();}
function showCase(message:string){status.textContent=message;caseStatus.textContent=message;render();}

function applyStaticLabels(){
 const wt=W_TEXT[lang];
 document.title=wt.title;
 root.querySelector('#w-title')!.textContent=wt.title;
 root.querySelector('#w-notice')!.textContent=wt.notice;
 root.querySelector('#connect')!.textContent=wt.btnConnect;
 root.querySelector('#switch-chain')!.textContent=wt.btnSwitchChain;
 root.querySelector('#toggle-lang')!.textContent=wt.btnLang;
 root.querySelector('#sec1-summary')!.textContent=wt.sec1Summary;
 root.querySelector('#load')!.textContent=wt.btnLoadDeploy;
 root.querySelector('#chk-confirm-deploy')!.textContent=wt.chkConfirmDeploy;
 root.querySelector('#send')!.textContent=wt.btnSendDeploy;
 root.querySelector('#h3-deploy-pending')!.textContent=wt.h3DeployPending;
 root.querySelector('#export')!.textContent=wt.btnExportDeploy;
 root.querySelector('#sec2-heading')!.textContent=wt.sec2Heading;
 if(!gateBanner.textContent)gateBanner.textContent=wt.gateSyncing;
 root.querySelector('#load-case')!.textContent=wt.btnLoadCase;
 root.querySelector('#chk-auto-bold')!.textContent=wt.chkAutoPopupBold;
 root.querySelector('#chk-auto-rest')!.textContent=wt.chkAutoPopupRest;
 root.querySelector('#chk-confirm-case')!.textContent=wt.chkConfirmCase;
 root.querySelector('#send-case')!.textContent=wt.btnSendCase;
 root.querySelector('#h3-case-pending')!.textContent=wt.h3CasePending;
}

function render(){
 applyStaticLabels();
 const wt=W_TEXT[lang];
 const key=currentStorageKey();
 let pending;try{pending=readPending(localStorage,key);pendingView.textContent=JSON.stringify(pending,null,2)||wt.noPendingDeploy;}catch(error){pendingView.textContent=errorMessage(error);pending=true;}
 send.disabled=busy||!review||!account||!confirm.checked||!!pending;
 view.replaceChildren();
 const chainText=walletChainId?`${walletChainId} (${Number(walletChainId)})${walletChainId==='0x107d'?wt.chainMatched:wt.chainNeedSwitch}`:wt.notRead;
 if(review){
  const rows:Record<string,string>={[wt.rowWallet]:account||wt.notConnected,[wt.rowChainId]:chainText,[wt.rowLockedActor]:review.actor,[wt.rowNetwork]:'Bradbury Phase 2 · 4221',[wt.rowSourceSha]:review.sourceSha256,[wt.rowPlanSha]:review.planSha256,[wt.rowDeployReqSha]:review.deploymentRequestHash,[wt.rowBundleSha]:bundleHash||'','Nonce':review.deploymentRequest.nonce,[wt.rowEstGas]:review.ethEstimateGas.estimatedGas,[wt.rowSelectedGas]:review.deploymentRequest.gas,[wt.rowMaxL2Gas]:review.ethEstimateGas.maxTxGasLimit,[wt.rowGasPrice]:review.deploymentRequest.gasPrice,[wt.rowProtocolDeposit]:formatEther(BigInt(review.deploymentRequest.value)),[wt.rowMaxTotalGen]:formatEther(BigInt(review.maxTotalCostWei)),[wt.rowValidUntil]:new Date(Number(review.validUntil)*1000).toLocaleString(),[wt.rowReadOnlyProof]:wt.rowReadOnlyProofVal};
  for(const [k,val] of Object.entries(rows)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=val;view.append(dt,dd);}
 }
 let casePending=null;
 if(caseReview){
  try{casePending=readPending(localStorage,storageKeyForCase(caseReview));casePendingView.textContent=JSON.stringify(casePending,null,2)||wt.noPendingCase;}catch(error){casePendingView.textContent=errorMessage(error);casePending=true;}
 }else{casePendingView.textContent=wt.notLoadedCase;}
 sendCaseBtn.disabled=busy||!caseReview||!account||!confirmCase.checked||!!casePending;
 caseView.replaceChildren();
 if(caseReview){
  const crows:Record<string,string>={[wt.rowWallet]:account||wt.notConnected,[wt.rowChainId]:chainText,[wt.rowCaseSeq]:`#${caseReview.sequence} · ${caseReview.caseName} (${caseReview.phase})`,[wt.rowTargetContract]:caseReview.contractAddress,[wt.rowMethod]:`${caseReview.method} · ${wt.rowExpected} ${caseReview.expectedExecutionResult}${caseReview.expectedError?` (${caseReview.expectedError})`:''}`,'Nonce':caseReview.callRequest.nonce,[wt.rowEstSelectedGas]:`${caseReview.ethEstimateGas.estimatedGas} / ${caseReview.callRequest.gas}`,[wt.rowMaxTotalGen]:formatEther(BigInt(caseReview.maxTotalCostWei)),[wt.rowCallReqSha]:caseReview.callRequestHash};
  for(const [k,val] of Object.entries(crows)){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=k;dd.textContent=val;caseView.append(dt,dd);}
 }
}
async function syncWalletState(p:Provider){
 const values=await p.request({method:'eth_accounts'});
 account=Array.isArray(values)&&typeof values[0]==='string'?String(values[0]).toLowerCase():null;
 const cid=await p.request({method:'eth_chainId'});
 walletChainId=typeof cid==='string'?cid.toLowerCase():null;
 render();
}
async function switchToBradbury(p:Provider){
 await p.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x107d'}]});
 await syncWalletState(p);
}
async function load(){
 assertLocalDevelopment(location.hostname,import.meta.env.DEV);const response=await fetch('/artifacts/wallet-validation/review.json',{cache:'no-store',redirect:'error'});requireValue(response.ok,lang==='en'?'Local review bundle has not been generated yet.':'本地审核资料尚未生成。');const raw=await response.text();requireValue(new TextEncoder().encode(raw).length<1000000,lang==='en'?'Review bundle is too large.':'审核资料过大。');review=await validateReview(JSON.parse(raw));bundleHash=await sha256(raw);const p=provider();if(p){try{await syncWalletState(p);}catch{/* 忽略未连接状态 */}}show(W_TEXT[lang].msgLoadedDeploy);
}
async function loadCase(){
 assertLocalDevelopment(location.hostname,import.meta.env.DEV);const response=await fetch('/artifacts/wallet-validation/case-review.json',{cache:'no-store',redirect:'error'});requireValue(response.ok,lang==='en'?'Pending case review bundle has not been generated yet.':'待签用例审核资料尚未生成。');const raw=await response.text();requireValue(new TextEncoder().encode(raw).length<1000000,lang==='en'?'Case review bundle is too large.':'用例审核资料过大。');caseReview=await validateCaseReview(JSON.parse(raw));caseBundleHash=await sha256(raw);confirmCase.checked=false;const p=provider();if(p){try{await syncWalletState(p);}catch{/* 忽略未连接状态 */}}showCase(W_TEXT[lang].msgLoadedCase(caseReview.sequence,caseReview.caseName));
}
async function connectedAccounts(p:Provider){const values=await p.request({method:'eth_accounts'});requireValue(Array.isArray(values)&&typeof values[0]==='string',lang==='en'?'Wallet did not provide an account.':'钱包未提供账户。');return values.map(value=>String(value).toLowerCase());}
async function fresh(r:Review,p:Provider){
 assertLocalDevelopment(location.hostname,import.meta.env.DEV);await validateReview(r);requireValue((await connectedAccounts(p))[0]===r.actor,lang==='en'?'Wallet account changed.':'钱包账户已改变。');
 const chainId=String(await p.request({method:'eth_chainId'})).toLowerCase();walletChainId=chainId;requireValue(chainId==='0x107d',lang==='en'?`Please switch your wallet to Bradbury (4221); current chain is ${chainId}.`:`请在钱包切换至 Bradbury（4221），当前站点连接链为 ${chainId}。`);
 const genesis=await p.request({method:'eth_getBlockByNumber',params:['0x0',false]}) as {hash?:string};requireValue(genesis?.hash?.toLowerCase()===BRADBURY.genesisHash,lang==='en'?'Wallet RPC genesis mismatch.':'钱包 RPC genesis 不匹配。');
 const checked=await verifiedBradburyChain();compareRegistry(checked.addresses,r.registryAddresses);await validateDeploymentCalldata(r,checked.chain.consensusMainContract.abi);
 const registryAbi=parseAbi(['function getAddress(string) view returns (address)']);
 for(const name of REQUIRED_NAMES){const data=encodeFunctionData({abi:registryAbi,functionName:'getAddress',args:[name]});const result=await p.request({method:'eth_call',params:[{to:BRADBURY.addressManager,data},'latest']});requireValue(typeof result==='string',lang==='en'?'Wallet registry read failed.':'钱包 registry 读取失败。');const address=decodeFunctionResult({abi:registryAbi,functionName:'getAddress',data:result as `0x${string}`});requireValue(address.toLowerCase()===checked.addresses[name].toLowerCase(),lang==='en'?'Wallet RPC registry does not match official node.':'钱包 RPC registry 与官方节点不一致。');const code=await p.request({method:'eth_getCode',params:[address,'latest']});const official=await checked.publicClient.getCode({address});requireValue(typeof code==='string'&&code!=='0x'&&code===official,lang==='en'?'Wallet RPC protocol code does not match official node.':'钱包 RPC 协议代码与官方节点不一致。');}
 const arbGasAbi=parseAbi(['function getGasAccountingParams() view returns (uint256 speedLimitPerSecond, uint256 gasPoolMax, uint256 maxTxGasLimit)']);
 const [latest,pending,balance,gasPrice,proofBlock,gasParams]=await Promise.all([checked.publicClient.getTransactionCount({address:r.actor,blockTag:'latest'}),checked.publicClient.getTransactionCount({address:r.actor,blockTag:'pending'}),checked.publicClient.getBalance({address:r.actor}),checked.publicClient.getGasPrice(),checked.publicClient.getBlock({blockNumber:BigInt(r.ethCall.blockNumber)}),checked.publicClient.readContract({address:ARB_GAS_INFO,abi:arbGasAbi,functionName:'getGasAccountingParams'})]);
 requireValue(BigInt(r.deploymentRequest.gas)<gasParams[2]&&String(gasParams[2])===r.ethEstimateGas.maxTxGasLimit,lang==='en'?'Bradbury L2 per-tx gas hard cap changed or insufficient.':'Bradbury L2 单笔 gas 硬上限已变化或不足。');
 requireValue(String(latest)===r.deploymentRequest.nonce&&latest===pending,lang==='en'?'Account nonce changed or another transaction is pending.':'账户 nonce 已变化或有其他待处理交易。');requireValue(balance>=BigInt(r.maxTotalCostWei),lang==='en'?'Insufficient test GEN balance.':'测试 GEN 不足。');requireValue(String(gasPrice)===r.deploymentRequest.gasPrice,lang==='en'?'gasPrice changed; stopping current request.':'gasPrice 已变化，停止当前请求。');requireValue(proofBlock.hash===r.ethCall.blockHash,lang==='en'?'Read-only proof block changed.':'只读证明区块已变化。');
 for(const tag of ['latest','pending'])requireValue(BigInt(String(await p.request({method:'eth_getTransactionCount',params:[r.actor,tag]})))===BigInt(r.deploymentRequest.nonce),lang==='en'?'Wallet RPC nonce does not match review bundle.':'钱包 RPC nonce 与审核资料不一致。');
 requireValue(BigInt(String(await p.request({method:'eth_getBalance',params:[r.actor,'latest']})))>=BigInt(r.maxTotalCostWei),lang==='en'?'Wallet RPC balance insufficient.':'钱包 RPC 余额不足。');
 const quote=await quoteBradburyFees(createClient({chain:checked.chain,endpoint:BRADBURY.rpcUrl}),checked.publicClient);requireValue(canonical(quote.distribution)===canonical(r.feeQuote.distribution)&&String(quote.feeValue)===r.deploymentRequest.value,lang==='en'?'Protocol fee quote changed.':'协议费用已变化。');
 requireValue((await connectedAccounts(p))[0]===r.actor&&String(await p.request({method:'eth_chainId'})).toLowerCase()==='0x107d',lang==='en'?'Wallet changed at signing boundary.':'签名边界钱包已变化。');freshProofTime(r);
 show(W_TEXT[lang].msgPreflightDeployOk);
}
async function freshCase(r:CaseReview,p:Provider){
 assertLocalDevelopment(location.hostname,import.meta.env.DEV);await validateCaseReview(r);requireValue((await connectedAccounts(p))[0]===r.actor,lang==='en'?'Wallet account changed.':'钱包账户已改变。');
 const chainId=String(await p.request({method:'eth_chainId'})).toLowerCase();walletChainId=chainId;requireValue(chainId==='0x107d',lang==='en'?`Please switch your wallet to Bradbury (4221); current is ${chainId}.`:`请在钱包切换至 Bradbury（4221），当前为 ${chainId}。`);
 const genesis=await p.request({method:'eth_getBlockByNumber',params:['0x0',false]}) as {hash?:string};requireValue(genesis?.hash?.toLowerCase()===BRADBURY.genesisHash,lang==='en'?'Wallet RPC genesis mismatch.':'钱包 RPC genesis 不匹配。');
 const checked=await verifiedBradburyChain();compareRegistry(checked.addresses,r.registryAddresses);await validateCaseCalldata(r,checked.chain.consensusMainContract.abi);
 const [latest,pending,balance]=await Promise.all([checked.publicClient.getTransactionCount({address:r.actor,blockTag:'latest'}),checked.publicClient.getTransactionCount({address:r.actor,blockTag:'pending'}),checked.publicClient.getBalance({address:r.actor})]);
 requireValue(String(latest)===r.callRequest.nonce&&latest===pending,lang==='en'?'Account nonce changed or another transaction is pending.':'账户 nonce 已变化或有待处理交易。');requireValue(balance>=BigInt(r.maxTotalCostWei),lang==='en'?'Insufficient test GEN balance.':'测试 GEN 不足。');
 for(const tag of ['latest','pending'])requireValue(BigInt(String(await p.request({method:'eth_getTransactionCount',params:[r.actor,tag]})))===BigInt(r.callRequest.nonce),lang==='en'?'Wallet RPC nonce does not match case review bundle.':'钱包 RPC nonce 与用例审核资料不一致。');
 requireValue((await connectedAccounts(p))[0]===r.actor&&String(await p.request({method:'eth_chainId'})).toLowerCase()==='0x107d',lang==='en'?'Wallet changed at signing boundary.':'签名边界钱包已变化。');freshProofTime(r as unknown as Review);
 showCase(W_TEXT[lang].msgPreflightCaseOk(r.sequence));
}
async function sendOnce(){
 requireValue(review&&bundleHash,lang==='en'?'Load the verified review bundle first.':'先读取已审核资料。');requireValue(confirm.checked&&!busy,lang==='en'?'Please check the confirmation box first.':'请先逐项确认。');const storageKey=storageKeyForReview(review);requireValue(readPending(localStorage,storageKey)===null,lang==='en'?'Pending deployment exists; resending is blocked.':'已有未决部署，禁止重发。');const r=review,p=provider();requireValue(p,lang==='en'?'No EIP-1193 wallet detected in this browser.':'当前浏览器未检测到 EIP-1193 钱包。');busy=true;show(W_TEXT[lang].msgPreflightDeployRunning);
 try{
  const response=await fetch('/artifacts/wallet-validation/review.json',{cache:'no-store',redirect:'error'});requireValue(response.ok&&await sha256(await response.text())===bundleHash,lang==='en'?'Local review bundle changed.':'本地审核资料已改变。');
  await requestWalletDeployment({review:r,storage:localStorage,storageKey,provider:p,userConfirmed:confirm.checked,preflight:()=>fresh(r,p),onHash:hash=>{pendingView.textContent=(lang==='en'?'Wallet returned EVM hash: ':'钱包已返回 EVM 哈希：')+hash;}});show(W_TEXT[lang].msgDeployHashReturned);
 }catch(error){
  autoPopup.checked=false;localStorage.setItem(AUTO_POPUP_KEY,'0');
  show((errorMessage(error)||(lang==='en'?'Operation incomplete. Recovery record remains locked if send was requested.':'操作未完成。若已请求发送，恢复记录保持锁定。'))+W_TEXT[lang].msgAutoPausedSuffix);
 }finally{busy=false;render();}
}
async function sendCaseOnce(){
 requireValue(caseReview&&caseBundleHash,lang==='en'?'Load the current pending case first.':'先读取当前待签用例。');requireValue(confirmCase.checked&&!busy,lang==='en'?'Please check the confirmation box for the current case.':'请先勾选确认当前用例。');const r=caseReview,p=provider();requireValue(p,lang==='en'?'No EIP-1193 wallet detected in this browser.':'当前浏览器未检测到 EIP-1193 钱包。');busy=true;showCase(W_TEXT[lang].msgCaseRunning(r.sequence));
 try{
  const response=await fetch('/artifacts/wallet-validation/case-review.json',{cache:'no-store',redirect:'error'});requireValue(response.ok&&await sha256(await response.text())===caseBundleHash,lang==='en'?'Pending case review bundle changed.':'待签用例审核资料已改变。');
  await requestWalletCase({review:r,storage:localStorage,provider:p,userConfirmed:confirmCase.checked,preflight:()=>freshCase(r,p),onHash:hash=>{casePendingView.textContent=lang==='en'?`Case #${r.sequence} wallet returned EVM hash: ${hash}`:`用例 #${r.sequence} 钱包已返回 EVM 哈希：${hash}`;}});showCase(W_TEXT[lang].msgCaseHashReturned(r.sequence,r.caseName));
 }catch(error){
  autoPopup.checked=false;localStorage.setItem(AUTO_POPUP_KEY,'0');
  showCase((errorMessage(error)||(lang==='en'?'Case send incomplete; lock remains if send was requested.':'用例发送未完成；若已请求发送，该用例锁定保持。'))+W_TEXT[lang].msgAutoPausedSuffix);
 }finally{busy=false;render();}
}
root.querySelector('#toggle-lang')!.addEventListener('click',()=>{lang=lang==='en'?'zh':'en';setLanguage(lang);render();void pollCoordinatorStatus();});
root.querySelector('#load')!.addEventListener('click',()=>void load().catch(error=>show(errorMessage(error))));
root.querySelector('#load-case')!.addEventListener('click',()=>void loadCase().catch(error=>showCase(errorMessage(error))));
root.querySelector('#connect')!.addEventListener('click',()=>void (async()=>{assertLocalDevelopment(location.hostname,import.meta.env.DEV);const p=provider();requireValue(p,lang==='en'?'No EIP-1193 wallet detected in Chrome; please install or unlock your test wallet.':'本机 Chrome 未检测到 EIP-1193 钱包，请安装或打开你自己的测试钱包。');await p.request({method:'eth_requestAccounts'});await syncWalletState(p);if(walletChainId!=='0x107d'){await switchToBradbury(p);}show(W_TEXT[lang].msgWalletConnected(walletChainId||''));})().catch(error=>show(errorMessage(error))));
root.querySelector('#switch-chain')!.addEventListener('click',()=>void (async()=>{assertLocalDevelopment(location.hostname,import.meta.env.DEV);const p=provider();requireValue(p,lang==='en'?'No EIP-1193 wallet detected.':'本机 Chrome 未检测到 EIP-1193 钱包。');await switchToBradbury(p);show(W_TEXT[lang].msgChainSwitched(walletChainId||''));})().catch(error=>show(errorMessage(error))));
confirm.addEventListener('change',render);send.addEventListener('click',()=>void sendOnce().catch(error=>show(errorMessage(error))));
confirmCase.addEventListener('change',render);sendCaseBtn.addEventListener('click',()=>void sendCaseOnce().catch(error=>showCase(errorMessage(error))));
root.querySelector('#export')!.addEventListener('click',()=>{const raw=localStorage.getItem(currentStorageKey());requireValue(raw,lang==='en'?'No recovery record found.':'没有恢复记录。');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([raw],{type:'application/json'}));a.download='research-receipt-wallet-deployment-intent.json';a.click();URL.revokeObjectURL(a.href);});
const initialProvider=provider();if(initialProvider?.on){initialProvider.on('chainChanged',cid=>{walletChainId=typeof cid==='string'?cid.toLowerCase():null;render();});initialProvider.on('accountsChanged',accs=>{account=Array.isArray(accs)&&typeof accs[0]==='string'?String(accs[0]).toLowerCase():null;render();});}
async function pollCoordinatorStatus(){
 if(busy)return;
 try{
  const wt=W_TEXT[lang];
  const p=provider();if(p&&!account){try{await syncWalletState(p);}catch{/* 忽略 */}}
  const sResp=await fetch('/artifacts/wallet-validation/case-status.json',{cache:'no-store'});
  if(sResp.ok){
   const s=await sResp.json() as {stage?:string;completedCases?:number;targetThrough?:number;currentSequence?:number;currentCaseName?:string;contractAddress?:string;callRequestHash?:string;deploymentRequestHash?:string;error?:string};
   if(s.stage==='awaiting-deployment'){
    deployPanel.open=true;
    gateBanner.textContent=wt.gateAwaitingDeploy;
    if(!review||(s.deploymentRequestHash&&review.deploymentRequestHash!==s.deploymentRequestHash&&readPending(localStorage,currentStorageKey())===null)){try{await load();}catch{/* 部署资料尚未生成时静默等待 */}}
    if(autoPopup.checked&&!busy&&review&&account===review.actor&&walletChainId==='0x107d'&&lastAutoTriggeredHash!==review.deploymentRequestHash&&readPending(localStorage,storageKeyForReview(review))===null){
     lastAutoTriggeredHash=review.deploymentRequestHash;
     confirm.checked=true;render();
     await sendOnce();
    }
   }else if(s.stage==='awaiting-wallet-confirmation'){
    deployPanel.open=false;
    gateBanner.textContent=wt.gateAwaitingCase(s.completedCases||0,s.targetThrough||51,s.contractAddress||'',s.currentSequence||0,s.currentCaseName||'');
    if(!caseReview||caseReview.sequence!==s.currentSequence||caseReview.callRequestHash!==s.callRequestHash){await loadCase();}
    if(autoPopup.checked&&!busy&&caseReview&&account===caseReview.actor&&walletChainId==='0x107d'&&lastAutoTriggeredHash!==caseReview.callRequestHash&&readPending(localStorage,storageKeyForCase(caseReview))===null){
     lastAutoTriggeredHash=caseReview.callRequestHash;
     confirmCase.checked=true;render();
     await sendCaseOnce();
    }
   }else if(s.stage==='verifying-consensus'){
    deployPanel.open=false;
    gateBanner.textContent=wt.gateVerifying(s.currentSequence||0,s.currentCaseName||'');
   }else if(s.stage==='preparing-case'){
    deployPanel.open=false;
    gateBanner.textContent=wt.gatePreparing(s.currentSequence||0,s.currentCaseName||'');
   }else if(s.stage==='target-completed'){
    deployPanel.open=false;
    gateBanner.textContent=wt.gateCompleted(s.completedCases||0,s.targetThrough||51);
   }else if(s.stage==='paused'){
    gateBanner.textContent=wt.gatePaused(s.completedCases||0,s.targetThrough||51);
   }else if(s.stage==='stopped-on-error'){
    gateBanner.textContent=wt.gateStopped(s.error||(lang==='en'?'Return to chat to inspect error diagnostics':'请返回对话查看错误诊断'));
   }
  }
 }catch{/* 忽略只读状态轮询瞬时错误 */}
}
try{assertLocalDevelopment(location.hostname,import.meta.env.DEV);show(W_TEXT[lang].msgReady);void pollCoordinatorStatus();setInterval(()=>void pollCoordinatorStatus(),3000);}catch(error){root.replaceChildren();root.textContent=errorMessage(error);}
