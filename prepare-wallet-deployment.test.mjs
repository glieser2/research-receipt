import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { PROJECT_ROOT } from '../../scripts/bradbury-client.mjs';
import { sha256 } from '../../scripts/bradbury-gas-aware-session.mjs';
import {
  BRADBURY_MAX_TX_GAS_LIMIT,
  LOCKED_WALLET_4_PLAN_SHA,
  LOCKED_WALLET_OWNER,
  MAX_PLAN_BYTES,
  SUPERSEDED_OWNERS,
  SUPERSEDED_PLANS,
  WALLET_BOUNDED_GAS_LIMIT,
  WALLET_DEPLOYMENT_SOURCE_SHA,
  readWalletPlanBytes,
  validateWalletPlan,
  walletPlanFile,
} from '../../scripts/prepare-wallet-deployment.mjs';

const CORRECTED_OWNER = '0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd';

test('walletPlanFile 与 readWalletPlanBytes 强制项目内相对路径、拒绝越界与超限文件，并支持合法前缀文件名', async () => {
  const existing = await walletPlanFile('docs/evidence/v6-wallet-4-validation-plan.json');
  assert.ok(existing.endsWith('v6-wallet-4-validation-plan.json'));

  const rawBytes = await readWalletPlanBytes('docs/evidence/v6-wallet-4-validation-plan.json');
  assert.ok(Buffer.isBuffer(rawBytes) && rawBytes.length > 0 && rawBytes.length <= MAX_PLAN_BYTES);

  await assert.rejects(
    () => readWalletPlanBytes('docs/evidence/v6-wallet-4-validation-plan.json', 128),
    /below 1 MiB/,
  );

  await assert.rejects(() => walletPlanFile(existing), /project-relative JSON plan/);
  await assert.rejects(() => walletPlanFile('../outside.json'), /inside the project/);
  await assert.rejects(() => walletPlanFile('README.md'), /project-relative JSON plan/);

  const dotDotName = 'artifacts/..temp-wallet-plan-check.json';
  const dotDotAbs = resolve(PROJECT_ROOT, dotDotName);
  await mkdir(dirname(dotDotAbs), { recursive: true });
  await writeFile(dotDotAbs, '{"ok":true}\n', 'utf8');
  try {
    const resolved = await walletPlanFile(dotDotName);
    assert.equal(resolved, dotDotAbs);
  } finally {
    await rm(dotDotAbs, { force: true });
  }
});

test('validateWalletPlan 通过冻结的 v6-wallet-4 计划，并拒绝旧计划、wallet-1/2/3 计划、作废签名者与篡改承诺', async () => {
  assert.ok(WALLET_BOUNDED_GAS_LIMIT < BRADBURY_MAX_TX_GAS_LIMIT);
  assert.equal(BRADBURY_MAX_TX_GAS_LIMIT, 32000000n);

  // 拒绝已作废的 wallet-1、wallet-2 与 wallet-3 计划
  for (const supersededFile of [
    'docs/evidence/v6-wallet-1-validation-plan.json',
    'docs/evidence/v6-wallet-2-validation-plan.json',
    'docs/evidence/v6-wallet-3-validation-plan.json',
  ]) {
    const supersededBytes = await readFile(resolve(PROJECT_ROOT, supersededFile));
    const supersededSha = sha256(supersededBytes);
    assert.ok(SUPERSEDED_PLANS.includes(supersededSha));
    await assert.rejects(
      () =>
        validateWalletPlan({
          planBytes: supersededBytes,
          planSha256: supersededSha,
          address: CORRECTED_OWNER,
        }),
      /Superseded or historical plan/,
    );
  }

  // 直接使用真实冻结的 v6-wallet-4 计划核验承诺
  const wallet4Bytes = await readWalletPlanBytes('docs/evidence/v6-wallet-4-validation-plan.json');
  const wallet4Sha = sha256(wallet4Bytes);
  assert.equal(wallet4Sha, 'e65905d24990f7f1bc0fd20ae8b172d57c3290f7ae531b9711077205a46839d0');

  const verified = await validateWalletPlan({
    planBytes: wallet4Bytes,
    planSha256: wallet4Sha,
    address: CORRECTED_OWNER,
  });
  assert.equal(verified.executionRun, 'v6-wallet-4');
  assert.equal(verified.actorCommitment.actors.owner, CORRECTED_OWNER);
  assert.equal(verified.deploymentSourceCommitment.sha256, WALLET_DEPLOYMENT_SOURCE_SHA);

  const validPlanObj = JSON.parse(wallet4Bytes.toString('utf8'));
  for (const forbidden of SUPERSEDED_OWNERS) {
    const badOwnerPlan = {
      ...validPlanObj,
      actorCommitment: {
        ...validPlanObj.actorCommitment,
        actors: {
          ...validPlanObj.actorCommitment.actors,
          owner: forbidden,
        },
      },
    };
    const badBytes = Buffer.from(JSON.stringify(badOwnerPlan), 'utf8');
    await assert.rejects(
      () =>
        validateWalletPlan({
          planBytes: badBytes,
          planSha256: sha256(badBytes),
          address: forbidden,
        }),
      /Superseded or historical signer/,
    );
  }

  const tamperedCommitmentPlan = {
    ...validPlanObj,
    catalogCommitment: {
      ...validPlanObj.catalogCommitment,
      sha256: '0'.repeat(64),
    },
  };
  const tamperedBytes = Buffer.from(JSON.stringify(tamperedCommitmentPlan), 'utf8');
  await assert.rejects(
    () =>
      validateWalletPlan({
        planBytes: tamperedBytes,
        planSha256: sha256(tamperedBytes),
        address: CORRECTED_OWNER,
      }),
    /locked v6-wallet-4 frozen plan SHA-256/,
  );

  // 拒绝非历史但未获锁定的未知钱包地址
  assert.equal(LOCKED_WALLET_OWNER, CORRECTED_OWNER);
  assert.equal(LOCKED_WALLET_4_PLAN_SHA, wallet4Sha);
  await assert.rejects(
    () =>
      validateWalletPlan({
        planBytes: wallet4Bytes,
        planSha256: wallet4Sha,
        address: '0x1111111111111111111111111111111111111111',
      }),
    /locked v6-wallet-4 owner address/,
  );
});
