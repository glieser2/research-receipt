// Reusable READ-ONLY observer. No account, signer, send, or automatic resubmission.
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { validateEvidenceSnapshot, canonicalEvidenceJson } from '../src/lib/evidence-snapshot.mjs';
import { connectBradbury, publicJson, safeError } from './bradbury-client.mjs';
import { consensusAccepted, executionSucceeded, executionReverted, finalizedUndetermined } from '../src/lib/protocol-outcome.mjs';
const { client, publicClient } = await connectBradbury();
const output = value => process.stdout.write(publicJson(value) + '\n');
await mkdir('artifacts/bradbury/observations', { recursive: true });
output({ ready: true, readOnly: true });
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  try {
    const request = JSON.parse(line);
    if (request.op === 'snapshot' || request.op === 'assessment') {
      const config=JSON.parse(await readFile('artifacts/bradbury/e2e-expectations-v5.json','utf8'));
      const plan=JSON.parse(await readFile(config.validationPlanFile,'utf8'));
      const expected=plan.expectedSnapshots.find(row=>row.orderId===request.orderId&&row.revision===request.revision);
      if (!expected) throw new Error('No prelocked snapshot oracle for this order/revision.');
      const address=config.mainRelease.contractAddress;
      const view=(functionName,args)=>client.readContract({address,functionName,args,transactionHashVariant:'latest-final'});
      const order=JSON.parse(await view('get_order',[request.orderId]));
      const revision=JSON.parse(await view('get_revision',[request.orderId,request.revision]));
      const snapshot=JSON.parse(await view('get_evidence_snapshot',[request.orderId,request.revision]));
      const assessmentRaw=await view('get_assessment',[request.orderId,request.revision]);
      const assessment=assessmentRaw?JSON.parse(assessmentRaw):null;
      const verified=await validateEvidenceSnapshot({snapshot,order,revision,expectedRevision:request.revision,assessment});
      if (verified.snapshotHash!==expected.snapshotHash) throw new Error('Snapshot differs from prelocked complete content hash.');
      if (request.op==='assessment') {
        const oracle=plan.expected.find(row=>row.id===expected.id);
        if (!assessment || assessment.verdict!==oracle.verdict || assessment.findings.length!==oracle.statuses.length || assessment.findings.some((finding,index)=>finding.criterion_id!==order.spec.criteria[index].id||finding.status!==oracle.statuses[index]||finding.delivery_status!==oracle.delivery[index]||canonicalEvidenceJson(finding.evidence_indices)!==canonicalEvidenceJson(finding.status==='SOURCE_UNAVAILABLE'?[]:revision.submission.claims.find(c=>c.criterion_id===finding.criterion_id).evidence_indices))) throw new Error('Full assessment differs from prelocked oracle.');
      } else if (assessment) throw new Error('Snapshot gate expected an unassessed revision.');
      await mkdir('artifacts/bradbury/readbacks',{recursive:true});
      await writeFile(`artifacts/bradbury/readbacks/v5-${request.op}-${request.orderId}-${request.revision}.json`,publicJson({observedAt:new Date().toISOString(),variant:'latest-final',order,revision,snapshot,assessment,verified})+'\n');
      output({readbackVerified:true,op:request.op,orderId:request.orderId,revision:request.revision,...verified,verdict:assessment?.verdict||null,findings:assessment?.findings.map(({criterion_id,status,delivery_status,evidence_indices})=>({criterion_id,status,delivery_status,evidence_indices}))||null});
      continue;
    }
    if (request.op === 'read') {
      if (!/^0x[0-9a-fA-F]{40}$/.test(request.address || '') || !['get_order_id', 'get_order_count', 'get_order', 'get_revision', 'get_assessment','get_evidence_snapshot'].includes(request.method) || !Array.isArray(request.args)) throw new Error('Only supported public view calls are allowed.');
      const value = await client.readContract({ address: request.address, functionName: request.method, args: request.args, transactionHashVariant: 'latest-final' });
      output({ readback: true, address: request.address, method: request.method, args: request.args, variant: 'latest-final', value });
      continue;
    }
    if (request.op !== 'watch' || !/^0x[0-9a-fA-F]{64}$/.test(request.hash || '')) throw new Error('An exact public protocol transaction ID is required.');
    if (await publicClient.getChainId() !== 4221) throw new Error('Network identity changed.');
    let previous = ''; let failures = 0; let completed = false;
    for (let poll = 0; poll < 60; poll++) {
      try {
        const tx = await client.getTransaction({ hash: request.hash }); failures = 0;
        const summary = { observedAt: new Date().toISOString(), hash: request.hash, status: tx.statusName, result: tx.result, resultName: tx.resultName, lifecycle: tx.lifecycle, execution: tx.txExecutionResultName, recipient: tx.recipient, consensusAccepted: consensusAccepted(tx), executionSucceeded: executionSucceeded(tx), executionReverted: executionReverted(tx), finalizedUndetermined: finalizedUndetermined(tx) };
        if (tx.statusName !== previous) { output(summary); previous = tx.statusName; }
        if (['FINALIZED', 'CANCELED'].includes(tx.statusName)) {
          await writeFile(`artifacts/bradbury/${request.hash}.json`, publicJson(tx) + '\n');
          await writeFile(`artifacts/bradbury/observations/${request.hash}.json`, publicJson(summary) + '\n');
          output({ finalObservation: true, ...summary }); completed = true; break;
        }
      } catch (error) {
        output({ hash: request.hash, readError: safeError(error), consecutiveReadFailures: ++failures });
        if (failures >= 3) break;
      }
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    if (!completed) output({ hash: request.hash, finalObservation: false, noResubmission: true });
  } catch (error) { output({ error: safeError(error), noTransactionSent: true }); }
}
