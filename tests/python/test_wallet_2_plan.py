"""验证 v6-wallet-2 独立离线执行计划：保留 51 项业务预期与前 13 项硬 gate，拒绝旧地址与 wallet-1 地址，且不改动历史冻结文件。"""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("wallet_2_plan", ROOT / "scripts/prepare-v6-wallet-2-e2e.py")
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


class Wallet2PlanTest(unittest.TestCase):
    def test_unavailable_superseded_or_invalid_owners_rejected(self):
        # 拒绝空值、零地址、旧内存签名者、wallet-1 错误地址 fdb9 以及反例角色地址
        for owner in [
            None,
            "0x",
            "0x" + "0" * 40,
            *planner.DEAD,
            "0x6a1f0a11003b197f192961b006a9e6534b447f75",
            "0x2d13e8caee0a0fdff8cf45026c563843826a18b7",
        ]:
            with self.subTest(owner=owner), self.assertRaises(ValueError):
                planner.build(owner)

        # --prepare 仅允许用户纠正后的真实公开地址
        with self.assertRaises(ValueError):
            planner.build("0x1111111111111111111111111111111111111111", prepare=True)

    def test_corrected_wallet_recomputes_all_51_cases_without_altering_frozen_history(self):
        old_bytes = (ROOT / planner.OLD_PLAN).read_bytes()
        wallet1_plan_bytes = (ROOT / planner.WALLET_1_PLAN).read_bytes()
        wallet1_input_bytes = (ROOT / planner.WALLET_1_INPUT).read_bytes()
        old = json.loads(old_bytes)
        wallet1 = json.loads(wallet1_plan_bytes)

        fixture, _, plan = planner.build(planner.CORRECTED_OWNER, prepare=False)

        # 确认历史冻结文件字节级未变
        self.assertEqual((ROOT / planner.OLD_PLAN).read_bytes(), old_bytes)
        self.assertEqual((ROOT / planner.WALLET_1_PLAN).read_bytes(), wallet1_plan_bytes)
        self.assertEqual((ROOT / planner.WALLET_1_INPUT).read_bytes(), wallet1_input_bytes)

        # 核对元数据与执行身份
        self.assertEqual(plan["executionAuthority"], "user-controlled-wallet")
        self.assertEqual(plan["executionRun"], "v6-wallet-2")
        self.assertEqual(plan["actorCommitment"]["actors"]["owner"], planner.CORRECTED_OWNER)
        self.assertEqual(plan["supersedesWallet1Plan"]["sha256"], planner.WALLET_1_PLAN_SHA)
        self.assertEqual(
            plan["supersedesWallet1Plan"]["supersededOwner"],
            "0xfdb942f537095d8e0c36b97a3b0324de81db9c3f",
        )
        self.assertEqual(plan["firstGate"]["caseSequences"], list(range(1, 14)))
        self.assertEqual(plan["requiredSignedCaseCount"], 51)
        self.assertEqual(plan["chainWritesPerformedByPlanner"], 0)

        # 核对全部 51 项（40 RETURN、11 ERROR）及前 13 项硬 gate 与原计划严格一致
        self.assertEqual([x["name"] for x in plan["cases"]], [x["name"] for x in old["cases"]])
        self.assertEqual(
            sum(1 for x in plan["cases"] if x["expectedTransaction"]["executionResult"] == "RETURN"),
            40,
        )
        self.assertEqual(
            sum(1 for x in plan["cases"] if x["expectedTransaction"]["executionResult"] == "ERROR"),
            11,
        )
        self.assertEqual(
            sum(1 for x in plan["cases"][:13] if x.get("phase") == "firstGate"),
            13,
        )
        for actual, previous, w1 in zip(plan["cases"], old["cases"], wallet1["cases"]):
            self.assertEqual(actual["expectedTransaction"], previous["expectedTransaction"])
            self.assertEqual(actual["expectedError"], previous["expectedError"])
            self.assertEqual(
                actual["modelCallsPerIndependentExecution"],
                previous["modelCallsPerIndependentExecution"],
            )
            self.assertEqual(actual["role"], "owner")
            self.assertEqual(actual.get("phase"), w1.get("phase"))

        # 核对 10 项预期快照与评估：findings/verdict 保持不变，但绑定新钱包的 specHash/snapshot_hash 重新计算且不同于旧计划和 wallet-1
        for actual, previous, w1 in zip(plan["expected"], old["expected"], wallet1["expected"]):
            self.assertEqual(
                actual["assessment"]["projection"]["findings"],
                previous["assessment"]["projection"]["findings"],
            )
            self.assertEqual(
                actual["assessment"]["projection"]["verdict"],
                previous["assessment"]["projection"]["verdict"],
            )
            self.assertNotEqual(actual["specHash"], previous["specHash"])
            self.assertNotEqual(actual["specHash"], w1["specHash"])
            self.assertNotEqual(
                actual["snapshot"]["snapshot_hash"],
                previous["snapshot"]["snapshot_hash"],
            )
            self.assertNotEqual(
                actual["snapshot"]["snapshot_hash"],
                w1["snapshot"]["snapshot_hash"],
            )

        # 核对 fixture 中所有订单的 author 绑定（除 authorOtherSpec 外均为新钱包地址）
        for value in fixture.values():
            if isinstance(value, dict) and "client_ref" in value:
                is_other_author = value.get("client_ref") == fixture["authorOtherSpec"]["client_ref"]
                expected_author = (
                    plan["actorCommitment"]["actors"]["author"]
                    if is_other_author
                    else planner.CORRECTED_OWNER
                )
                self.assertEqual(value["author"], expected_author)

    def test_frozen_wallet_2_files_match_locked_commitments(self):
        expected_plan_sha = "306f742ac1b8bbdb8c01f0125c565dafe2c059ff1627cc1ed4f62c5804924b89"
        expected_fixture_sha = "518df208e7fc340a60383a0f7dc1fa1085d9e6283ed0ae8955ddf334ef763be3"
        plan_bytes = (ROOT / planner.PLAN).read_bytes()
        input_bytes = (ROOT / planner.INPUT).read_bytes()
        public_input_bytes = (ROOT / planner.PUBLIC_INPUT).read_bytes()
        self.assertEqual(planner.sha(plan_bytes), expected_plan_sha)
        self.assertEqual(planner.sha(input_bytes), expected_fixture_sha)
        self.assertEqual(planner.sha(public_input_bytes), expected_fixture_sha)
        frozen_plan = json.loads(plan_bytes)
        self.assertEqual(frozen_plan["mode"], "prepared")
        self.assertEqual(frozen_plan["executionRun"], "v6-wallet-2")
        self.assertEqual(frozen_plan["fixtureSha256"], expected_fixture_sha)
        self.assertEqual(
            frozen_plan["actorCommitment"]["actors"]["owner"],
            planner.CORRECTED_OWNER,
        )
        self.assertEqual(
            frozen_plan["walletPlannerCommitment"]["sha256"],
            planner.sha((ROOT / "scripts/prepare-v6-wallet-2-e2e.py").read_bytes()),
        )


if __name__ == "__main__":
    unittest.main()
