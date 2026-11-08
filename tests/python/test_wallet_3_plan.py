"""验证 v6-wallet-3 独立离线执行计划：绑定 compact_v2、保留全部 51 项业务预期与前 13 项硬 gate，且不改动任何历史或 wallet-2 冻结文件。"""
import ast
import importlib.util
import json
from pathlib import Path
import symtable
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "wallet_3_plan", ROOT / "scripts/prepare-v6-wallet-3-e2e.py"
)
planner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(planner)


class Wallet3PlanTest(unittest.TestCase):
    def test_unavailable_superseded_or_invalid_owners_rejected(self):
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

        with self.assertRaises(ValueError):
            planner.build("0x1111111111111111111111111111111111111111", prepare=True)

    def test_wallet_3_recomputes_51_cases_under_compact_v2_without_altering_history(self):
        old_bytes = (ROOT / planner.OLD_PLAN).read_bytes()
        wallet1_plan_bytes = (ROOT / planner.WALLET_1_PLAN).read_bytes()
        wallet2_plan_bytes = (ROOT / planner.WALLET_2_PLAN).read_bytes()
        wallet2_revert_bytes = (ROOT / planner.WALLET_2_REVERT_EVIDENCE).read_bytes()
        old = json.loads(old_bytes)
        wallet2 = json.loads(wallet2_plan_bytes)

        fixture, _, plan = planner.build(planner.CORRECTED_OWNER, prepare=False)

        # 确认历史与 wallet-2 冻结文件字节级未变
        self.assertEqual((ROOT / planner.OLD_PLAN).read_bytes(), old_bytes)
        self.assertEqual((ROOT / planner.WALLET_1_PLAN).read_bytes(), wallet1_plan_bytes)
        self.assertEqual((ROOT / planner.WALLET_2_PLAN).read_bytes(), wallet2_plan_bytes)
        self.assertEqual((ROOT / planner.WALLET_2_REVERT_EVIDENCE).read_bytes(), wallet2_revert_bytes)

        self.assertEqual(plan["executionAuthority"], "user-controlled-wallet")
        self.assertEqual(plan["executionRun"], "v6-wallet-3")
        self.assertEqual(plan["actorCommitment"]["actors"]["owner"], planner.CORRECTED_OWNER)
        self.assertEqual(plan["deploymentSourceCommitment"]["file"], planner.DEPLOYMENT_FILE)
        self.assertEqual(plan["deploymentSourceCommitment"]["sha256"], planner.DEPLOYMENT_SHA)
        self.assertEqual(plan["supersedesWallet2Plan"]["sha256"], planner.WALLET_2_PLAN_SHA)
        self.assertEqual(
            plan["supersedesWallet2Plan"]["revertedDeploymentEvidenceSha256"],
            planner.WALLET_2_REVERT_EVIDENCE_SHA,
        )
        self.assertEqual(plan["firstGate"]["caseSequences"], list(range(1, 14)))
        self.assertEqual(plan["requiredSignedCaseCount"], 51)
        self.assertEqual(plan["chainWritesPerformedByPlanner"], 0)

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

        for actual, previous, w2 in zip(plan["cases"], old["cases"], wallet2["cases"]):
            self.assertEqual(actual["expectedTransaction"], previous["expectedTransaction"])
            self.assertEqual(actual["expectedError"], previous["expectedError"])
            self.assertEqual(
                actual["modelCallsPerIndependentExecution"],
                previous["modelCallsPerIndependentExecution"],
            )
            self.assertEqual(actual["role"], "owner")
            self.assertEqual(actual.get("phase"), w2.get("phase"))

        for actual, previous in zip(plan["expected"], old["expected"]):
            self.assertEqual(
                actual["assessment"]["projection"]["findings"],
                previous["assessment"]["projection"]["findings"],
            )
            self.assertEqual(
                actual["assessment"]["projection"]["verdict"],
                previous["assessment"]["projection"]["verdict"],
            )

        for value in fixture.values():
            if isinstance(value, dict) and "client_ref" in value:
                is_other_author = value.get("client_ref") == fixture["authorOtherSpec"]["client_ref"]
                expected_author = (
                    plan["actorCommitment"]["actors"]["author"]
                    if is_other_author
                    else planner.CORRECTED_OWNER
                )
                self.assertEqual(value["author"], expected_author)

    def test_frozen_wallet_3_files_match_locked_commitments(self):
        expected_plan_sha = "76c2583b393255b241e670e5ba418a7517003d56afdfd1316f0c5c746c8a1b1a"
        expected_fixture_sha = "b779bbf58577b7eec6a57443e8de794d287f571400d8e033146c187121afe8c0"
        plan_bytes = (ROOT / planner.PLAN).read_bytes()
        input_bytes = (ROOT / planner.INPUT).read_bytes()
        public_input_bytes = (ROOT / planner.PUBLIC_INPUT).read_bytes()
        self.assertEqual(planner.sha(plan_bytes), expected_plan_sha)
        self.assertEqual(planner.sha(input_bytes), expected_fixture_sha)
        self.assertEqual(planner.sha(public_input_bytes), expected_fixture_sha)

        frozen_plan = json.loads(plan_bytes)
        self.assertEqual(frozen_plan["mode"], "prepared")
        self.assertEqual(frozen_plan["executionRun"], "v6-wallet-3")
        self.assertEqual(frozen_plan["fixtureSha256"], expected_fixture_sha)
        self.assertNotEqual(frozen_plan["fixtureSha256"], planner.WALLET_2_FIXTURE_SHA)
        self.assertEqual(
            frozen_plan["deploymentSourceCommitment"]["sha256"],
            planner.DEPLOYMENT_SHA,
        )
        self.assertEqual(
            frozen_plan["actorCommitment"]["actors"]["owner"],
            planner.CORRECTED_OWNER,
        )
        self.assertEqual(
            frozen_plan["walletPlannerCommitment"]["sha256"],
            planner.sha((ROOT / "scripts/prepare-v6-wallet-3-e2e.py").read_bytes()),
        )

    def test_compact_v2_has_no_string_scoped_bindings_and_matches_cpython_symtable(self):
        candidate_src = (ROOT / "contracts/research_receipt_v6_candidate.py").read_text(encoding="utf-8")
        compact_v2_src = (ROOT / planner.DEPLOYMENT_FILE).read_text(encoding="utf-8")

        for label, src in [("candidate", candidate_src), ("compact_v2", compact_v2_src)]:
            tree = ast.parse(src, type_comments=True)
            top_classes = [node for node in tree.body if isinstance(node, ast.ClassDef)]
            top_imports = [node for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))]
            all_classes = [node for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
            all_imports = [node for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]
            forbidden = [
                type(node).__name__
                for node in ast.walk(tree)
                if isinstance(node, (ast.Global, ast.Nonlocal, ast.Match, ast.AsyncFunctionDef))
            ]
            dynamic_Reflection = [
                node.func.id
                for node in ast.walk(tree)
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in {"locals", "vars", "globals", "eval", "exec", "getattr", "setattr"}
            ]
            self.assertEqual(forbidden, [], f"{label} contains forbidden scoping nodes")
            self.assertEqual(dynamic_Reflection, [], f"{label} contains dynamic scope reflection")
            self.assertEqual(len(all_classes), len(top_classes), f"{label} contains nested ClassDef")
            self.assertEqual(len(all_imports), len(top_imports), f"{label} contains nested import")

        cand_st = symtable.symtable(candidate_src, "candidate.py", "exec")
        comp_st = symtable.symtable(compact_v2_src, "compact_v2.py", "exec")

        def scope_signature(
            table: symtable.SymbolTable,
            parent_type: str | None = None,
            is_public_method: bool = False,
        ) -> dict:
            symbols = sorted(table.get_identifiers())
            global_refs = sorted(
                s.get_name() for s in table.get_symbols() if s.is_global() and not s.is_local()
            )
            param_names = sorted(
                s.get_name() for s in table.get_symbols() if s.is_parameter()
            )
            free_count = sum(1 for s in table.get_symbols() if s.is_free())
            param_count = len(param_names)
            declared_globals = sorted(
                s.get_name() for s in table.get_symbols() if s.is_declared_global()
            )
            children = [
                scope_signature(
                    child,
                    parent_type=table.get_type(),
                    is_public_method=(
                        table.get_type() == "class" and not child.get_name().startswith("_")
                    ),
                )
                for child in table.get_children()
            ]
            keep_scope_name = parent_type in (None, "module", "class")
            # CPython 3.12+ PEP 709 将推导式内联至外层帧符号表（LOAD_FAST_AND_CLEAR 保存/恢复），
            # 相邻独立推导式的目标变量在 α 归一化后可安全复用同一局部名，故核验全局引用、自由变量、形参与子作用域树完全一致。
            return {
                "type": table.get_type(),
                "name": table.get_name() if keep_scope_name else "<local-scope>",
                "public_symbols": symbols if table.get_type() in ("module", "class") else None,
                "public_params": param_names if is_public_method else None,
                "global_refs": global_refs,
                "declared_globals": declared_globals,
                "free_count": free_count,
                "param_count": param_count,
                "children": children,
            }

        self.assertEqual(scope_signature(cand_st), scope_signature(comp_st))


if __name__ == "__main__":
    unittest.main()
