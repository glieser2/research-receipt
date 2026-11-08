"""为纠正后的用户自控钱包生成独立的 v6-wallet-2 离线执行计划；严禁修改旧计划或 wallet-1 冻结产物。

不发起 RPC、不连接钱包、不接触私钥、不调用模型、不签名、不发送链上交易。
复用经审阅的离线 oracle 引擎，绑定纠正后的公开地址与独立输出路径；
--check-only 仅使用预览引用且不写盘，--prepare 使用 wx 独占写入一次并永久冻结。
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "scripts/prepare-v6-e2e.py"
ENGINE_SHA = "2e9c2f1e233fd863f16d43ceedf92d31387a8c1ee086200229cb61693b09c0ca"
DEPLOYMENT_SHA = "e053f1b4250b6a0e7717722c54dfe97717a5d341b374d9404d7b5b2c057e1fcb"
OLD_PLAN = "docs/evidence/v6-validation-plan.json"
OLD_SHA = "c731fb736abc2bf2c70e48d5a72cd1e72195a0bc25aa50070d7a9a28564b506e"
WALLET_1_PLAN = "docs/evidence/v6-wallet-1-validation-plan.json"
WALLET_1_PLAN_SHA = "04dbef08dc757f7457808d04f320b8cade446ca507596388e9f275e830753f77"
WALLET_1_INPUT = "artifacts/bradbury/v6-wallet-1-e2e-input.json"
WALLET_1_PUBLIC_INPUT = "tests/fixtures/bradbury-v6-wallet-1-input.json"
WALLET_1_FIXTURE_SHA = "d724133edfb49301d6d37a317ae3b806c4a1b744c9d50586810eb4ed18e8050b"
WALLET_1_PLANNER = "scripts/prepare-v6-wallet-e2e.py"
WALLET_1_PLANNER_SHA = "94c134b4261b7f16a6fa623d22625c14572fc7f23ded209b503725b2fe377c3d"

CORRECTED_OWNER = "0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd"
DEAD = {
    "0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70",
    "0x7036138ada2052af0b07dae5a4d450effd9a40e3",
    "0xfdb942f537095d8e0c36b97a3b0324de81db9c3f",
}
INPUT = "artifacts/bradbury/v6-wallet-2-e2e-input.json"
PUBLIC_INPUT = "tests/fixtures/bradbury-v6-wallet-2-input.json"
PLAN = "docs/evidence/v6-wallet-2-validation-plan.json"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def verify_frozen_history():
    # 核对离线 oracle 引擎、原始中断计划以及 wallet-1 冻结历史文件未被篡改
    assert sha(ENGINE.read_bytes()) == ENGINE_SHA, "Reviewed oracle engine changed"
    assert sha((ROOT / OLD_PLAN).read_bytes()) == OLD_SHA, "Interrupted frozen plan changed"
    assert sha((ROOT / WALLET_1_PLAN).read_bytes()) == WALLET_1_PLAN_SHA, "Frozen wallet-1 plan changed"
    assert sha((ROOT / WALLET_1_INPUT).read_bytes()) == WALLET_1_FIXTURE_SHA, "Frozen wallet-1 input changed"
    assert sha((ROOT / WALLET_1_PUBLIC_INPUT).read_bytes()) == WALLET_1_FIXTURE_SHA, "Frozen wallet-1 public fixture changed"
    assert sha((ROOT / WALLET_1_PLANNER).read_bytes()) == WALLET_1_PLANNER_SHA, "Frozen wallet-1 planner changed"


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
    spec = importlib.util.spec_from_file_location("rr_wallet_2_oracle_engine", ENGINE)
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    # 其余两个公开地址仅作为只读反例角色，不参与任何交易签名
    actors = {
        "owner": owner.lower(),
        "author": "0x6a1f0a11003b197f192961b006a9e6534b447f75",
        "outsider": "0x2d13e8caee0a0fdff8cf45026c563843826a18b7",
    }
    if len(set(actors.values())) != 3:
        raise ValueError("Owner must differ from the fixed nonsigning counterexample addresses")
    engine.public_actors = lambda: dict(actors)
    engine.INPUT_FILE, engine.TEST_INPUT_FILE, engine.PLAN_FILE = INPUT, PUBLIC_INPUT, PLAN
    fixture, serialized, plan = engine.build_plan(prepare)
    assert plan["plannerSha256"] == ENGINE_SHA
    assert plan["deploymentSourceCommitment"]["sha256"] == DEPLOYMENT_SHA
    plan["executionAuthority"] = "user-controlled-wallet"
    plan["walletControlVerifiedByPlanner"] = False
    plan["executionRun"] = "v6-wallet-2"
    plan["walletPlannerCommitment"] = {
        "file": "scripts/prepare-v6-wallet-2-e2e.py",
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
    plan["actorCommitment"]["source"] = (
        "User-corrected public wallet owner; author and outsider are nonsigning public counterexamples. "
        "No private keys, old session authority, or superseded wallet-1 owner replacement used."
    )
    plan["actorCommitment"]["signingAuthority"] = "User confirms every EIP-1193 transaction in their own wallet"
    plan["gates"][1] = (
        "Preserve the recorded default gas-estimation failures. A separately reviewed user-wallet transport "
        "may proceed only with the exact deployment request passing a fresh fixed-block eth_call, gas limited "
        "to 100000000, total protocol value plus maximum envelope gas at most 0.05 test GEN, complete "
        "network/source/fee/account/nonce checks, explicit user confirmation for one deployment, and durable "
        "uncertain-send recovery without automatic retry. This replaces only the interrupted run's "
        "default-estimate transport gate, not any business oracle or accepted-consensus requirement."
    )
    plan["walletTransportEvidence"] = [
        {"file": file, "sha256": sha((ROOT / file).read_bytes())}
        for file in ("docs/evidence/v6-transport-observations.json", "docs/evidence/v6-session-interruption.json")
    ]
    plan["migration"].append(
        "A separate v6-wallet-2 execution run follows user correction of the public wallet address prior to deployment. "
        "All 51 signing roles use the corrected user-controlled wallet; fresh references and dependent commitments "
        "are recomputed offline from the oracle engine rather than mutating v6-wallet-1 JSON files."
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
        parser.error("--prepare requires explicitly reviewed actual deployment source")
    paths = [ROOT / file for file in (INPUT, PUBLIC_INPUT, PLAN)]
    if args.prepare and any(path.exists() for path in paths):
        raise SystemExit("Refuse to overwrite an existing wallet-2 run; never resample its references")
    _, serialized, plan = build(args.owner, args.prepare)
    plan_bytes = (json.dumps(plan, ensure_ascii=False, indent=2) + "\n").encode()
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
                "executionRun": "v6-wallet-2",
                "owner": args.owner.lower(),
                "fixtureSha256": sha(serialized),
                "planSha256": sha(plan_bytes),
                "planFile": PLAN if args.prepare else None,
                "cases": 51,
                "oldPlanUnchanged": True,
                "wallet1PlanUnchanged": True,
                "networkRequests": 0,
                "modelCalls": 0,
                "signatures": 0,
                "chainWrites": 0,
            }
        )
    )


if __name__ == "__main__":
    main()
