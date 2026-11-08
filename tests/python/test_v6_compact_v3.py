"""异常加固候选合约（v6_r2_candidate）与 compact_v3 部署工件的离线等价性、子 VM 异常捕获与 AST 同构测试套件。

继承并运行全部 V6 业务与安全控制，校验词法作用域 α 归一化 AST、非文档字符串常量字节、
11 项错误守卫字面量、模型提示词字节与完整状态轨迹一致；同时专门核验 exec_prompt
异常纳入唯一全局单次修复预算、二次异常确定性转为 UserError 且绝不泄漏未捕获子 VM 异常。
"""
import copy
import hashlib
import importlib.util
import inspect
import json
from pathlib import Path
import re
from unittest.mock import patch

import test_contract_v6 as original

ROOT = Path(__file__).resolve().parents[2]
V1_SOURCE = ROOT / "contracts/research_receipt_v6_candidate.py"
R2_SOURCE = ROOT / "contracts/research_receipt_v6_r2_candidate.py"
COMPACT_V1 = ROOT / "contracts/research_receipt_v6_compact.py"
COMPACT_V2 = ROOT / "contracts/research_receipt_v6_compact_v2.py"
COMPACT_V3 = ROOT / "contracts/research_receipt_v6_compact_v3.py"
GENERATOR = ROOT / "scripts/generate-v6-compact-v3.py"
V1_CANONICAL = original.rr


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


r2_canonical = load_module("research_receipt_v6_r2_candidate", R2_SOURCE)
artifact = load_module("research_receipt_v6_compact_v3", COMPACT_V3)
generator = load_module("generate_v6_compact_v3", GENERATOR)


def extract_fail_messages(source_text):
    pattern = re.compile(r"""fail\((?:"([^"\\]*)"|'([^'\\]*)')\)""")
    return [
        match.group(1) if match.group(1) is not None else match.group(2)
        for match in pattern.finditer(source_text)
    ]


class CompactV6V3Tests(original.ContractV6Tests):
    def setUp(self):
        for name, value in (("rr", artifact), ("SOURCE", COMPACT_V3)):
            context = patch.object(original, name, value)
            context.start()
            self.addCleanup(context.stop)
        super().setUp()

    def test_global_single_repair_and_provider_error_limits(self):
        # 校验全局唯一单次修复预算上限不变，且 exec_prompt 子 VM 异常纳入该唯一预算而非直接崩溃
        spec, sub, snapshot, binding = self.context()
        self.queue()
        first = copy.deepcopy(self.outputs[0])
        self.outputs[0]["extra"] = True
        self.outputs.insert(1, first)
        self.outputs[2]["field_checks"][0]["evidence_indices"] = [0]
        with self.assertRaisesRegex(original.UserError, "global repair budget"):
            artifact.independent_assessment(spec, sub, snapshot, binding)
        self.assertEqual(len(self.prompts), 3)

        # 单次 exec_prompt 异常（如 JSONDecodeError / ValueError / OSError）通过唯一修复调用恢复
        for exc in (ValueError("json decode error"), OSError("transient provider glitch")):
            for mod in (r2_canonical, artifact):
                self.prompts, self.outputs = [], []
                self.queue()
                valid_first = copy.deepcopy(self.outputs[0])
                self.outputs[0] = exc
                self.outputs.insert(1, valid_first)
                recovered = mod.independent_assessment(spec, sub, snapshot, binding)
                self.assertEqual(recovered["verdict"], "ACCEPTED")
                self.assertEqual(len(self.prompts), 5)
                self.assertIn("FORMAT_REPAIR_ERROR_CODE: RR_MODEL_EXEC_ERROR", self.prompts[1])

        # 首次与修复调用连续异常时，消耗唯一修复预算并抛出确定性 UserError，绝不泄漏未捕获异常
        for mod in (r2_canonical, artifact):
            self.prompts, self.outputs = [], [OSError("provider down 1"), RuntimeError("provider down 2")]
            with self.assertRaisesRegex(
                original.UserError,
                "Model output rejected after format repair: RR_MODEL_EXEC_ERROR",
            ):
                mod.independent_assessment(spec, sub, snapshot, binding)
            self.assertEqual(len(self.prompts), 2)

        # 第一条准则已消耗全局修复预算后，后续准则再次发生 exec_prompt 异常立即抛出预算耗尽 UserError
        for mod in (r2_canonical, artifact):
            self.prompts, self.outputs = [], []
            self.queue()
            valid_first = copy.deepcopy(self.outputs[0])
            self.outputs[0] = ValueError("first glitch")
            self.outputs.insert(1, valid_first)
            self.outputs[2] = RuntimeError("second glitch")
            with self.assertRaisesRegex(
                original.UserError,
                "Model output rejected after global repair budget: RR_MODEL_EXEC_ERROR",
            ):
                mod.independent_assessment(spec, sub, snapshot, binding)
            self.assertEqual(len(self.prompts), 3)

    def test_validator_side_recovers_from_single_exec_prompt_exception_and_rejects_double_failure(self):
        # 验证者执行独立评估遇到单次 exec_prompt 异常时同样可通过单次修复达成一致；连续异常则确定性返回 False
        order = self.setup_revision()
        self.contract.verify_evidence(order, 1)
        leader_outs = original.sufficiency.scripted_outputs(self.fixture["positive"], "positive")
        val_outs = copy.deepcopy(leader_outs)
        val_first = copy.deepcopy(val_outs[0])
        val_outs[0] = ValueError("validator json parse failure")
        val_outs.insert(1, val_first)
        self.outputs = leader_outs + val_outs
        self.contract.evaluate(order, 1)
        self.assertEqual(json.loads(self.contract.get_assessment(order, 1))["verdict"], "ACCEPTED")
        self.assertEqual(len(self.prompts), 9)

        self.setUp()
        order2 = self.setup_revision(case="negative")
        self.contract.verify_evidence(order2, 1)
        leader_neg = original.sufficiency.scripted_outputs(self.fixture["negative"], "negative")
        self.outputs = leader_neg + [OSError("validator down 1"), OSError("validator down 2")]
        with self.assertRaisesRegex(original.UserError, "Independent validator rejected leader"):
            self.contract.evaluate(order2, 1)

    def test_strict_allow_four_prompts_equal_and_model_core_verbatim(self):
        prompts = []
        for case in ("positive", "strictUnknown"):
            spec, sub, snapshot, _ = self.context(case=case)
            materials = dict(enumerate(snapshot["materials"]))
            actual_prompts = [
                artifact.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8")
                for criterion, claim in zip(spec["criteria"], sub["claims"])
            ]
            r2_prompts = [
                r2_canonical.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8")
                for criterion, claim in zip(spec["criteria"], sub["claims"])
            ]
            v1_prompts = [
                V1_CANONICAL.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8")
                for criterion, claim in zip(spec["criteria"], sub["claims"])
            ]
            self.assertEqual(actual_prompts, r2_prompts)
            self.assertEqual(actual_prompts, v1_prompts)
            prompts.append(actual_prompts)
        self.assertEqual(prompts[0], prompts[1])
        for name in (
            "unknown_prompt",
            "decode_unknown_finding",
            "preserved_field_states",
            "sufficiency_prompt",
            "decode_sufficiency_finding",
            "decode_model_finding",
            "preserved_result",
        ):
            compact_fn = inspect.getsource(getattr(artifact, name))
            r2_fn = inspect.getsource(getattr(r2_canonical, name))
            v1_fn = inspect.getsource(getattr(V1_CANONICAL, name))
            self.assertEqual(generator.alpha_tree_dump(compact_fn), generator.alpha_tree_dump(r2_fn), name)
            self.assertEqual(generator.alpha_tree_dump(compact_fn), generator.alpha_tree_dump(v1_fn), name)
            self.assertEqual(
                generator.ordered_non_docstring_constants(compact_fn),
                generator.ordered_non_docstring_constants(r2_fn),
                name,
            )
        self.assertEqual(artifact.FIELD_REGISTRY, V1_CANONICAL.FIELD_REGISTRY)

    def test_alpha_ast_non_docstring_constants_surface_and_runner_bytes_equal(self):
        before, after = R2_SOURCE.read_bytes(), COMPACT_V3.read_bytes()
        self.assertEqual(hashlib.sha256(before).hexdigest(), generator.SOURCE_SHA256)
        self.assertEqual(
            hashlib.sha256(generator.ALGORITHM_TOOL.read_bytes()).hexdigest(),
            generator.ALGORITHM_TOOL_SHA256,
        )
        self.assertEqual(generator.compact_source(before), after)
        self.assertEqual(before.splitlines(keepends=True)[:2], after.splitlines(keepends=True)[:2])

        before_text = before.decode("utf-8")
        after_text = after.decode("utf-8")
        self.assertEqual(generator.alpha_tree_dump(before_text), generator.alpha_tree_dump(after_text))
        self.assertNotEqual(generator.tree_dump(before_text), generator.tree_dump(after_text))
        self.assertEqual(
            generator.ordered_non_docstring_constants(before_text),
            generator.ordered_non_docstring_constants(after_text),
        )
        self.assertEqual(
            generator.ordered_non_docstring_constants(before_text),
            generator.ordered_constants(after_text),
        )
        self.assertEqual(
            generator.module_and_class_surface(before_text),
            generator.module_and_class_surface(after_text),
        )
        self.assertEqual(
            generator.module_and_class_surface(V1_SOURCE.read_text(encoding="utf-8")),
            generator.module_and_class_surface(after_text),
        )
        self.assertEqual(
            generator.source_dependency_check(before)["source_line_introspection_dependency_hits"],
            [],
        )
        self.assertLess(len(after), generator.BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES)
        self.assertLess(len(after), len(COMPACT_V1.read_bytes()))
        compile(after, str(COMPACT_V3), "exec")

    def test_error_guard_fail_literals_identical_for_collector_regex(self):
        v1_fails = extract_fail_messages(V1_SOURCE.read_text(encoding="utf-8"))
        r2_fails = extract_fail_messages(R2_SOURCE.read_text(encoding="utf-8"))
        c2_fails = extract_fail_messages(COMPACT_V2.read_text(encoding="utf-8"))
        c3_fails = extract_fail_messages(COMPACT_V3.read_text(encoding="utf-8"))
        self.assertGreater(len(v1_fails), 20)
        self.assertEqual(v1_fails, r2_fails)
        self.assertEqual(v1_fails, c2_fails)
        self.assertEqual(v1_fails, c3_fails)

    def test_seven_complete_business_model_traces_snapshot_hashes_and_state_equal(self):
        for case in original.sufficiency.structured.MODEL_CASES:
            results = []
            for module in (V1_CANONICAL, r2_canonical, artifact):
                self.setUp()
                self.contract = module.ResearchReceipt()
                for name in ("orders", "order_ids", "revisions", "evidence_snapshots", "assessments"):
                    setattr(self.contract, name, {})
                order = self.setup_revision(case=case)
                self.contract.verify_evidence(order, 1)
                fetch_count = len(self.fetches)
                self.queue(case, times=2)
                self.contract.evaluate(order, 1)
                self.assertEqual(len(self.fetches), fetch_count)
                results.append(
                    (
                        {
                            name: copy.deepcopy(getattr(self.contract, name))
                            for name in ("orders", "order_ids", "revisions", "evidence_snapshots", "assessments")
                        },
                        copy.deepcopy(self.fetches),
                        copy.deepcopy(self.prompts),
                    )
                )
            self.assertEqual(results[0], results[1], case)
            self.assertEqual(results[0], results[2], case)


if __name__ == "__main__":
    import unittest

    unittest.main()
