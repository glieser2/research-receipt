// 针对方案 A（v6-wallet-3 + compact_v2 部署工件）的只读证据收集器。
// 严禁接触私钥、签名、广播、增补资金、调用模型或使用重放式 trace；
// 保持原 33 笔历史交易（0x29eb...）及 v6-wallet-2 回滚证据（0xfa5156...）完整隔离并逐字节核验。
import { mkdir, open, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT, safeError } from './bradbury-client.mjs';
import {
  COLLECT_ACK,
  DEPLOYMENT_SOURCE_SHA256 as V1_COMPACT_SOURCE_SHA256,
  HISTORICAL_METADATA_SHA256,
  HISTORICAL_TRANSACTIONS,
  HISTORICAL_UNDETERMINED,
  PLAN_SHA256 as ORIGINAL_PLAN_SHA256,
  collectV6Evidence,
  loadV6Inputs,
  notCollectedEvidence,
  validateV6Ledger,
} from './collect-v6-evidence.mjs';

export const WALLET_3_PLAN_FILE = 'docs/evidence/v6-wallet-3-validation-plan.json';
export const WALLET_3_PLAN_SHA256 = '76c2583b393255b241e670e5ba418a7517003d56afdfd1316f0c5c746c8a1b1a';
export const WALLET_3_FIXTURE_SHA256 = 'b779bbf58577b7eec6a57443e8de794d287f571400d8e033146c187121afe8c0';
export const WALLET_3_DEPLOYMENT_SOURCE_SHA256 = '2af33b26424a8bc2399d71cdb6a2ccdbd53acb0e4fc06de1ede14bb7791e42e2';
export const WALLET_3_OWNER = '0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd';

export const WALLET_1_SUPERSEDED_PLAN_SHA256 = '04dbef08dc757f7457808d04f320b8cade446ca507596388e9f275e830753f77';
export const WALLET_1_SUPERSEDED_OWNER = '0xfdb942f537095d8e0c36b97a3b0324de81db9c3f';
export const WALLET_2_SUPERSEDED_PLAN_SHA256 = '306f742ac1b8bbdb8c01f0125c565dafe2c059ff1627cc1ed4f62c5804924b89';
export const WALLET_2_REVERT_EVIDENCE_SHA256 = '2e568bbf60856e864fc78f9d799d1a78505933675c61f8c7daad4b52effb496d';
export const WALLET_2_REVERTED_ENVELOPE_HASH = '0xfa51562ff02e0e19346723c3ba2687654b2c4682d86d28104851c62b7db6ba23';
export const HISTORICAL_OWNER = '0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70';

export const WALLET_3_LEDGER_FILE = 'artifacts/bradbury/v6-wallet-3-execution-ledger.json';
export const WALLET_3_OUTPUT_FILE = 'docs/evidence/bradbury-v6-wallet-3-e2e.json';
export const WALLET_3_COLLECT_ACK = 'READ_ONLY_V6_WALLET_3_PUBLIC_EVIDENCE';

const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function localBytes(name, root = PROJECT_ROOT) {
  ensure(typeof name === 'string' && !isAbsolute(name), 'Input must be project-relative');
  const base = await realpath(root);
  const path = await realpath(resolve(base, name.replaceAll('\\', '/')));
  const rel = relative(base, path);
  ensure(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Input escapes project');
  const details = await stat(path);
  ensure(details.isFile() && details.size < 32 * 1024 * 1024, 'Invalid or oversized evidence file');
  return readFile(path);
}

export async function loadV6Wallet3Inputs({ root = PROJECT_ROOT, requireArchivedEvidence = false } = {}) {
  const inputs = await loadV6Inputs({
    root,
    requireArchivedEvidence,
    planFile: WALLET_3_PLAN_FILE,
    planSha256: WALLET_3_PLAN_SHA256,
    deploymentSourceSha256: WALLET_3_DEPLOYMENT_SOURCE_SHA256,
  });
  ensure(
    inputs.plan.executionAuthority === 'user-controlled-wallet' &&
      inputs.plan.executionRun === 'v6-wallet-3' &&
      inputs.owner === WALLET_3_OWNER &&
      inputs.plan.fixtureSha256 === WALLET_3_FIXTURE_SHA256 &&
      inputs.deploymentSourceSha256 === WALLET_3_DEPLOYMENT_SOURCE_SHA256,
    'Frozen v6-wallet-3 plan identity mismatch',
  );
  ensure(
    inputs.plan.supersedesExecutionPlan?.sha256 === ORIGINAL_PLAN_SHA256 &&
      inputs.plan.supersedesWallet1Plan?.sha256 === WALLET_1_SUPERSEDED_PLAN_SHA256 &&
      inputs.plan.supersedesWallet1Plan?.supersededOwner === WALLET_1_SUPERSEDED_OWNER &&
      inputs.plan.supersedesWallet2Plan?.sha256 === WALLET_2_SUPERSEDED_PLAN_SHA256 &&
      inputs.plan.supersedesWallet2Plan?.revertedDeploymentEvidenceSha256 === WALLET_2_REVERT_EVIDENCE_SHA256 &&
      inputs.plan.supersedesWallet2Plan?.revertedEnvelopeHash === WALLET_2_REVERTED_ENVELOPE_HASH &&
      inputs.plan.supersedesWallet2Plan?.supersededDeploymentSourceSha256 === V1_COMPACT_SOURCE_SHA256,
    'Frozen v6-wallet-3 lineage commitment mismatch',
  );
  return inputs;
}

export function validateV6Wallet3Ledger(ledger, inputs) {
  ensure(
    ledger?.planSha256 !== ORIGINAL_PLAN_SHA256 &&
      ledger?.planSha256 !== WALLET_1_SUPERSEDED_PLAN_SHA256 &&
      ledger?.planSha256 !== WALLET_2_SUPERSEDED_PLAN_SHA256,
    'Superseded or historical plan ledger cannot be used for v6-wallet-3',
  );
  ensure(
    !ledger?.transportAddendum,
    'User-wallet run uses the locked wallet owner for all 51 cases; transport addendum is forbidden',
  );
  if (ledger?.executionRun !== undefined) {
    ensure(ledger.executionRun === 'v6-wallet-3', 'Ledger executionRun mismatch');
  }
  if (Array.isArray(ledger?.attempts)) {
    for (const row of ledger.attempts) {
      ensure(
        row?.hash?.toLowerCase() !== WALLET_2_REVERTED_ENVELOPE_HASH &&
          row?.envelopeHash?.toLowerCase() !== WALLET_2_REVERTED_ENVELOPE_HASH,
        'Reverted v6-wallet-2 deployment envelope cannot appear in v6-wallet-3 case attempts',
      );
    }
  }
  validateV6Ledger(ledger, inputs);
}

export function notCollectedWallet3Evidence() {
  return notCollectedEvidence({
    planFile: WALLET_3_PLAN_FILE,
    planSha256: WALLET_3_PLAN_SHA256,
    executionRun: 'v6-wallet-3',
    owner: WALLET_3_OWNER,
  });
}

export async function collectV6Wallet3Evidence(ledger, options = {}, dependencies = {}) {
  ensure(
    options.ack === WALLET_3_COLLECT_ACK,
    'Read-only wallet-3 network collection requires explicit WALLET_3_COLLECT_ACK',
  );
  const inputs =
    dependencies.inputs || (await loadV6Wallet3Inputs({ requireArchivedEvidence: true }));
  validateV6Wallet3Ledger(ledger, inputs);
  return collectV6Evidence(
    ledger,
    {
      ...options,
      ack: COLLECT_ACK,
      planFile: WALLET_3_PLAN_FILE,
      planSha256: WALLET_3_PLAN_SHA256,
      deploymentSourceSha256: WALLET_3_DEPLOYMENT_SOURCE_SHA256,
    },
    { ...dependencies, inputs },
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--collect')) {
    const inputs = await loadV6Wallet3Inputs();
    console.log(
      JSON.stringify(
        {
          ...notCollectedWallet3Evidence(),
          deploymentSourceSha256: WALLET_3_DEPLOYMENT_SOURCE_SHA256,
          dependenciesComplete: inputs.dependenciesComplete,
          missingArchivedEvidence: inputs.missingArchivedEvidence,
          commitments: inputs.commitments,
          selfTest: args.includes('--self-test')
            ? inputs.dependenciesComplete
              ? 'LOCAL_WALLET_3_COMMITMENTS_VERIFIED'
              : 'AVAILABLE_LOCAL_WALLET_3_COMMITMENTS_VERIFIED'
            : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }
  ensure(
    process.env.RESEARCH_RECEIPT_V6_WALLET_3_COLLECT_ACK === WALLET_3_COLLECT_ACK,
    'Set explicit RESEARCH_RECEIPT_V6_WALLET_3_COLLECT_ACK for read-only wallet-3 collection',
  );
  const option = name => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const ledger = JSON.parse(await localBytes(option('--ledger') || WALLET_3_LEDGER_FILE));
  const evidence = await collectV6Wallet3Evidence(ledger, { ack: WALLET_3_COLLECT_ACK });
  const output = resolve(PROJECT_ROOT, WALLET_3_OUTPUT_FILE);
  await mkdir(dirname(output), { recursive: true });
  const handle = await open(output, 'wx');
  try {
    await handle.writeFile(JSON.stringify(evidence, null, 2) + '\n');
    await handle.sync();
  } finally {
    await handle.close();
  }
  console.log(
    JSON.stringify({
      output: WALLET_3_OUTPUT_FILE,
      executionRun: 'v6-wallet-3',
      owner: WALLET_3_OWNER,
      deploymentSourceSha256: WALLET_3_DEPLOYMENT_SOURCE_SHA256,
      status: evidence.status,
      ready: evidence.ready,
      passed: evidence.cases.filter(row => row.passed).length,
      required: 51,
      retainedHistory: evidence.historicalTransactions.length,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(safeError(error));
    process.exitCode = 1;
  });
}

export {
  HISTORICAL_METADATA_SHA256,
  HISTORICAL_TRANSACTIONS,
  HISTORICAL_UNDETERMINED,
  V1_COMPACT_SOURCE_SHA256,
};
