// Bounded public event and envelope inspection. No appeal/top-up is submitted.
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createPublicClient,http,decodeEventLog,decodeFunctionData } from 'viem';
import { testnetBradbury } from 'genlayer-js/chains';
import { publicJson } from './bradbury-client.mjs';
const txId=process.argv[2];assert.match(txId||'',/^0x[0-9a-fA-F]{64}$/);
const original=JSON.parse(await readFile(`artifacts/bradbury/original-envelope-${txId}.json`,'utf8'));
const main='0x2E2766cbc3E5e61Ce93bBcdCBb3eAcB82082A019';
const addresses=[main,'0x7678587A847712f2A96082AC07883A88D0fc7245','0xdc953c3bCf8837987853ca05a78D52fFC3E18651','0xaCe5e4191Bf408957538Caa9493aBB64F63D92c4'];
const client=createPublicClient({transport:http('https://rpc-bradbury.genlayer.com',{retryCount:0,timeout:30000})});
const fromBlock=BigInt(original.protocolEvent.blockNumber),toBlock=await client.getBlockNumber();assert.ok(toBlock>=fromBlock&&toBlock-fromBlock<=20000n);
const logs=await client.request({method:'eth_getLogs',params:[{address:addresses,fromBlock:`0x${fromBlock.toString(16)}`,toBlock:`0x${toBlock.toString(16)}`,topics:[null,txId]}]});
const decodedLogs=logs.filter(log=>!log.removed).map(log=>{
  let decoded=null;try{decoded=decodeEventLog({abi:testnetBradbury.consensusMainContract.abi,topics:log.topics,data:log.data,strict:true});}catch{/* Unknown ABI is retained as public topics/data, never guessed. */}
  return {address:log.address,blockNumber:log.blockNumber,blockHash:log.blockHash,transactionHash:log.transactionHash,logIndex:log.logIndex,topics:log.topics,data:log.data,...(decoded?{decoded}:{decoded:null})};
});
const envelopeHashes=[...new Set(decodedLogs.filter(log=>log.decoded&&['AppealStarted','AppealBondReturned','AppealerProfitPayoutFailed','FeesRefunded'].includes(log.decoded.eventName)).map(log=>log.transactionHash))];
const envelopes=[];
for(const hash of envelopeHashes){
  const [tx,receipt]=await Promise.all([client.getTransaction({hash}),client.getTransactionReceipt({hash})]);
  assert.equal(receipt.status,'success');assert.equal(tx.hash.toLowerCase(),hash.toLowerCase());assert.equal(tx.blockHash,receipt.blockHash);
  let decoded=null;try{decoded=decodeFunctionData({abi:testnetBradbury.consensusMainContract.abi,data:tx.input});}catch{/* A keeper entrypoint absent from SDK is not assigned a guessed name. */}
  envelopes.push({hash,from:tx.from,to:tx.to,value:tx.value.toString(),nonce:tx.nonce,blockNumber:tx.blockNumber.toString(),blockHash:tx.blockHash,input:tx.input,decoded});
}
const evidence={format:'research-receipt/public-fee-history/1',readOnly:true,modelCalls:0,chainTransactionsSent:0,protocolTxId:txId,fromBlock:fromBlock.toString(),toBlock:toBlock.toString(),addressFilter:addresses,topicFilter:'Exact transaction ID in indexed topic1',events:decodedLogs,envelopes,limitations:['SDK ABI contains no FeeManager/Appeals events; unknown event signatures remain raw, not guessed.','Only the four explicitly named protocol contracts and topic1 txId were queried. Absence of an event is not proof that no off-chain or differently indexed change occurred.']};
await writeFile(`artifacts/bradbury/fee-history-${txId}.json`,`${publicJson(evidence)}\n`,{flag:'wx'});
console.log(publicJson({...evidence,events:decodedLogs.map(log=>({...log,data:'[retained public event data]'})),envelopes:envelopes.map(tx=>({...tx,input:'[retained original public calldata]'}))}));
