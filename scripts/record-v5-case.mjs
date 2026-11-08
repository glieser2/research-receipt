// Record transaction identity only; final consensus and state remain separate gates.
import {readFile,writeFile} from 'node:fs/promises';
const [name,hash]=process.argv.slice(2);
const methods={createCorrectionOrder:'create_order',submitContradicted:'submit_revision',evaluateBeforeEvidence:'evaluate',verifyContradictedEvidence:'verify_evidence',duplicateEvidenceSnapshot:'verify_evidence',evaluateContradicted:'evaluate',submitCorrected:'submit_revision',verifyCorrectedEvidence:'verify_evidence',evaluateCorrected:'evaluate',createHashMismatchOrder:'create_order',submitHashMismatch:'submit_revision',verifyHashMismatchEvidence:'verify_evidence',evaluateHashMismatch:'evaluate',unboundReportBody:'submit_revision',duplicateContent:'submit_revision',createAuthorLockedOrder:'create_order',unauthorizedSubmission:'submit_revision',createStrictUnknownOrder:'create_order',submitStrictUnknown:'submit_revision',verifyStrictUnknownEvidence:'verify_evidence',evaluateStrictUnknown:'evaluate',duplicateAssessment:'evaluate',acceptedOrderClosed:'submit_revision'};
if(!Object.hasOwn(methods,name)||!/^0x[0-9a-fA-F]{64}$/.test(hash||''))throw new Error('Known v5 case and protocol ID required');
const path='artifacts/bradbury/e2e-expectations-v5.json',config=JSON.parse(await readFile(path,'utf8'));
const session=JSON.parse(await readFile('artifacts/bradbury/session-0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70.json','utf8'));
const matches=session.transactions.filter(tx=>tx.hash.toLowerCase()===hash.toLowerCase());
if(config.policyVersion!=='research-receipt/5'||matches.length!==1||matches[0].operation!==methods[name]||matches[0].address?.toLowerCase()!==config.mainRelease.contractAddress.toLowerCase())throw new Error('Signer metadata does not match v5 case');
if(config.caseHashes[name]&&config.caseHashes[name].toLowerCase()!==hash.toLowerCase())throw new Error('Never overwrite an earlier attempt');
if(Object.entries(config.caseHashes).some(([key,value])=>key!==name&&value.toLowerCase()===hash.toLowerCase()))throw new Error('One transaction cannot cover two cases');
config.caseHashes[name]=hash;await writeFile(path,JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({recordedCase:name,hash,identityOnly:true,suiteComplete:config.suiteComplete}));
