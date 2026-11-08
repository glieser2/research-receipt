"""基于异常加固候选合约（v6_r2_candidate）生成语义等价的 compact_v3 部署工件。

保持全部模块级常量与函数名、ResearchReceipt 类全部属性与公私有方法名、全部公开方法参数名、
前两行 GenVM runner 元数据注释，以及全部非文档字符串字面量与 UTF-8 字节完全不变；
同时通过词法作用域 α 归一化 AST（含 type_comments）证明与 v6_r2_candidate 完全同构，
且不改动任何既有 v6_candidate、compact 或 compact_v2 冻结文件。
"""
import argparse
import ast
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import platform
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
V2_GENERATOR = ROOT / "scripts/generate-v6-compact-v2.py"
V2_GENERATOR_SHA256 = "e4741856d62a70c0bcf451b8342f856e5cb0b2454ae2f699519f518051eee970"

spec = importlib.util.spec_from_file_location("generate_v6_compact_v2", V2_GENERATOR)
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)

sha256 = v2.sha256
ALGORITHM = v2.ALGORITHM
ALGORITHM_TOOL = v2.ALGORITHM_TOOL
ALGORITHM_TOOL_SHA256 = v2.ALGORITHM_TOOL_SHA256
BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES = v2.BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES
tree_dump = v2.tree_dump
alpha_tree_dump = v2.alpha_tree_dump
ordered_constants = v2.ordered_constants
ordered_non_docstring_constants = v2.ordered_non_docstring_constants
module_and_class_surface = v2.module_and_class_surface
source_dependency_check = v2.source_dependency_check
strip_docstrings_with_manifest = v2.strip_docstrings_with_manifest
compact_source = v2.compact_source

SOURCE = ROOT / "contracts/research_receipt_v6_r2_candidate.py"
SOURCE_SHA256 = "ce2a06360a16e53cfd7d4f94f39c1e81018f65f667e801a874b426cf4e56538f"
v2.SOURCE_SHA256 = SOURCE_SHA256
OUTPUT = ROOT / "contracts/research_receipt_v6_compact_v3.py"
ARTIFACT_TEST_FILE = "tests/python/test_v6_compact_v3.py"
FIXTURE_REPORT = ROOT / "tests/fixtures/v6-compact-v3-build.json"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Run compact_v3 offline behavioral, sub-VM exception hardening, and AST equivalence tests",
    )
    args = parser.parse_args()

    if sha256(V2_GENERATOR.read_bytes()) != V2_GENERATOR_SHA256:
        raise ValueError("Frozen compact_v2 generator dependency mismatch")
    if sha256(ALGORITHM_TOOL.read_bytes()) != ALGORITHM_TOOL_SHA256:
        raise ValueError("Frozen v1 token-emitter dependency mismatch")
    raw = SOURCE.read_bytes()
    if sha256(raw) != SOURCE_SHA256:
        raise ValueError("Expected v6_r2_candidate SHA-256 mismatch")

    dependencies = source_dependency_check(raw)
    compact = compact_source(raw)
    if len(compact) >= BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES:
        raise ValueError("compact_v3 exceeds Bradbury estimable source ceiling")

    # 确定性重复运行允许完全一致的字节；若已有不同字节则严禁覆盖
    if OUTPUT.exists():
        if OUTPUT.read_bytes() != compact:
            raise ValueError("Existing compact_v3 artifact differs; refuse overwrite")
    else:
        with OUTPUT.open("xb") as file:
            file.write(compact)

    verification = {"executed": False, "reason": "Use --verify for artifact-specific offline tests"}
    if args.verify:
        logical_command = [
            "python",
            "-m",
            "unittest",
            "discover",
            "-s",
            "tests/python",
            "-p",
            "test_v6_compact_v3.py",
        ]
        exec_command = [sys.executable, *logical_command[1:]]
        result = subprocess.run(
            exec_command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
        )
        verification = {
            "executed": True,
            "command": logical_command,
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "scope": "Offline stubs only; no real model, RPC, signature, or consensus proof",
        }

    original_text = raw.decode("utf-8")
    compact_text = compact.decode("utf-8")
    stripped_manifest = strip_docstrings_with_manifest(ast.parse(original_text, type_comments=True))
    non_doc_constants = ordered_non_docstring_constants(original_text)
    tool = Path(__file__).resolve()
    report = {
        "algorithm": ALGORITHM,
        "python_version": sys.version,
        "python_implementation": platform.python_implementation(),
        "source_file": SOURCE.relative_to(ROOT).as_posix(),
        "source_sha256": sha256(raw),
        "tool_file": tool.relative_to(ROOT).as_posix(),
        "tool_sha256": sha256(tool.read_bytes()),
        "algorithm_dependency_file": ALGORITHM_TOOL.relative_to(ROOT).as_posix(),
        "algorithm_dependency_sha256": ALGORITHM_TOOL_SHA256,
        "artifact_test_file": ARTIFACT_TEST_FILE,
        "artifact_test_sha256": sha256((ROOT / ARTIFACT_TEST_FILE).read_bytes()),
        "output_file": OUTPUT.relative_to(ROOT).as_posix(),
        "output_sha256": sha256(compact),
        "source_bytes": len(raw),
        "output_bytes": len(compact),
        "bradbury_estimable_ceiling_bytes": BRADBURY_ESTIMABLE_SOURCE_CEILING_BYTES,
        "runner_first_two_lines_bytes_identical": (
            compact.splitlines(keepends=True)[:2] == raw.splitlines(keepends=True)[:2]
        ),
        "full_ast_type_comments_equal": tree_dump(original_text) == tree_dump(compact_text),
        "alpha_normalized_ast_type_comments_equal": (
            alpha_tree_dump(original_text) == alpha_tree_dump(compact_text)
        ),
        "ordered_str_bytes_values_and_utf8_bytes_equal": (
            ordered_constants(original_text) == ordered_constants(compact_text)
        ),
        "ordered_non_docstring_str_bytes_values_and_utf8_bytes_equal": (
            non_doc_constants == ordered_non_docstring_constants(compact_text)
            and non_doc_constants == ordered_constants(compact_text)
        ),
        "module_and_class_surface_identical": (
            module_and_class_surface(original_text) == module_and_class_surface(compact_text)
        ),
        "stripped_docstring_count": len(stripped_manifest),
        "stripped_docstrings": stripped_manifest,
        "output_docstring_count": len(
            strip_docstrings_with_manifest(ast.parse(compact_text, type_comments=True))
        ),
        "alpha_ast_sha256": sha256(alpha_tree_dump(original_text).encode("utf-8")),
        "ordered_non_docstring_constants_sha256": sha256(
            json.dumps(non_doc_constants, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ),
        "dependency_check": dependencies,
        "verification": verification,
        "original_verbatim_source_assertion": (
            "INAPPLICABLE to compact_v3 formatting; replaced by lexical-scope alpha-normalized AST, "
            "ordered non-docstring constants, identical module/class surface, and behavioral equivalence tests"
        ),
        "no_transport_success_claim": True,
    }
    directory = ROOT / "artifacts/v6-compact-builds"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    report_path = directory / (stamp + "-" + report["output_sha256"][:12] + ".json")
    serialized_report = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    with report_path.open("x", encoding="utf-8", newline="\n") as file:
        file.write(serialized_report)
    if args.verify and verification["exit_code"] == 0:
        FIXTURE_REPORT.write_text(serialized_report, encoding="utf-8", newline="\n")
    print(
        json.dumps(
            {
                key: report[key]
                for key in (
                    "algorithm",
                    "source_sha256",
                    "tool_sha256",
                    "output_sha256",
                    "source_bytes",
                    "output_bytes",
                    "alpha_normalized_ast_type_comments_equal",
                )
            },
            sort_keys=True,
        )
    )
    print("report=" + report_path.relative_to(ROOT).as_posix())
    if args.verify and verification["exit_code"]:
        raise SystemExit(verification["exit_code"])


if __name__ == "__main__":
    main()
