// Independent Studio-dev test actors live only in this process. Never prints or writes keys.
import { createInterface } from 'node:readline';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createAccount, createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';
if (process.env.RR_DEPLOY_SOURCE_ACK !== '1') throw new Error('Explicit Studio-dev source disclosure acknowledgement required.');
const rpcUrl='https://studio-dev.genlayer.com/api';
const actors={owner:createAccount(),author:createAccount(),outsider:createAccount()};
const clients=Object.fromEntries(Object.entries(actors).map(([role,account])=>[role,createClient({chain:studioDevnet,endpoint:rpcUrl,account})]));
const json=(value)=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
const output=(value)=>console.log(json(value));
const state={network:'studio-dev',chainId:61997,rpcUrl,actors:Object.fromEntries(Object.entries(actors).map(([role,a])=>[role,a.address])),contractAddress:process.env.RR_CONTRACT_ADDRESS||null,transactions:[]};
await mkdir('artifacts/live',{recursive:true});
async function save(){await writeFile('artifacts/live/session.json',JSON.stringify(state,null,2)+'\n');}
async function rpc(method,params){const response=await fetch(rpcUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:json({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(45000)});const r=await response.json();if(r.error)throw new Error(r.error.message);return r.result;}
if(Number(await rpc('eth_chainId',[]))!==61997)throw new Error('Wrong network; stopped.');
await save(); output({ready:true,...state});
const lines=createInterface({input:process.stdin,terminal:false});
for await (const line of lines){
  if(!line.trim())continue;
  let request;
  try{
    request=JSON.parse(line);const client=clients[request.role||'owner'];if(!client)throw new Error('Invalid test role');
    if(request.inputFile){if(!/^artifacts\/live\/[A-Za-z0-9_.-]+\.json$/.test(request.inputFile))throw new Error('Invalid input fixture path');const input=JSON.parse(await readFile(request.inputFile,'utf8'));if(!Object.hasOwn(input,request.case))throw new Error('Unknown fixture case');request.args=[...(request.prefixArgs||[]),JSON.stringify(input[request.case])];}
    const target=request.address||state.contractAddress;
    let result;
    if(request.op==='fund'){
      // Same public Studio faucet operation and default amount as official AccountSelect.vue.
      const address=actors[request.role||'owner'].address;
      const tx=await rpc('sim_fundAccount',[address,10000000000000000000]);
      result={faucetTransaction:tx,address,balance:(await client.getBalance({address})).toString()};
    }else if(request.op==='schema'||request.op==='deploy'){
      const file=resolve(request.file||'contracts/research_receipt.py');if(!file.startsWith(resolve('.')+'\\')&&!file.startsWith(resolve('.')+'/'))throw new Error('Source must stay in this project');
      const code=await readFile(file,'utf8');const sourceSha256=createHash('sha256').update(code).digest('hex');
      if(request.op==='schema')result={sourceSha256,schema:await client.getContractSchemaForCode(code)};
      else{
        const quote=await client.estimateTransactionFees({leaderTimeunitsAllocation:600n,validatorTimeunitsAllocation:600n,executionBudgetPerRound:10000000000000000n,appealRounds:0n});
        const hash=await client.deployContract({code,args:request.args||[],fees:{distribution:quote.distribution,feeValue:quote.feeValue}});
        state.transactions.push({hash,operation:'deploy',sourceSha256,file,role:request.role||'owner',feeValue:quote.feeValue.toString()});result={hash,sourceSha256};
      }
    }else if(request.op==='status'){
      const hash=request.hash||state.transactions.at(-1)?.hash;if(!hash)throw new Error('No transaction');
      const tx=await client.getTransaction({hash});
      await writeFile(`artifacts/live/${hash}.json`,json(tx)+'\n');
      result={hash,status:tx.statusName,execution:tx.txExecutionResultName,contractAddress:tx.data?.contract_address,transactionResult:tx.result,leaderResults:tx.consensus_data?.leader_receipt?.slice(0,1).map(r=>r.result)};
    }else if(request.op==='bind'){
      if(!/^0x[0-9a-fA-F]{40}$/.test(request.address))throw new Error('Invalid address');state.contractAddress=request.address;result={contractAddress:state.contractAddress,schema:await client.getContractSchema(request.address)};
    }else if(request.op==='read')result=await client.readContract({address:target,functionName:request.method,args:request.args||[],transactionHashVariant:TransactionHashVariant.LATEST_FINAL});
    else if(request.op==='simulate')result=await client.simulateWriteContract({address:target,functionName:request.method,args:request.args||[],includeReceipt:true});
    else if(request.op==='write'){
      const call={address:target,functionName:request.method,args:request.args||[]};
      const quote=request.direct?await client.estimateTransactionFees({leaderTimeunitsAllocation:600n,validatorTimeunitsAllocation:600n,executionBudgetPerRound:10000000000000000n,appealRounds:0n}):await client.estimateTransactionFeesForWrite(call);
      const hash=await client.writeContract({...call,fees:{distribution:quote.distribution,feeValue:quote.feeValue}});
      state.transactions.push({hash,operation:request.method,role:request.role||'owner',feeValue:quote.feeValue.toString()});result={hash,feeValue:quote.feeValue.toString()};
    }else if(request.op==='quit'){await save();output({closed:true});break;}
    else throw new Error('Unknown operation');
    await save();output({ok:true,op:request.op,result});
  }catch(error){output({ok:false,op:request?.op,error:String(error?.message||error).slice(0,5000)});}
}
