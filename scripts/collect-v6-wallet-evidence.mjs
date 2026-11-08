// 针对纠正后用户自控钱包（v6-wallet-2）的只读证据收集器。
// 严禁接触私钥、签名、广播、增补资金、调用模型或使用重放式 trace；
// 保持原 33 笔历史交易（0x29eb...）完整核验并与新钱包 51 项执行严格隔离。
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT, safeError } from './bradbury-client.mjs';
import {
  COLLECT_ACK,
  DEPLOYMENT_SOURCE_SHA256,
  HISTORICAL_METADATA_SHA256,
  HISTORICAL_TRANSACTIONS,
  HISTORICAL_UNDETERMINED,
  PLAN_SHA256 as ORIGINAL_PLAN_SHA256,
  collectV6Evidence,
  loadV6Inputs,
  notCollectedEvidence,
  validateV6Ledger,
} from './collect-v6-evidence.mjs';

export const WALLET_2_PLAN_FILE = 'docs/evidence/v6-wallet-2-validation-plan.json';
export const WALLET_2_PLAN_SHA256 = '306f742ac1b8bbdb8c01f0125c565dafe2c059ff1627cc1ed4f62c5804924b89';
export const WALLET_2_FIXTURE_SHA256 = '518df208e7fc340a60383a0f7dc1fa1085d9e6283ed0ae8955ddf334ef763be3';
export const WALLET_2_OWNER = '0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd';
export const WALLET_1_SUPERSEDED_PLAN_SHA256 = '04dbef08dc757f7457808d04f320b8cade446ca507596388e9f275e830753f77';
export const WALLET_1_SUPERSEDED_OWNER = '0xfdb942f537095d8e0c36b97a3b0324de81db9c3f';
export const HISTORICAL_OWNER = '0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70';
export const WALLET_2_LEDGER_FILE = 'artifacts/bradbury/v6-wallet-2-execution-ledger.json';
export const WALLET_2_OUTPUT_FILE = 'docs/evidence/bradbury-v6-wallet-2-e2e.json';
export const WALLET_2_COLLECT_ACK = 'READ_ONLY_V6_WALLET_2_PUBLIC_EVIDENCE';

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

export async function loadV6Wallet2Inputs({ root = PROJECT_ROOT, requireArchivedEvidence = false } = {}) {
  const inputs = await loadV6Inputs({
    root,
    requireArchivedEvidence,
    planFile: WALLET_2_PLAN_FILE,
    planSha256: WALLET_2_PLAN_SHA256,
  });
  ensure(
    inputs.plan.executionAuthority === 'user-controlled-wallet' &&
      inputs.plan.executionRun === 'v6-wallet-2' &&
      inputs.owner === WALLET_2_OWNER &&
      inputs.plan.fixtureSha256 === WALLET_2_FIXTURE_SHA256,
    'Frozen v6-wallet-2 plan identity mismatch',
  );
  ensure(
    inputs.plan.supersedesExecutionPlan?.sha256 === ORIGINAL_PLAN_SHA256 &&
      inputs.plan.supersedesWallet1Plan?.sha256 === WALLET_1_SUPERSEDED_PLAN_SHA256 &&
      inputs.plan.supersedesWallet1Plan?.supersededOwner === WALLET_1_SUPERSEDED_OWNER,
    'Frozen v6-wallet-2 lineage commitment mismatch',
  );
  return inputs;
}

export function validateV6Wallet2Ledger(ledger, inputs) {
  ensure(
    ledger?.planSha256 !== ORIGINAL_PLAN_SHA256 &&
      ledger?.planSha256 !== WALLET_1_SUPERSEDED_PLAN_SHA256,
    'Superseded or historical plan ledger cannot be used for v6-wallet-2',
  );
  ensure(
    !ledger?.transportAddendum,
    'User-wallet run uses the locked wallet owner for all 51 cases; transport addendum is forbidden',
  );
  if (ledger?.executionRun !== undefined) {
    ensure(ledger.executionRun === 'v6-wallet-2', 'Ledger executionRun mismatch');
  }
  validateV6Ledger(ledger, inputs);
}

export function notCollectedWallet2Evidence() {
  return notCollectedEvidence({
    planFile: WALLET_2_PLAN_FILE,
    planSha256: WALLET_2_PLAN_SHA256,
    executionRun: 'v6-wallet-2',
    owner: WALLET_2_OWNER,
  });
}

export async function collectV6Wallet2Evidence(ledger, options = {}, dependencies = {}) {
  ensure(
    options.ack === WALLET_2_COLLECT_ACK || options.ack === COLLECT_ACK,
    'Read-only wallet-2 network collection requires explicit ACK',
  );
  const inputs =
    dependencies.inputs || (await loadV6Wallet2Inputs({ requireArchivedEvidence: true }));
  validateV6Wallet2Ledger(ledger, inputs);
  return collectV6Evidence(
    ledger,
    {
      ...options,
      ack: COLLECT_ACK,
      planFile: WALLET_2_PLAN_FILE,
      planSha256: WALLET_2_PLAN_SHA256,
    },
    { ...dependencies, inputs },
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--collect')) {
    const inputs = await loadV6Wallet2Inputs();
    console.log(
      JSON.stringify(
        {
          ...notCollectedWallet2Evidence(),
          dependenciesComplete: inputs.dependenciesComplete,
          missingArchivedEvidence: inputs.missingArchivedEvidence,
          commitments: inputs.commitments,
          selfTest: args.includes('--self-test')
            ? inputs.dependenciesComplete
              ? 'LOCAL_WALLET_2_COMMITMENTS_VERIFIED'
              : 'AVAILABLE_LOCAL_WALLET_2_COMMITMENTS_VERIFIED'
            : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }
  ensure(
    process.env.RESEARCH_RECEIPT_V6_WALLET_2_COLLECT_ACK === WALLET_2_COLLECT_ACK,
    'Set explicit RESEARCH_RECEIPT_V6_WALLET_2_COLLECT_ACK for read-only wallet-2 collection',
  );
  const option = name => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const ledger = JSON.parse(await localBytes(option('--ledger') || WALLET_2_LEDGER_FILE));
  const evidence = await collectV6Wallet2Evidence(ledger, { ack: WALLET_2_COLLECT_ACK });
  const output = resolve(PROJECT_ROOT, WALLET_2_OUTPUT_FILE);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(
    JSON.stringify({
      output: WALLET_2_OUTPUT_FILE,
      executionRun: 'v6-wallet-2',
      owner: WALLET_2_OWNER,
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
  DEPLOYMENT_SOURCE_SHA256,
  HISTORICAL_METADATA_SHA256,
  HISTORICAL_TRANSACTIONS,
  HISTORICAL_UNDETERMINED,
};
