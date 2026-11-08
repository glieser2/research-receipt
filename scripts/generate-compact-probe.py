"""Deterministic whitespace-only transport artifact; no model/network/chain I/O."""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import platform
import subprocess
import sys
import tokenize

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts/research_receipt_sufficiency_probe.py"
OUTPUT = ROOT / "contracts/research_receipt_sufficiency_probe_compact.py"
SOURCE_SHA256 = "b931e3b582ad96e934a985ca1d21a955ce3e2ea910eae2e3918e2c7896f290de"
ALGORITHM = "python-ast-unparse-tokenize-minimal-whitespace/1"
IGNORED_TOKEN_TYPES = {tokenize.ENCODING, tokenize.NL, tokenize.NEWLINE,
                       tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER}


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def tree_dump(source):
    return ast.dump(ast.parse(source, type_comments=True), include_attributes=False)


def ordered_constants(source):
    """AST source traversal, preserving type, value and exact UTF-8/bytes data."""
    result = []
    class Constants(ast.NodeVisitor):
        def visit_Constant(self, node):
            if type(node.value) is str:
                result.append(("str", node.value, node.value.encode("utf-8").hex()))
            elif type(node.value) is bytes:
                result.append(("bytes", node.value.hex(), node.value.hex()))
    Constants().visit(ast.parse(source, type_comments=True))
    return result


def pair_tokens(value):
    result = []
    reader = tokenize.generate_tokens(io.StringIO(value).readline)
    try:
        for token in reader:
            if token.type not in IGNORED_TOKEN_TYPES:
                result.append((token.type, token.string))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        # A pair can contain an unmatched parenthesis; emitted tokens still
        # determine whether adjoining the pair changes their lexical identity.
        pass
    return result


def compact_source(raw):
    if sha256(raw) != SOURCE_SHA256:
        raise ValueError("Frozen b931 source fingerprint mismatch")
    runner_lines = raw.splitlines(keepends=True)[:2]
    if len(runner_lines) != 2 or not runner_lines[0].startswith(b"# v0.3.0") or b"py-genlayer:" not in runner_lines[1]:
        raise ValueError("Expected exact two runner metadata lines")
    original = raw.decode("utf-8")
    unparsed = ast.unparse(ast.parse(original, type_comments=True))
    lines, line, previous, indent = [], "", None, 0
    for token in tokenize.generate_tokens(io.StringIO(unparsed).readline):
        kind, value = token.type, token.string
        if kind == tokenize.INDENT:
            if set(value) != {" "} or len(value) % 4:
                raise ValueError("Unexpected ast.unparse indentation")
            indent = len(value) // 4
        elif kind == tokenize.DEDENT:
            indent -= 1
        elif kind == tokenize.NEWLINE:
            if line:
                lines.append(line)
            line, previous = "", None
        elif kind not in {tokenize.NL, tokenize.ENDMARKER, tokenize.ENCODING, tokenize.COMMENT}:
            if not line:
                line = " " * indent
            # Python currently tokenizes e.g. ``1 if`` without a separator,
            # but warns for ``1if`` and may reject it in future versions.
            needs_space = previous is not None and (previous[0] == tokenize.NUMBER and kind == tokenize.NAME or pair_tokens(previous[1] + value) != [previous, (kind, value)])
            if needs_space:
                line += " "
            line += value
            previous = (kind, value)
    if line:
        lines.append(line)
    compact = b"".join(runner_lines) + ("\n".join(lines) + "\n").encode("utf-8")
    if tree_dump(original) != tree_dump(compact.decode("utf-8")):
        raise ValueError("Full AST changed")
    if ordered_constants(original) != ordered_constants(compact.decode("utf-8")):
        raise ValueError("Ordered str/bytes values or bytes changed")
    return compact


def source_dependency_check(raw):
    tree = ast.parse(raw.decode("utf-8"), type_comments=True)
    forbidden_names = {"__file__", "__name__", "__loader__", "__spec__", "inspect",
                       "linecache", "traceback", "eval", "exec", "compile", "open"}
    forbidden_attributes = {"getsource", "getsourcelines", "currentframe", "f_lineno",
                            "co_firstlineno", "__code__", "__traceback__"}
    hits = [node.id for node in ast.walk(tree) if isinstance(node, ast.Name) and node.id in forbidden_names]
    hits += [node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute) and node.attr in forbidden_attributes]
    hits += [node.name for node in ast.walk(tree) if isinstance(node, ast.alias) and node.name.split(".")[0] in forbidden_names]
    if hits:
        raise ValueError("Source/line/introspection dependency requires separate review: " + repr(hits))
    return {"source_line_introspection_dependency_hits": hits,
            "scope": "Static explicit name/import/attribute check, not a general runtime equivalence proof"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Run only new artifact's offline equivalence tests")
    args = parser.parse_args()
    raw = SOURCE.read_bytes()
    dependencies = source_dependency_check(raw)
    compact = compact_source(raw)
    # Deterministic rebuilds may reuse exact bytes; never overwrite a different
    # artifact under this fixed algorithm/version.
    if OUTPUT.exists():
        if OUTPUT.read_bytes() != compact:
            raise ValueError("Existing compact artifact differs; refuse overwrite")
    else:
        with OUTPUT.open("xb") as file:
            file.write(compact)
    verification = {"executed": False, "reason": "Use --verify for artifact-specific offline tests"}
    if args.verify:
        command = [sys.executable, "-m", "unittest", "discover", "-s", "tests/python", "-p", "test_compact_probe.py"]
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
        verification = {"executed": True, "command": command, "exit_code": result.returncode,
                        "stdout": result.stdout, "stderr": result.stderr,
                        "scope": "Offline stubs only; no real model, RPC, signature, or consensus proof"}
    tool = Path(__file__).resolve()
    report = {"algorithm": ALGORITHM, "python_version": sys.version,
              "python_implementation": platform.python_implementation(),
              "source_file": str(SOURCE.relative_to(ROOT)), "source_sha256": sha256(raw),
              "tool_file": str(tool.relative_to(ROOT)), "tool_sha256": sha256(tool.read_bytes()),
              "artifact_test_file": "tests/python/test_compact_probe.py",
              "artifact_test_sha256": sha256((ROOT / "tests/python/test_compact_probe.py").read_bytes()),
              "output_file": str(OUTPUT.relative_to(ROOT)), "output_sha256": sha256(compact),
              "source_bytes": len(raw), "output_bytes": len(compact),
              "runner_first_two_lines_bytes_identical": compact.splitlines(keepends=True)[:2] == raw.splitlines(keepends=True)[:2],
              "full_ast_type_comments_equal": tree_dump(raw.decode("utf-8")) == tree_dump(compact.decode("utf-8")),
              "ordered_str_bytes_values_and_utf8_bytes_equal": ordered_constants(raw.decode("utf-8")) == ordered_constants(compact.decode("utf-8")),
              "ast_sha256": sha256(tree_dump(raw.decode("utf-8")).encode("utf-8")),
              "ordered_constants_sha256": sha256(json.dumps(ordered_constants(raw.decode("utf-8")), ensure_ascii=False, separators=(",", ":")).encode("utf-8")),
              "dependency_check": dependencies, "verification": verification,
              "original_verbatim_source_assertion": "INAPPLICABLE to compact formatting; replaced by full AST/constants and behavioral equivalence tests",
              "no_transport_success_claim": True}
    directory = ROOT / "artifacts/compact-builds"
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    report_path = directory / (stamp + "-" + report["output_sha256"][:12] + ".json")
    with report_path.open("x", encoding="utf-8", newline="\n") as file:
        json.dump(report, file, ensure_ascii=False, sort_keys=True, indent=2)
        file.write("\n")
    print(json.dumps({key: report[key] for key in ("algorithm", "source_sha256", "tool_sha256", "output_sha256", "source_bytes", "output_bytes")}, sort_keys=True))
    print("report=" + str(report_path.relative_to(ROOT)))
    if args.verify and verification["exit_code"]:
        raise SystemExit(verification["exit_code"])


if __name__ == "__main__":
    main()
