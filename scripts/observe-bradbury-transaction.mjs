// Read-only observer. A final observation is not by itself a passed business test.
import { writeFile, mkdir } from 'node:fs/promises';
import { connectBradbury, publicJson, safeError } from './bradbury-client.mjs';
import { consensusAccepted, executionSucceeded, executionReverted, finalizedUndetermined } from '../src/lib/protocol-outcome.mjs';
const hash = process.argv[2];
if (!/^0x[0-9a-fA-F]{64}$/.test(hash || '')) throw new Error('Provide a public protocol transaction ID.');
const { client } = await connectBradbury();
await mkdir('artifacts/bradbury/observations', { recursive: true });
let previous = ''; let failures = 0;
for (let poll = 0; poll < 60; poll++) {
  try {
    const tx = await client.getTransaction({ hash });
    failures = 0;
    const summary = { observedAt: new Date().toISOString(), hash, status: tx.statusName, result: tx.result, resultName: tx.resultName, lifecycle: tx.lifecycle, execution: tx.txExecutionResultName, recipient: tx.recipient, consensusAccepted: consensusAccepted(tx), executionSucceeded: executionSucceeded(tx), executionReverted: executionReverted(tx), finalizedUndetermined: finalizedUndetermined(tx) };
    if (tx.statusName !== previous) { console.log(publicJson(summary)); previous = tx.statusName; }
    if (tx.statusName === 'FINALIZED' || tx.statusName === 'CANCELED') {
      await writeFile(`artifacts/bradbury/observations/${hash}.json`, publicJson(summary) + '\n');
      console.log(publicJson({ finalObservation: true, ...summary }));
      process.exit(tx.statusName === 'FINALIZED' ? 0 : 2);
    }
  } catch (error) {
    failures++;
    console.log(publicJson({ hash, readError: safeError(error), consecutiveReadFailures: failures }));
    if (failures >= 3) process.exit(3);
  }
  await new Promise(resolve => setTimeout(resolve, 15000));
}
console.log(publicJson({ hash, finalObservation: false, reason: 'Observation limit reached. Do not resubmit based on this timeout.' }));
process.exitCode = 4;
