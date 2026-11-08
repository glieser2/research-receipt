import { beforeEach, describe, expect, it, vi } from 'vitest';
const liveMock = vi.hoisted(() => ({ readContract: vi.fn(), verifiedClient: vi.fn(), writeContract:vi.fn(),getTransaction:vi.fn(),quote:vi.fn() }));
const release = vi.hoisted(() => ({ verified:true, sourceVerified:true, policyVersion:'research-receipt/6', sourceSha256:'1'.repeat(64), rpcUrl:'https://rpc-bradbury.genlayer.com', contractAddress:'0x'+'a'.repeat(40), chainId:4221, genesisHash:'0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4', catalogHash:'' }));
vi.mock('../deployment.json', () => ({ default: release }));
vi.mock('./bradbury', () => ({ BRADBURY: { rpcUrl:'https://rpc-bradbury.genlayer.com',chainId:4221,genesisHash:'0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4' }, createVerifiedBradburyClient:liveMock.verifiedClient, quoteBradburyFees:liveMock.quote,recoverBradburyEnvelope:vi.fn() }));
import { abi } from 'genlayer-js';
import { testnetBradbury } from 'genlayer-js/chains';
import { encodeFunctionData, parseAbi } from 'viem';
import { buildReceipt, listDemoOrders, evaluateRevision, loadOrder, saveConfig, submitRevision, verifyEvidence } from './service';
import { demoSubmission } from './demo';
import { v6SnapshotCase, snapshotCase } from './evidence-snapshot.test-helpers';
import { FIELD_CATALOG } from './field-catalog.mjs';
import { hashEvidenceJson } from './evidence-snapshot.mjs';
import type { Order } from './domain';
class MemoryStorage { values = new Map<string,string>(); getItem(k:string){ return this.values.get(k) ?? null; } setItem(k:string,v:string){ this.values.set(k,v); } removeItem(k:string){ this.values.delete(k); } }
beforeEach(async()=>{ vi.resetAllMocks();vi.stubGlobal('localStorage',new MemoryStorage());liveMock.verifiedClient.mockResolvedValue({readContract:liveMock.readContract});release.catalogHash=await hashEvidenceJson(FIELD_CATALOG);release.sourceVerified=true; });
const demo = { mode:'demo' as const,rpcUrl:'https://studio.genlayer.com/api',contractAddress:'' };
describe('receipt provenance and revisions',()=>{
  it('never relabels a local receipt after settings change',async()=>{ const order=(await listDemoOrders())[0]; saveConfig({...demo,mode:'live',contractAddress:'0x'+'b'.repeat(40)}); const receipt=buildReceipt(order,1); expect(receipt.mode).toBe('demo'); expect(receipt.network).toBeNull(); });
  it('preserves original contract identity on a live export',async()=>{ const order=(await listDemoOrders())[0] as Order; order.origin={mode:'live',rpcUrl:'https://studio-dev.genlayer.com/api',contractAddress:'0x'+'a'.repeat(40)}; saveConfig({...demo,mode:'live',contractAddress:'0x'+'b'.repeat(40)}); expect(buildReceipt(order,1).network?.contract).toBe('0x'+'a'.repeat(40)); });
  it('rejects mutating an order loaded from a different mode',async()=>{ const order=(await listDemoOrders())[0]; await expect(evaluateRevision(order,1,{...demo,mode:'live',contractAddress:'0x'+'a'.repeat(40)})).rejects.toThrow('重新载入'); });
  it('does not allow a second evaluation of the same revision',async()=>{ const order=(await listDemoOrders())[0]; const result=await evaluateRevision(order,1,demo); await expect(evaluateRevision(result,1,demo)).rejects.toThrow('已完成'); });
  it('preserves the failed original while a corrected revision passes',async()=>{ const order=await evaluateRevision((await listDemoOrders())[0],1,demo); const input=await demoSubmission(); input.claims[1].text='提现需7天等待期。'; const revised=await submitRevision(order,input,demo); const result=await evaluateRevision(revised,2,demo); expect(result.revisions[0].assessment?.verdict).toBe('NOT_ACCEPTED'); expect(result.revisions[1].assessment?.verdict).toBe('ACCEPTED'); });
});
describe('policy6 staged evidence then assessment',()=>{
  const config={mode:'live' as const,rpcUrl:'https://rpc-bradbury.genlayer.com',contractAddress:'0x'+'a'.repeat(40)};
  async function staged(status='VERIFIED') {
    const sample=await v6SnapshotCase(status);
    const state={snapshot:false,assessment:false};
    const client={readContract:liveMock.readContract,writeContract:liveMock.writeContract,getTransaction:liveMock.getTransaction};
    let guarded!: {request:(request:{method:string;params:unknown[]})=>Promise<unknown>};
    liveMock.verifiedClient.mockImplementation(async options=>{if(options?.provider)guarded=options.provider;return client;});
    liveMock.readContract.mockImplementation(async({functionName}:{functionName:string})=>{
      if(functionName==='get_order')return JSON.stringify({...sample.order,status:state.assessment?sample.assessment.verdict:'SUBMITTED'});
      if(functionName==='get_revision')return JSON.stringify(sample.revision);
      if(functionName==='get_evidence_snapshot')return state.snapshot?JSON.stringify(sample.snapshot):'';
      if(functionName==='get_assessment')return state.assessment?JSON.stringify(sample.assessment):'';
      if(functionName==='get_policy_version')return 'research-receipt/6';
      if(functionName==='get_field_catalog')return JSON.stringify(FIELD_CATALOG);
      throw new Error('Unexpected read');
    });
    liveMock.quote.mockResolvedValue({distribution:{},feeValue:1n});
    liveMock.getTransaction.mockResolvedValue({statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',lifecycle:{outcome:'accepted'},result:1});
    const wallet={request:vi.fn(async({method}:{method:string})=>{
      if(method==='eth_requestAccounts'||method==='eth_accounts')return [sample.order.owner];
      if(method==='eth_chainId')return '0x107d';
      if(method==='eth_getBlockByNumber')return {hash:'0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4'};
      if(method==='eth_sendTransaction')return '0x'+'e'.repeat(64);
      throw new Error('Unexpected wallet method');
    })};
    vi.stubGlobal('window',{ethereum:wallet});
    const addTxAbi=parseAbi([
      'function addTransaction((address sender,address recipient,uint256 numOfInitialValidators,uint256 maxRotations,uint256 validUntil,uint256 saltNonce,uint256 userValue,(uint256 leaderTimeunitsAllocation,uint256 validatorTimeunitsAllocation,uint256 appealRounds,uint256 executionBudgetPerRound,uint256 executionConsumed,uint256 totalMessageFees,uint256[] rotations,uint256 maxPriceGenPerTimeUnit,uint256 storageFeeMaxGasPrice,uint256 receiptFeeMaxGasPrice) feesDistribution,bytes txCalldata,(uint8 messageType,bool onAcceptance,uint256 parentIndex,address recipient,bytes32 callKey,uint256 budget,bytes feeParams)[] messageAllocations) _params) payable',
    ]);
    liveMock.writeContract.mockImplementation(async({functionName,args}:{functionName:string;args:(string|number)[]})=>{
      const txCalldata=abi.transactions.serialize([abi.calldata.encode(abi.calldata.makeCalldataObject(functionName,args,undefined)),false]);
      const data=encodeFunctionData({abi:addTxAbi,functionName:'addTransaction',args:[{sender:sample.order.owner as `0x${string}`,recipient:config.contractAddress as `0x${string}`,numOfInitialValidators:5n,maxRotations:3n,validUntil:9999999999n,saltNonce:0n,userValue:0n,feesDistribution:{leaderTimeunitsAllocation:600n,validatorTimeunitsAllocation:600n,appealRounds:0n,executionBudgetPerRound:10000000000000000n,executionConsumed:0n,totalMessageFees:0n,rotations:[3n],maxPriceGenPerTimeUnit:0n,storageFeeMaxGasPrice:0n,receiptFeeMaxGasPrice:12000000n},txCalldata,messageAllocations:[]}]});
      await guarded.request({method:'eth_sendTransaction',params:[{from:sample.order.owner,to:testnetBradbury.consensusMainContract!.address,data,value:'0x1',gas:'0x98968',chainId:'0x107d'}]});
      if(functionName==='verify_evidence')state.snapshot=true;
      if(functionName==='evaluate')state.assessment=true;
      return '0x'+(functionName==='verify_evidence'?'b':'d').repeat(64);
    });
    return {sample,state,wallet};
  }
  it('requires a chain snapshot before evaluation and never signs the missing stage automatically',async()=>{
    const setup=await staged(),order=await loadOrder(1,config);
    await expect(evaluateRevision(order,1,config)).rejects.toThrow('请先锁定');
    expect(liveMock.writeContract).not.toHaveBeenCalled();
    expect(setup.wallet.request).not.toHaveBeenCalled();
  });
  it('uses two explicit actions with fresh read/write verification, preserving raw snapshot bytes on export',async()=>{
    const setup=await staged(),order=await loadOrder(1,config);
    liveMock.verifiedClient.mockClear();
    const locked=await verifyEvidence(order,1,config);
    expect(liveMock.writeContract.mock.calls.map(([request])=>request.functionName)).toEqual(['verify_evidence']);
    expect(locked.revisions[0].evidenceSnapshot).toMatchObject({snapshotHash:setup.sample.snapshot.snapshot_hash,allVerified:true});
    expect((buildReceipt(locked,1).revision.chainRecord as {snapshot:unknown}).snapshot).toEqual(setup.sample.snapshot);
    expect(liveMock.verifiedClient).toHaveBeenCalledTimes(3); // before read, write, after read
    const assessed=await evaluateRevision(locked,1,config);
    expect(liveMock.writeContract.mock.calls.map(([request])=>request.functionName)).toEqual(['verify_evidence','evaluate']);
    expect(liveMock.verifiedClient).toHaveBeenCalledTimes(6);
    expect(liveMock.verifiedClient.mock.calls.filter(([options])=>options?.provider)).toHaveLength(2);
    expect(setup.wallet.request.mock.calls.filter(([request])=>request.method==='eth_sendTransaction')).toHaveLength(2);
    expect(assessed.revisions[0].assessment?.snapshotHash).toBe(setup.sample.snapshot.snapshot_hash);
    expect(liveMock.readContract.mock.calls.every(([request])=>request.transactionHashVariant==='latest-final')).toBe(true);
  });
  it.each(['VERIFIED','HASH_MISMATCH'])('does not overwrite an existing %s snapshot',async status=>{
    const setup=await staged(status);setup.state.snapshot=true;
    const order=await loadOrder(1,config);
    await expect(verifyEvidence(order,1,config)).rejects.toThrow('成功或失败结果都不能重新抓取');
    expect(liveMock.writeContract).not.toHaveBeenCalled();
  });
  it('allows a user-explicit assessment of a failed immutable snapshot, without re-verifying sources',async()=>{
    const setup=await staged('HASH_MISMATCH'),order=await loadOrder(1,config);
    const locked=await verifyEvidence(order,1,config);
    expect(locked.revisions[0].evidenceSnapshot?.allVerified).toBe(false);
    expect(liveMock.writeContract).toHaveBeenCalledTimes(1);
    const result=await evaluateRevision(locked,1,config);
    expect(result.revisions[0].assessment?.verdict).toBe('INSUFFICIENT_EVIDENCE');
    expect(liveMock.writeContract.mock.calls.map(([request])=>request.functionName)).toEqual(['verify_evidence','evaluate']);
    expect(setup.state.snapshot).toBe(true);
  });
  it('rejects wrongly bound or corrupted snapshot materials before exposing a usable receipt',async()=>{
    const setup=await staged();setup.state.snapshot=true;setup.sample.snapshot.binding.order_id=2;
    await expect(loadOrder(1,config)).rejects.toThrow('材料承诺不一致');
    const second=await staged();second.state.snapshot=true;second.sample.snapshot.materials[0]='wrong bytes';
    await expect(loadOrder(1,config)).rejects.toThrow('材料承诺不一致');
    expect(liveMock.writeContract).not.toHaveBeenCalled();
  });
  it('rejects an assessment detached from its snapshot and never treats an RPC failure as missing evidence',async()=>{
    const setup=await staged();setup.state.snapshot=setup.state.assessment=true;setup.sample.assessment.snapshot_hash='f'.repeat(64);
    await expect(loadOrder(1,config)).rejects.toThrow('材料承诺不一致');
    liveMock.readContract.mockRejectedValue(new Error('offline'));
    await expect(loadOrder(1,config)).rejects.toThrow('offline');
    expect(liveMock.writeContract).not.toHaveBeenCalled();
  });
  it('keeps policy5 readable while denying any public legacy write',async()=>{
    const setup=await staged();const legacy=await snapshotCase();setup.state.snapshot=true;
    liveMock.readContract.mockImplementation(async({functionName}:{functionName:string})=>functionName==='get_order'?JSON.stringify(legacy.order):functionName==='get_revision'?JSON.stringify(legacy.revision):functionName==='get_evidence_snapshot'?JSON.stringify(legacy.snapshot):'');
    const order=await loadOrder(1,config);
    expect(order.policyVersion).toBe('research-receipt/5');
    expect(order.revisions[0].claims[0].claimType).toBeUndefined();
    await expect(verifyEvidence(order,1,config)).rejects.toThrow('仅供读取');
    await expect(evaluateRevision(order,1,config)).rejects.toThrow('仅供读取');
    expect(setup.wallet.request).not.toHaveBeenCalled();expect(liveMock.writeContract).not.toHaveBeenCalled();
  });
  it('refuses a getter-compatible candidate without independent source metadata before a signature',async()=>{
    const setup=await staged(),order=await loadOrder(1,config);release.sourceVerified=false;
    await expect(verifyEvidence(order,1,config)).rejects.toThrow('独立源码验证');
    expect(setup.wallet.request.mock.calls.filter(([request])=>request.method==='eth_sendTransaction')).toHaveLength(0);
    expect(liveMock.writeContract).not.toHaveBeenCalled();
  });
});
describe('one verified read session per live order load',()=>{
  const config={mode:'live' as const,rpcUrl:'https://rpc-bradbury.genlayer.com',contractAddress:'0x'+'a'.repeat(40)};
  const order={id:1,revision_count:1,owner:'0x'+'c'.repeat(40),spec:{title:'Bound research',protocol:'Example',chain:'Ethereum',as_of:'2026-11-04',author:'0x'+'c'.repeat(40),allowed_hosts:['raw.githubusercontent.com'],source_roots:[],criteria:[]},created_at:'2026-11-04'};
  const revision={submission:{report_title:'Delivery',report_body:'Bound statement.',sources:[],claims:[]}};
  it('shares verification across order, revision and assessment, then refreshes it for the next load',async()=>{
    liveMock.readContract.mockImplementation(async({functionName}:{functionName:string})=>functionName==='get_order'?JSON.stringify(order):functionName==='get_revision'?JSON.stringify(revision):'');
    await loadOrder(1,config);
    expect(liveMock.verifiedClient).toHaveBeenCalledTimes(1);
    expect(liveMock.readContract).toHaveBeenCalledTimes(3);
    expect(liveMock.readContract.mock.calls.every(([request])=>request.transactionHashVariant==='latest-final')).toBe(true);
    await loadOrder(1,config);
    expect(liveMock.verifiedClient).toHaveBeenCalledTimes(2);
  });
  it('starts revision and assessment reads in parallel while retaining the original record origin',async()=>{
    let resolveRevision!:(value:string)=>void;
    const delayedRevision=new Promise<string>(resolve=>{resolveRevision=resolve;});
    liveMock.readContract.mockImplementation(({functionName}:{functionName:string})=>functionName==='get_order'?Promise.resolve(JSON.stringify(order)):functionName==='get_revision'?delayedRevision:Promise.resolve(''));
    const selected={...config};const loading=loadOrder(1,selected);
    await vi.waitFor(()=>expect(liveMock.readContract).toHaveBeenCalledWith(expect.objectContaining({functionName:'get_assessment',args:[1,1]})));
    selected.contractAddress='0x'+'e'.repeat(40);resolveRevision(JSON.stringify(revision));
    const loaded=await loading;
    expect(loaded.origin?.contractAddress).toBe(config.contractAddress);
    expect(liveMock.readContract.mock.calls.every(([request])=>request.address===config.contractAddress)).toBe(true);
    expect(loaded.revisions).toHaveLength(1);
  });
});
