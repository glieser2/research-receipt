// Records identity only. This never marks a case passed or resubmits a transaction.
import { readFile, writeFile } from 'node:fs/promises';
const [name, hash] = process.argv.slice(2);
const methods = { createCorrectionOrder: 'create_order', submitContradicted: 'submit_revision', evaluateContradicted: 'evaluate', submitCorrected: 'submit_revision', evaluateCorrected: 'evaluate', createHashMismatchOrder: 'create_order', submitHashMismatch: 'submit_revision', evaluateHashMismatch: 'evaluate', duplicateContent: 'submit_revision', createAuthorLockedOrder: 'create_order', unauthorizedSubmission: 'submit_revision', duplicateAssessment: 'evaluate', acceptedOrderClosed: 'submit_revision', createStrictUnknownOrder: 'create_order', submitStrictUnknown: 'submit_revision', evaluateStrictUnknown: 'evaluate', unboundReportBody: 'submit_revision' };
if (!Object.hasOwn(methods, name) || !/^0x[0-9a-fA-F]{64}$/.test(hash || '')) throw new Error('Known case and exact public protocol transaction ID required.');
const path = 'artifacts/bradbury/e2e-expectations-v4.json';
const config = JSON.parse(await readFile(path, 'utf8'));
const session = JSON.parse(await readFile('artifacts/bradbury/session-0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70.json', 'utf8'));
const matches = session.transactions.filter(tx => tx.hash.toLowerCase() === hash.toLowerCase());
if (matches.length !== 1 || matches[0].operation !== methods[name] || matches[0].address?.toLowerCase() !== config.mainRelease.contractAddress.toLowerCase()) throw new Error('Case transaction does not match retained signer metadata.');
if (config.caseHashes[name] && config.caseHashes[name].toLowerCase() !== hash.toLowerCase()) throw new Error('Never overwrite an existing attempt.');
if (Object.entries(config.caseHashes).some(([key, value]) => key !== name && value.toLowerCase() === hash.toLowerCase())) throw new Error('A transaction cannot cover two required cases.');
config.caseHashes[name] = hash;
await writeFile(path, JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({ recordedCase: name, protocolTxId: hash, identityOnly: true, suiteComplete: config.suiteComplete }));
