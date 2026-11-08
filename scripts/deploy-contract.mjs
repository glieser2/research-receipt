import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createAccount, createClient } from 'genlayer-js';
import { executionSucceeded } from '../src/lib/protocol-outcome.mjs';
import { studioDevnet } from 'genlayer-js/chains';
import { TransactionHashVariant } from 'genlayer-js/types';

// Explicit acknowledgement prevents this helper from uploading local source by accident.
if (process.env.RR_DEPLOY_SOURCE_ACK !== '1') throw new Error('Source disclosure is disabled. Obtain authorization to send this contract to https://studio-dev.genlayer.com/api, then set RR_DEPLOY_SOURCE_ACK=1.');
const rpcUrl = 'https://studio-dev.genlayer.com/api';
const account = createAccount(); // Dedicated disposable account; key never leaves memory.
const client = createClient({ chain: studioDevnet, endpoint: rpcUrl, account });
const code = await readFile(new URL('../contracts/research_receipt.py', import.meta.url), 'utf8');
const sourceSha256 = createHash('sha256').update(code).digest('hex');
const chainId = await client.request({ method: 'eth_chainId', params: [] });
if (Number(chainId) !== studioDevnet.id) throw new Error('Unexpected chain identity. No source submitted.');
await mkdir('artifacts', { recursive: true });
const schema = await client.getContractSchemaForCode(code);
await writeFile('artifacts/contract-schema.json', JSON.stringify({ rpcUrl, chainId: studioDevnet.id, sourceSha256, schema }, null, 2));
console.log('Runtime schema verified; source hash:', sourceSha256);
if (process.argv.includes('--schema-only')) process.exit(0);
// Official Studio UI faucet operation and default 10 test-GEN amount. Studio-dev only.
const faucet = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sim_fundAccount', params: [account.address, 10000000000000000000] }), signal: AbortSignal.timeout(30000) });
const faucetResult = await faucet.json();
if (!faucet.ok || faucetResult.error) throw new Error('Official Studio faucet unavailable; no deployment submitted.');
const balance = await client.getBalance({ address: account.address });
const estimate = await client.estimateTransactionFees({ leaderTimeunitsAllocation: 600n, validatorTimeunitsAllocation: 600n, executionBudgetPerRound: 10000000000000000n, appealRounds: 0n });
if (balance < estimate.feeValue) throw new Error('Insufficient test balance for the conservative development budget. No deployment submitted.');
// This bootstrap quote is not a measured production fee profile.
const txId = await client.deployContract({ code, args: [], fees: { distribution: estimate.distribution, feeValue: estimate.feeValue } });
await writeFile('artifacts/deployment-pending.json', JSON.stringify({ rpcUrl, txId, sourceSha256, deployer: account.address }, null, 2));
console.log('Deployment transaction:', txId);
const transaction = await client.waitForFinalization({ hash: txId, interval: 3000, retries: 80 });
if (!executionSucceeded(transaction)) throw new Error(`Deployment consensus/execution not verified: ${transaction.statusName}/${transaction.lifecycle?.outcome || 'unknown'}/${transaction.resultName || transaction.result || 'unknown'}/${transaction.txExecutionResultName}. Preserve artifacts/deployment-pending.json and investigate the same transaction; do not automatically resubmit.`);
const address = transaction.data?.contract_address;
if (!/^0x[a-fA-F0-9]{40}$/.test(address || '')) {
  await writeFile('artifacts/deployment-result.json', JSON.stringify(transaction, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  throw new Error('Finalized deployment succeeded but no contract address was decoded. Inspect saved public transaction evidence before updating frontend configuration.');
}
await client.getContractSchema(address);
const count = await client.readContract({ address, functionName: 'get_order_count', args: [], transactionHashVariant: TransactionHashVariant.LATEST_FINAL });
if (Number(count) !== 0) throw new Error('Fresh deployment readback did not return an empty order count.');
const result = { network: 'studio-dev', rpcUrl, chainId: studioDevnet.id, contractAddress: address, sourceSha256, deploymentTx: txId, verified: true, e2eVerified: false, environmentType: 'hosted-development-simulator', publicChainDeploymentVerified: false, sampleOrderIds: [], verifiedAt: new Date().toISOString() };
await writeFile('src/deployment.json', JSON.stringify(result, null, 2)+'\n');
await writeFile('artifacts/deployment-result.json', JSON.stringify(result, null, 2)+'\n');
console.log(JSON.stringify(result));
