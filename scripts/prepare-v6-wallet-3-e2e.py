"""为用户授权的方案 A（compact_v2 部署工件 + 自控钱包）生成独立的 v6-wallet-3 离线执行计划。

严禁改动原中断计划、wallet-1 或 wallet-2 冻结文件及 0xfa5156... 链上回滚证据；
不发起 RPC、不连接钱包、不接触私钥、不调用模型、不签名、不发送链上交易。
--check-only 仅使用预览引用且不写盘；--prepare 使用 xb 独占写入一次并永久冻结。
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import re
import types

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "scripts/prepare-v6-e2e.py"
ENGINE_SHA = "2e9c2f1e233fd863f16d43ceedf92d31387a8c1ee086200229cb61693b09c0ca"

DEPLOYMENT_FILE = "contracts/research_receipt_v6_compact_v2.py"
DEPLOYMENT_SHA = "2af33b26424a8bc2399d71cdb6a2ccdbd53acb0e4fc06de1ede14bb7791e42e2"
BUILD_FILE = "artifacts/v6-compact-builds/20261107T060111.788983Z-2af33b26424a.json"
BUILD_FIXTURE_FILE = "tests/fixtures/v6-compact-v2-build.json"
BUILD_SHA = "82d83aa47a7ef4308a85fe30a497ee1b17c7f12d64a7b0bc42609ef608033f53"

OLD_PLAN = "docs/evidence/v6-validation-plan.json"
OLD_SHA = "c731fb736abc2bf2c70e48d5a72cd1e72195a0bc25aa50070d7a9a28564b506e"

WALLET_1_PLAN = "docs/evidence/v6-wallet-1-validation-plan.json"
WALLET_1_PLAN_SHA = "04dbef08dc757f7457808d04f320b8cade446ca507596388e9f275e830753f77"
WALLET_1_INPUT = "artifacts/bradbury/v6-wallet-1-e2e-input.json"
WALLET_1_PUBLIC_INPUT = "tests/fixtures/bradbury-v6-wallet-1-input.json"
WALLET_1_FIXTURE_SHA = "d724133edfb49301d6d37a317ae3b806c4a1b744c9d50586810eb4ed18e8050b"
WALLET_1_PLANNER = "scripts/prepare-v6-wallet-e2e.py"
WALLET_1_PLANNER_SHA = "94c134b4261b7f16a6fa623d22625c14572fc7f23ded209b503725b2fe377c3d"

WALLET_2_PLAN = "docs/evidence/v6-wallet-2-validation-plan.json"
WALLET_2_PLAN_SHA = "306f742ac1b8bbdb8c01f0125c565dafe2c059ff1627cc1ed4f62c5804924b89"
WALLET_2_INPUT = "artifacts/bradbury/v6-wallet-2-e2e-input.json"
WALLET_2_PUBLIC_INPUT = "tests/fixtures/bradbury-v6-wallet-2-input.json"
WALLET_2_FIXTURE_SHA = "518df208e7fc340a60383a0f7dc1fa1085d9e6283ed0ae8955ddf334ef763be3"
WALLET_2_PLANNER = "scripts/prepare-v6-wallet-2-e2e.py"
WALLET_2_PLANNER_SHA = "7425afdfd3be1dd99f04c5c1904761eb62e4c2d40428bb0f2c8ed88662218119"
WALLET_2_REVERT_EVIDENCE = "docs/evidence/v6-wallet-2-deployment-revert.json"
WALLET_2_REVERT_EVIDENCE_SHA = "2e568bbf60856e864fc78f9d799d1a78505933675c61f8c7daad4b52effb496d"
WALLET_2_SUPERSEDED_DEPLOYMENT_SHA = "e053f1b4250b6a0e7717722c54dfe97717a5d341b374d9404d7b5b2c057e1fcb"

CORRECTED_OWNER = "0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd"
DEAD = {
    "0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70",
    "0x7036138ada2052af0b07dae5a4d450effd9a40e3",
    "0xfdb942f537095d8e0c36b97a3b0324de81db9c3f",
}
INPUT = "artifacts/bradbury/v6-wallet-3-e2e-input.json"
PUBLIC_INPUT = "tests/fixtures/bradbury-v6-wallet-3-input.json"
PLAN = "docs/evidence/v6-wallet-3-validation-plan.json"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def verify_frozen_history():
    """核对离线 oracle 引擎、原始中断计划、wallet-1、wallet-2 及部署回滚证据未被篡改。"""
    assert sha(ENGINE.read_bytes()) == ENGINE_SHA, "Reviewed oracle engine changed"
    assert sha((ROOT / OLD_PLAN).read_bytes()) == OLD_SHA, "Interrupted frozen plan changed"
    assert sha((ROOT / WALLET_1_PLAN).read_bytes()) == WALLET_1_PLAN_SHA, "Frozen wallet-1 plan changed"
    assert sha((ROOT / WALLET_1_INPUT).read_bytes()) == WALLET_1_FIXTURE_SHA, "Frozen wallet-1 input changed"
    assert sha((ROOT / WALLET_1_PUBLIC_INPUT).read_bytes()) == WALLET_1_FIXTURE_SHA, "Frozen wallet-1 public fixture changed"
    assert sha((ROOT / WALLET_1_PLANNER).read_bytes()) == WALLET_1_PLANNER_SHA, "Frozen wallet-1 planner changed"
    assert sha((ROOT / WALLET_2_PLAN).read_bytes()) == WALLET_2_PLAN_SHA, "Frozen wallet-2 plan changed"
    assert sha((ROOT / WALLET_2_INPUT).read_bytes()) == WALLET_2_FIXTURE_SHA, "Frozen wallet-2 input changed"
    assert sha((ROOT / WALLET_2_PUBLIC_INPUT).read_bytes()) == WALLET_2_FIXTURE_SHA, "Frozen wallet-2 public fixture changed"
    assert sha((ROOT / WALLET_2_PLANNER).read_bytes()) == WALLET_2_PLANNER_SHA, "Frozen wallet-2 planner changed"
    assert sha((ROOT / WALLET_2_REVERT_EVIDENCE).read_bytes()) == WALLET_2_REVERT_EVIDENCE_SHA, "Frozen wallet-2 revert evidence changed"
    assert sha((ROOT / DEPLOYMENT_FILE).read_bytes()) == DEPLOYMENT_SHA, "Frozen compact_v2 deployment source changed"
    assert sha((ROOT / BUILD_FILE).read_bytes()) == BUILD_SHA, "Frozen compact_v2 build report changed"
    assert sha((ROOT / BUILD_FIXTURE_FILE).read_bytes()) == BUILD_SHA, "Frozen compact_v2 build fixture changed"


def load_engine_for_compact_v2():
    """在不修改磁盘上 prepare-v6-e2e.py 的前提下，将内存 AST 中的 v1 构建键断言适配为 v2 诚实断言。"""
    engine_bytes = ENGINE.read_bytes()
    assert sha(engine_bytes) == ENGINE_SHA
    tree = ast.parse(engine_bytes.decode("utf-8"), filename=str(ENGINE))
    v1_keys = (
        "full_ast_type_comments_equal",
        "ordered_str_bytes_values_and_utf8_bytes_equal",
        "runner_first_two_lines_bytes_identical",
    )
    v2_keys = (
        "alpha_normalized_ast_type_comments_equal",
        "ordered_non_docstring_str_bytes_values_and_utf8_bytes_equal",
        "module_and_class_surface_identical",
        "runner_first_two_lines_bytes_identical",
    )
    replaced = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Tuple) and [
            elt.value for elt in node.elts if isinstance(elt, ast.Constant)
        ] == list(v1_keys):
            node.elts = [ast.Constant(value=key) for key in v2_keys]
            replaced += 1
    assert replaced == 1, f"Expected exact 1 v1 build-key tuple in engine, found {replaced}"
    ast.fix_missing_locations(tree)
    module = types.ModuleType("rr_wallet_3_oracle_engine")
    module.__file__ = str(ENGINE)
    exec(compile(tree, str(ENGINE), "exec"), module.__dict__)
    return module


def build(owner=CORRECTED_OWNER, prepare=False):
    if (
        not isinstance(owner, str)
        or not re.fullmatch(r"0x[0-9a-fA-F]{40}", owner)
        or int(owner[2:], 16) == 0
        or owner.lower() in DEAD
    ):
        raise ValueError("A nonzero user-controlled public wallet address is required; unavailable or superseded signers are forbidden")
    if prepare and owner.lower() != CORRECTED_OWNER:
        raise ValueError("--prepare is locked to the user-corrected public wallet address")
    verify_frozen_history()

    build_report = json.loads((ROOT / BUILD_FILE).read_text(encoding="utf-8"))
    assert build_report["algorithm"] == "python-ast-local-alpha-docstring-strip-minimal-whitespace/2"
    assert build_report["full_ast_type_comments_equal"] is False
    assert build_report["ordered_str_bytes_values_and_utf8_bytes_equal"] is False
    assert build_report["alpha_normalized_ast_type_comments_equal"] is True
    assert build_report["ordered_non_docstring_str_bytes_values_and_utf8_bytes_equal"] is True
    assert build_report["module_and_class_surface_identical"] is True
    assert build_report["runner_first_two_lines_bytes_identical"] is True

    engine = load_engine_for_compact_v2()
    actors = {
        "owner": owner.lower(),
        "author": "0x6a1f0a11003b197f192961b006a9e6534b447f75",
        "outsider": "0x2d13e8caee0a0fdff8cf45026c563843826a18b7",
    }
    if len(set(actors.values())) != 3:
        raise ValueError("Owner must differ from the fixed nonsigning counterexample addresses")

    engine.public_actors = lambda: dict(actors)
    engine.DEPLOYMENT_FILE = DEPLOYMENT_FILE
    engine.DEPLOYMENT_SHA = DEPLOYMENT_SHA
    engine.BUILD_FILE = BUILD_FILE
    engine.BUILD_SHA = BUILD_SHA
    engine.INPUT_FILE, engine.TEST_INPUT_FILE, engine.PLAN_FILE = INPUT, PUBLIC_INPUT, PLAN

    fixture, serialized, plan = engine.build_plan(prepare)
    assert plan["plannerSha256"] == ENGINE_SHA
    assert plan["deploymentSourceCommitment"]["file"] == DEPLOYMENT_FILE
    assert plan["deploymentSourceCommitment"]["sha256"] == DEPLOYMENT_SHA
    assert plan["buildCommitment"]["sha256"] == BUILD_SHA

    plan["executionAuthority"] = "user-controlled-wallet"
    plan["walletControlVerifiedByPlanner"] = False
    plan["executionRun"] = "v6-wallet-3"
    plan["walletPlannerCommitment"] = {
        "file": "scripts/prepare-v6-wallet-3-e2e.py",
        "sha256": sha(Path(__file__).read_bytes()),
    }
    plan["supersedesExecutionPlan"] = {
        "file": OLD_PLAN,
        "sha256": OLD_SHA,
        "reason": "IN_MEMORY_SIGNERS_UNAVAILABLE_USER_WALLET_SELECTED",
        "priorPlanAltered": False,
    }
    plan["supersedesWallet1Plan"] = {
        "file": WALLET_1_PLAN,
        "sha256": WALLET_1_PLAN_SHA,
        "fixtureFile": WALLET_1_INPUT,
        "publicFixtureFile": WALLET_1_PUBLIC_INPUT,
        "fixtureSha256": WALLET_1_FIXTURE_SHA,
        "plannerFile": WALLET_1_PLANNER,
        "plannerSha256": WALLET_1_PLANNER_SHA,
        "supersededOwner": "0xfdb942f537095d8e0c36b97a3b0324de81db9c3f",
        "reason": "USER_CORRECTED_WALLET_ADDRESS_BEFORE_DEPLOYMENT",
        "priorWalletPlanAltered": False,
    }
    plan["supersedesWallet2Plan"] = {
        "file": WALLET_2_PLAN,
        "sha256": WALLET_2_PLAN_SHA,
        "fixtureFile": WALLET_2_INPUT,
        "publicFixtureFile": WALLET_2_PUBLIC_INPUT,
        "fixtureSha256": WALLET_2_FIXTURE_SHA,
        "plannerFile": WALLET_2_PLANNER,
        "plannerSha256": WALLET_2_PLANNER_SHA,
        "revertedDeploymentEvidenceFile": WALLET_2_REVERT_EVIDENCE,
        "revertedDeploymentEvidenceSha256": WALLET_2_REVERT_EVIDENCE_SHA,
        "revertedEnvelopeHash": "0xfa51562ff02e0e19346723c3ba2687654b2c4682d86d28104851c62b7db6ba23",
        "supersededDeploymentSourceSha256": WALLET_2_SUPERSEDED_DEPLOYMENT_SHA,
        "reason": "BRADBURY_L2_32M_MAX_TX_GAS_LIMIT_EXCEEDED_BY_43437B_V1_COMPACT_USER_AUTHORIZED_V2_COMPACT",
        "priorWalletPlanAltered": False,
    }
    plan["actorCommitment"]["source"] = (
        "User-corrected public wallet owner; author and outsider are nonsigning public counterexamples. "
        "No private keys, old session authority, or superseded wallet-1/wallet-2 JSON mutation used."
    )
    plan["actorCommitment"]["signingAuthority"] = "User confirms every EIP-1193 transaction in their own wallet"
    plan["gates"][1] = (
        "Preserve all recorded transport and L2 32,000,000-gas revert evidence (0xfa5156...). "
        "A separately reviewed user-wallet transport for compact_v2 (2af33b26424a...) may proceed only "
        "when the exact deployment request passes BOTH a fresh fixed-block eth_estimateGas <= 32000000 "
        "and a fresh fixed-block eth_call at gas <= 32000000 (verified against Bradbury ArbGasInfo.maxTxGasLimit), "
        "with total protocol value plus maximum envelope gas at most 0.05 test GEN, complete "
        "network/source/fee/account/nonce checks, explicit user confirmation for one deployment, and durable "
        "uncertain-send recovery without automatic retry. No business oracle or accepted-consensus requirement is relaxed."
    )
    plan["walletTransportEvidence"] = [
        {"file": file, "sha256": sha((ROOT / file).read_bytes())}
        for file in (
            "docs/evidence/v6-transport-observations.json",
            "docs/evidence/v6-session-interruption.json",
            WALLET_2_REVERT_EVIDENCE,
        )
    ]
    plan["migration"].append(
        "A separate v6-wallet-3 execution run follows user authorization of Option A after the 43,437-byte "
        "v1 compact deployment envelope (0xfa5156...) reverted at Bradbury L2's 32,000,000 per-tx gas cap. "
        "compact_v2 (35,916 bytes) preserves 100% of V6 business logic, prompts, module/class surface, and "
        "non-docstring constants under lexical-scope alpha-normalized AST equivalence; fresh UUID references "
        "and commitments are recomputed offline without mutating v6-wallet-2 artifacts."
    )
    assert len(plan["cases"]) == 51 and len(plan["expected"]) == 10
    assert sum(1 for c in plan["cases"] if c["expectedTransaction"]["executionResult"] == "RETURN") == 40
    assert sum(1 for c in plan["cases"] if c["expectedTransaction"]["executionResult"] == "ERROR") == 11
    assert plan["firstGate"]["caseSequences"] == list(range(1, 14))
    assert plan["actorCommitment"]["actors"]["owner"] == owner.lower()
    verify_frozen_history()
    return fixture, serialized, plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check-only", action="store_true")
    mode.add_argument("--prepare", action="store_true")
    parser.add_argument("--owner", default=CORRECTED_OWNER)
    parser.add_argument("--reviewed-source-sha")
    args = parser.parse_args()
    if args.prepare and args.reviewed_source_sha != DEPLOYMENT_SHA:
        parser.error("--prepare requires explicitly reviewed actual compact_v2 deployment source SHA")
    paths = [ROOT / file for file in (INPUT, PUBLIC_INPUT, PLAN)]
    if args.prepare and any(path.exists() for path in paths):
        raise SystemExit("Refuse to overwrite an existing wallet-3 run; never resample its references")
    _, serialized, plan = build(args.owner, args.prepare)
    plan_bytes = (json.dumps(plan, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if args.prepare:
        for path, raw in zip(paths, [serialized, serialized, plan_bytes]):
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("xb") as stream:
                stream.write(raw)
    print(
        json.dumps(
            {
                "prepared": args.prepare,
                "previewOnly": not args.prepare,
                "executionRun": "v6-wallet-3",
                "owner": args.owner.lower(),
                "deploymentSourceSha256": DEPLOYMENT_SHA,
                "fixtureSha256": sha(serialized),
                "planSha256": sha(plan_bytes),
                "planFile": PLAN if args.prepare else None,
                "cases": 51,
                "oldPlanUnchanged": True,
                "wallet1PlanUnchanged": True,
                "wallet2PlanUnchanged": True,
                "networkRequests": 0,
                "modelCalls": 0,
                "signatures": 0,
                "chainWrites": 0,
            }
        )
    )


if __name__ == "__main__":
    main()
