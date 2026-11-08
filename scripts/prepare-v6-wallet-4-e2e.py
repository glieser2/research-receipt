"""为用户确认的子 VM 异常捕获加固方案（v6_r2_candidate / compact_v3 + 自控钱包）生成独立的 v6-wallet-4 离线执行计划。

严禁改动原中断计划、wallet-1、wallet-2、wallet-3 冻结文件及 0xfa5156... / 0x39b4178d... 链上历史证据；
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

ORIGINAL_V6_CANONICAL_FILE = "contracts/research_receipt_v6_candidate.py"
ORIGINAL_V6_CANONICAL_SHA = "9cff3a90a45daee031bf3fb893857bcb53cb07bc6501b86fecc955ce021b4a19"

CANONICAL_FILE = "contracts/research_receipt_v6_r2_candidate.py"
CANONICAL_SHA = "ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f"
DEPLOYMENT_FILE = "contracts/research_receipt_v6_compact_v3.py"
DEPLOYMENT_SHA = "5e4837ee9dba47577c728c732391721e7e7bac45c0d1674084420c271f2476cf"
BUILD_FILE = "artifacts/v6-compact-builds/20261107T150051.734265Z-5e4837ee9dba.json"
BUILD_FIXTURE_FILE = "tests/fixtures/v6-compact-v3-build.json"
BUILD_SHA = "696ba95d81c928517df4554558da6b672ba6351d1b51bf0562915c2cc5557cb8"

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

WALLET_3_PLAN = "docs/evidence/v6-wallet-3-validation-plan.json"
WALLET_3_PLAN_SHA = "76c2583b393255b241e670e5ba418a7517003d56afdfd1316f0c5c746c8a1b1a"
WALLET_3_INPUT = "artifacts/bradbury/v6-wallet-3-e2e-input.json"
WALLET_3_PUBLIC_INPUT = "tests/fixtures/bradbury-v6-wallet-3-input.json"
WALLET_3_FIXTURE_SHA = "b779bbf58577b7eec6a57443e8de794d287f571400d8e033146c187121afe8c0"
WALLET_3_PLANNER = "scripts/prepare-v6-wallet-3-e2e.py"
WALLET_3_PLANNER_SHA = "1bd313b59fd919a4ede3ff535ec3765e5c1cacebad6fa3ff645d6a64d33a703c"
WALLET_3_SUPERSEDED_DEPLOYMENT_FILE = "contracts/research_receipt_v6_compact_v2.py"
WALLET_3_SUPERSEDED_DEPLOYMENT_SHA = "2af33b26424a8bc2399d71cdb6a2ccdbd53acb0e4fc06de1ede14bb7791e42e2"
WALLET_3_BUILD_FILE = "artifacts/v6-compact-builds/20261107T060111.788983Z-2af33b26424a.json"
WALLET_3_BUILD_FIXTURE_FILE = "tests/fixtures/v6-compact-v2-build.json"
WALLET_3_BUILD_SHA = "82d83aa47a7ef4308a85fe30a497ee1b17c7f12d64a7b0bc42609ef608033f53"
WALLET_3_ATTEMPT_EVIDENCE = "docs/evidence/bradbury-v6-wallet-3-attempt.json"
WALLET_3_ATTEMPT_EVIDENCE_SHA = "86367e7adf8d92db20725069697077063622cc2c93854d1e28f1913135b14e00"
WALLET_3_HALTED_CONTRACT = "0xc7d9a5e9fa776f76b1348c7009ea23de6d873885"
WALLET_3_HALTED_TX_ID = "0x39b4178dff177c52a319270efafe9618d944606421c30210e53a38c0d52b80a9"
WALLET_3_HALTED_SEQUENCE = 47

CORRECTED_OWNER = "0x5d89aa5eaa6dc6734ded7ebe060f4b8682c504bd"
DEAD = {
    "0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70",
    "0x7036138ada2052af0b07dae5a4d450effd9a40e3",
    "0xfdb942f537095d8e0c36b97a3b0324de81db9c3f",
}
INPUT = "artifacts/bradbury/v6-wallet-4-e2e-input.json"
PUBLIC_INPUT = "tests/fixtures/bradbury-v6-wallet-4-input.json"
PLAN = "docs/evidence/v6-wallet-4-validation-plan.json"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def verify_frozen_history():
    """核对离线 oracle 引擎、原始 V6 源码、原始中断计划、wallet-1、wallet-2、wallet-3 及所有链上历史证据未被篡改。"""
    assert sha(ENGINE.read_bytes()) == ENGINE_SHA, "Reviewed oracle engine changed"
    assert sha((ROOT / ORIGINAL_V6_CANONICAL_FILE).read_bytes()) == ORIGINAL_V6_CANONICAL_SHA, "Frozen V6 canonical source changed"
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
    assert sha((ROOT / WALLET_3_PLAN).read_bytes()) == WALLET_3_PLAN_SHA, "Frozen wallet-3 plan changed"
    assert sha((ROOT / WALLET_3_INPUT).read_bytes()) == WALLET_3_FIXTURE_SHA, "Frozen wallet-3 input changed"
    assert sha((ROOT / WALLET_3_PUBLIC_INPUT).read_bytes()) == WALLET_3_FIXTURE_SHA, "Frozen wallet-3 public fixture changed"
    assert sha((ROOT / WALLET_3_PLANNER).read_bytes()) == WALLET_3_PLANNER_SHA, "Frozen wallet-3 planner changed"
    assert sha((ROOT / WALLET_3_SUPERSEDED_DEPLOYMENT_FILE).read_bytes()) == WALLET_3_SUPERSEDED_DEPLOYMENT_SHA, "Frozen compact_v2 deployment source changed"
    assert sha((ROOT / WALLET_3_BUILD_FILE).read_bytes()) == WALLET_3_BUILD_SHA, "Frozen compact_v2 build report changed"
    assert sha((ROOT / WALLET_3_BUILD_FIXTURE_FILE).read_bytes()) == WALLET_3_BUILD_SHA, "Frozen compact_v2 build fixture changed"
    assert sha((ROOT / WALLET_3_ATTEMPT_EVIDENCE).read_bytes()) == WALLET_3_ATTEMPT_EVIDENCE_SHA, "Frozen wallet-3 attempt evidence changed"
    assert sha((ROOT / CANONICAL_FILE).read_bytes()) == CANONICAL_SHA, "Hardened v6_r2_candidate canonical source changed"
    assert sha((ROOT / DEPLOYMENT_FILE).read_bytes()) == DEPLOYMENT_SHA, "Frozen compact_v3 deployment source changed"
    assert sha((ROOT / BUILD_FILE).read_bytes()) == BUILD_SHA, "Frozen compact_v3 build report changed"
    assert sha((ROOT / BUILD_FIXTURE_FILE).read_bytes()) == BUILD_SHA, "Frozen compact_v3 build fixture changed"


def load_engine_for_compact_v3():
    """在不修改磁盘上 prepare-v6-e2e.py 的前提下，将内存 AST 中的 v1 构建键断言适配为 v2/v3 诚实断言。"""
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
    module = types.ModuleType("rr_wallet_4_oracle_engine")
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
    assert build_report["verification"]["exit_code"] == 0

    engine = load_engine_for_compact_v3()
    actors = {
        "owner": owner.lower(),
        "author": "0x6a1f0a11003b197f192961b006a9e6534b447f75",
        "outsider": "0x2d13e8caee0a0fdff8cf45026c563843826a18b7",
    }
    if len(set(actors.values())) != 3:
        raise ValueError("Owner must differ from the fixed nonsigning counterexample addresses")

    engine.public_actors = lambda: dict(actors)
    engine.CANONICAL_FILE = CANONICAL_FILE
    engine.CANONICAL_SHA = CANONICAL_SHA
    engine.DEPLOYMENT_FILE = DEPLOYMENT_FILE
    engine.DEPLOYMENT_SHA = DEPLOYMENT_SHA
    engine.BUILD_FILE = BUILD_FILE
    engine.BUILD_SHA = BUILD_SHA
    engine.INPUT_FILE, engine.TEST_INPUT_FILE, engine.PLAN_FILE = INPUT, PUBLIC_INPUT, PLAN

    fixture, serialized, plan = engine.build_plan(prepare)
    assert plan["plannerSha256"] == ENGINE_SHA
    assert plan["sourceCommitment"]["file"] == CANONICAL_FILE
    assert plan["sourceCommitment"]["sha256"] == CANONICAL_SHA
    assert plan["deploymentSourceCommitment"]["file"] == DEPLOYMENT_FILE
    assert plan["deploymentSourceCommitment"]["sha256"] == DEPLOYMENT_SHA
    assert plan["buildCommitment"]["sha256"] == BUILD_SHA

    plan["executionAuthority"] = "user-controlled-wallet"
    plan["walletControlVerifiedByPlanner"] = False
    plan["executionRun"] = "v6-wallet-4"
    plan["originalV6CanonicalCommitment"] = {
        "file": ORIGINAL_V6_CANONICAL_FILE,
        "sha256": ORIGINAL_V6_CANONICAL_SHA,
        "priorCanonicalSourceAltered": False,
    }
    plan["walletPlannerCommitment"] = {
        "file": "scripts/prepare-v6-wallet-4-e2e.py",
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
    plan["supersedesWallet3Plan"] = {
        "file": WALLET_3_PLAN,
        "sha256": WALLET_3_PLAN_SHA,
        "fixtureFile": WALLET_3_INPUT,
        "publicFixtureFile": WALLET_3_PUBLIC_INPUT,
        "fixtureSha256": WALLET_3_FIXTURE_SHA,
        "plannerFile": WALLET_3_PLANNER,
        "plannerSha256": WALLET_3_PLANNER_SHA,
        "supersededDeploymentFile": WALLET_3_SUPERSEDED_DEPLOYMENT_FILE,
        "supersededDeploymentSourceSha256": WALLET_3_SUPERSEDED_DEPLOYMENT_SHA,
        "supersededBuildFile": WALLET_3_BUILD_FILE,
        "supersededBuildSha256": WALLET_3_BUILD_SHA,
        "attemptEvidenceFile": WALLET_3_ATTEMPT_EVIDENCE,
        "attemptEvidenceSha256": WALLET_3_ATTEMPT_EVIDENCE_SHA,
        "supersededContractAddress": WALLET_3_HALTED_CONTRACT,
        "passedCaseCount": 46,
        "haltedCaseSequence": WALLET_3_HALTED_SEQUENCE,
        "haltedCaseName": "evaluateOptionalOmitted",
        "haltedProtocolTxId": WALLET_3_HALTED_TX_ID,
        "reason": "CASE_47_UNGUARDED_EXEC_PROMPT_SUBVM_EXIT_CODE_1_UNDETERMINED_USER_AUTHORIZED_COMPACT_V3_HARDENING",
        "priorWalletPlanAltered": False,
    }
    plan["actorCommitment"]["source"] = (
        "User-corrected public wallet owner; author and outsider are nonsigning public counterexamples. "
        "No private keys, old session authority, or superseded wallet-1/wallet-2/wallet-3 JSON mutation used."
    )
    plan["actorCommitment"]["signingAuthority"] = "User confirms every EIP-1193 transaction in their own wallet"
    plan["gates"][1] = (
        "Preserve all recorded transport, L2 32,000,000-gas revert (0xfa5156...), and v6-wallet-3 Case #47 "
        "sub-VM exit_code 1 undetermined (0x39b4178d...) evidence. A separately reviewed user-wallet transport "
        "for compact_v3 (5e4837ee9dba...) may proceed only when the exact deployment request passes BOTH a fresh "
        "fixed-block eth_estimateGas <= 32000000 and a fresh fixed-block eth_call at gas <= 32000000 (verified "
        "against Bradbury ArbGasInfo.maxTxGasLimit), with total protocol value plus maximum envelope gas at most "
        "0.05 test GEN, complete network/source/fee/account/nonce checks, explicit user confirmation for one "
        "deployment, and durable uncertain-send recovery without automatic retry. No business oracle or "
        "accepted-consensus requirement is relaxed."
    )
    plan["walletTransportEvidence"] = [
        {"file": file, "sha256": sha((ROOT / file).read_bytes())}
        for file in (
            "docs/evidence/v6-transport-observations.json",
            "docs/evidence/v6-session-interruption.json",
            WALLET_2_REVERT_EVIDENCE,
            WALLET_3_ATTEMPT_EVIDENCE,
        )
    ]
    plan["migration"].append(
        "A separate v6-wallet-4 execution run follows user authorization after v6-wallet-3 passed 46/51 cases "
        "and halted at Case #47 (evaluateOptionalOmitted, 0x39b4178d...) with FINALIZED + FINISHED_WITH_ERROR + "
        "MAJORITY_DISAGREE (undetermined) caused by an unguarded gl.nondet.exec_prompt sub-VM exit_code 1. "
        "v6_r2_candidate and compact_v3 (36,128 bytes) wrap gl.nondet.exec_prompt + decode_model_finding in "
        "independent_assessment so non-UserError exceptions consume at most the existing 1-call global format-repair "
        "budget and convert repeated failures into UserError without altering any V6 prompt, schema, verdict rule, "
        "method surface, or fail(...) literal; fresh UUID references and commitments are recomputed offline without "
        "mutating v6-wallet-3 artifacts."
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
        parser.error("--prepare requires explicitly reviewed actual compact_v3 deployment source SHA")
    paths = [ROOT / file for file in (INPUT, PUBLIC_INPUT, PLAN)]
    if args.prepare and any(path.exists() for path in paths):
        raise SystemExit("Refuse to overwrite an existing wallet-4 run; never resample its references")
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
                "executionRun": "v6-wallet-4",
                "owner": args.owner.lower(),
                "canonicalSourceSha256": CANONICAL_SHA,
                "deploymentSourceSha256": DEPLOYMENT_SHA,
                "fixtureSha256": sha(serialized),
                "planSha256": sha(plan_bytes),
                "planFile": PLAN if args.prepare else None,
                "cases": 51,
                "oldPlanUnchanged": True,
                "wallet1PlanUnchanged": True,
                "wallet2PlanUnchanged": True,
                "wallet3PlanUnchanged": True,
                "networkRequests": 0,
                "modelCalls": 0,
                "signatures": 0,
                "chainWrites": 0,
            }
        )
    )


if __name__ == "__main__":
    main()
