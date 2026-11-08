"""冻结 V6 候选合约与 compact_v2 部署工件的离线等价性与 AST 同构测试套件。

继承并运行全部 34 项 V6 业务与安全控制，同时校验词法作用域 α 归一化 AST、
全部非文档字符串常量字节、错误守卫字面量、模型提示词字节以及完整状态轨迹一致。
"""
import copy
import hashlib
import importlib.util
import inspect
from pathlib import Path
import re
from unittest.mock import patch

import test_contract_v6 as original

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "contracts/research_receipt_v6_candidate.py"
COMPACT_V1 = ROOT / "contracts/research_receipt_v6_compact.py"
COMPACT_V2 = ROOT / "contracts/research_receipt_v6_compact_v2.py"
GENERATOR = ROOT / "scripts/generate-v6-compact-v2.py"
CANONICAL = original.rr


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


artifact = load_module("research_receipt_v6_compact_v2", COMPACT_V2)
generator = load_module("generate_v6_compact_v2", GENERATOR)


def extract_fail_messages(source_text):
    pattern = re.compile(r"""fail\((?:"([^"\\]*)"|'([^'\\]*)')\)""")
    return [match.group(1) if match.group(1) is not None else match.group(2) for match in pattern.finditer(source_text)]


class CompactV6V2Tests(original.ContractV6Tests):
    def setUp(self):
        for name, value in (("rr", artifact), ("SOURCE", COMPACT_V2)):
            context = patch.object(original, name, value)
            context.start()
            self.addCleanup(context.stop)
        super().setUp()

    def test_strict_allow_four_prompts_equal_and_model_core_verbatim(self):
        # 压缩后 inspect.getsource 源码字节断言不适用；改为校验 4 条提示词精确 UTF-8 字节、
        # 7 个模型核心函数的词法 α 归一化 AST 同构及非文档字符串常量完全一致。
        prompts = []
        for case in ("positive", "strictUnknown"):
            spec, sub, snapshot, _ = self.context(case=case)
            materials = dict(enumerate(snapshot["materials"]))
            actual_prompts = [
                artifact.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8")
                for criterion, claim in zip(spec["criteria"], sub["claims"])
            ]
            canonical_prompts = [
                CANONICAL.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8")
                for criterion, claim in zip(spec["criteria"], sub["claims"])
            ]
            self.assertEqual(actual_prompts, canonical_prompts)
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
            canonical_fn = inspect.getsource(getattr(CANONICAL, name))
            self.assertEqual(
                generator.alpha_tree_dump(compact_fn),
                generator.alpha_tree_dump(canonical_fn),
                name,
            )
            self.assertEqual(
                generator.ordered_non_docstring_constants(compact_fn),
                generator.ordered_non_docstring_constants(canonical_fn),
                name,
            )
        self.assertEqual(artifact.FIELD_REGISTRY, CANONICAL.FIELD_REGISTRY)
        self.assertNotEqual(
            inspect.getsource(artifact.unknown_prompt),
            inspect.getsource(CANONICAL.unknown_prompt),
        )

    def test_alpha_ast_non_docstring_constants_surface_and_runner_bytes_equal(self):
        before, after = SOURCE.read_bytes(), COMPACT_V2.read_bytes()
        self.assertEqual(hashlib.sha256(before).hexdigest(), generator.SOURCE_SHA256)
        self.assertEqual(
            hashlib.sha256(generator.ALGORITHM_TOOL.read_bytes()).hexdigest(),
            generator.ALGORITHM_TOOL_SHA256,
        )
        self.assertEqual(generator.compact_source(before), after)
        self.assertEqual(before.splitlines(keepends=True)[:2], after.splitlines(keepends=True)[:2])

        before_text = before.decode("utf-8")
        after_text = after.decode("utf-8")
        self.assertEqual(
            generator.alpha_tree_dump(before_text),
            generator.alpha_tree_dump(after_text),
        )
        self.assertNotEqual(
            generator.tree_dump(before_text),
            generator.tree_dump(after_text),
        )
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
            generator.source_dependency_check(before)["source_line_introspection_dependency_hits"],
            [],
        )
        self.assertLess(len(after), generator.BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES)
        self.assertLess(len(after), len(COMPACT_V1.read_bytes()))
        compile(after, str(COMPACT_V2), "exec")

    def test_alpha_normalizer_detects_capture_shadowing_constant_and_signature_mutations(self):
        # 正例：仅局部变量 α 重命名 + 剥离函数 docstring 必须判定等价
        fn_a = 'def helper(first_item, second_item):\n    """doc"""\n    total = first_item + second_item + GLOBAL_X\n    return [entry + total for entry in first_item]\n'
        fn_b = "def helper(a,b):\n c=a+b+GLOBAL_X\n return[d+c for d in a]\n"
        self.assertEqual(generator.alpha_tree_dump(fn_a), generator.alpha_tree_dump(fn_b))
        self.assertEqual(
            generator.ordered_non_docstring_constants(fn_a),
            generator.ordered_non_docstring_constants(fn_b),
        )

        # 反例 1：局部变量错误捕获全局变量 GLOBAL_X
        captured = "def helper(a,GLOBAL_X):\n c=a+GLOBAL_X+GLOBAL_X\n return[d+c for d in a]\n"
        self.assertNotEqual(generator.alpha_tree_dump(fn_a), generator.alpha_tree_dump(captured))

        # 反例 2：ResearchReceipt 公开方法参数名漂移必须被拦截
        pub_a = "class ResearchReceipt:\n @gl.public.write\n def evaluate(self, order_id: int, revision: int) -> str:\n  return str(order_id + revision)\n"
        pub_b = "class ResearchReceipt:\n @gl.public.write\n def evaluate(self, a: int, revision: int) -> str:\n  return str(a + revision)\n"
        self.assertNotEqual(generator.alpha_tree_dump(pub_a), generator.alpha_tree_dump(pub_b))

        # 反例 3：属性名或字符串常量变化必须被拦截
        attr_a = 'def f(x):\n return x.orders["ok"]\n'
        attr_b = 'def f(a):\n return a.order_map["ok"]\n'
        str_b = 'def f(a):\n return a.orders["changed"]\n'
        self.assertNotEqual(generator.alpha_tree_dump(attr_a), generator.alpha_tree_dump(attr_b))
        self.assertNotEqual(
            generator.ordered_non_docstring_constants(attr_a),
            generator.ordered_non_docstring_constants(str_b),
        )

    def test_error_guard_fail_literals_identical_for_collector_regex(self):
        canonical_fails = extract_fail_messages(SOURCE.read_text(encoding="utf-8"))
        v1_fails = extract_fail_messages(COMPACT_V1.read_text(encoding="utf-8"))
        v2_fails = extract_fail_messages(COMPACT_V2.read_text(encoding="utf-8"))
        self.assertGreater(len(canonical_fails), 20)
        self.assertEqual(canonical_fails, v1_fails)
        self.assertEqual(canonical_fails, v2_fails)

    def test_normalizers_catalog_render_and_all_four_prompt_bytes_equal(self):
        self.assertEqual(artifact.field_catalog(), CANONICAL.field_catalog())
        self.assertEqual(
            artifact.canonical(artifact.field_catalog()).encode("utf-8"),
            CANONICAL.canonical(CANONICAL.field_catalog()).encode("utf-8"),
        )
        for case in original.sufficiency.structured.MODEL_CASES:
            value = self.payload(case)
            spec = CANONICAL.normalize_spec(CANONICAL.canonical(value["spec"]))
            sub = CANONICAL.normalize_submission(CANONICAL.canonical(value["submission"]), spec)
            actual_spec, actual_sub = self.normalize(value)
            self.assertEqual((actual_spec, actual_sub), (spec, sub))
            self.assertEqual(artifact.digest(actual_spec), CANONICAL.digest(spec))
            self.assertEqual(artifact.digest(actual_sub), CANONICAL.digest(sub))
            self.assertEqual(
                artifact.content_fingerprint(actual_spec, actual_sub),
                CANONICAL.content_fingerprint(spec, sub),
            )
            materials = dict(enumerate(value["materials"]))
            for criterion, claim in zip(spec["criteria"], sub["claims"]):
                self.assertEqual(
                    artifact.render_claim_statement(spec, claim),
                    CANONICAL.render_claim_statement(spec, claim),
                )
                self.assertEqual(
                    artifact.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8"),
                    CANONICAL.build_model_prompt(spec, sub, criterion, claim, materials).encode("utf-8"),
                )

    def test_seven_complete_business_model_traces_snapshot_hashes_and_state_equal(self):
        for case in original.sufficiency.structured.MODEL_CASES:
            results = []
            for module in (CANONICAL, artifact):
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

    def test_format_repair_model_trace_and_full_projection_equal(self):
        results = []
        for module in (CANONICAL, artifact):
            self.setUp()
            spec, sub, snapshot, binding = self.context()
            self.queue()
            first = copy.deepcopy(self.outputs[0])
            self.outputs[0]["extra"] = True
            self.outputs.insert(1, first)
            self.prompts = []
            before_fetches = len(self.fetches)
            result = module.independent_assessment(spec, sub, snapshot, binding)
            self.assertEqual(len(self.fetches), before_fetches)
            results.append((result, module.stable_projection(result), copy.deepcopy(self.prompts)))
        self.assertEqual(results[0], results[1])
        self.assertEqual(len(results[0][2]), 5)


if __name__ == "__main__":
    import unittest

    unittest.main()
