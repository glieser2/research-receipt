"""Export the V6 code-owned catalog without importing GenVM or running models."""
import argparse
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts/research_receipt_v6_candidate.py"
OUTPUT = ROOT / "src/field-catalog.json"


def build_catalog():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"), type_comments=True)
    wanted = {"CATALOG_VERSION", "FIELD_REGISTRY", "FIELD_LABELS"}
    constants = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in wanted:
            constants[node.targets[0].id] = ast.literal_eval(node.value)
    if set(constants) != wanted or set(constants["FIELD_REGISTRY"]) != set(constants["FIELD_LABELS"]):
        raise ValueError("Incomplete code-owned V6 catalog")
    return {"version": constants["CATALOG_VERSION"], "fields": [{"id": name, "group": item["criterion_id"], "label": constants["FIELD_LABELS"][name], "question": item["question"], "allowed_claim_types": ["factual_assertion", "unknown_disclosure"]} for name, item in constants["FIELD_REGISTRY"].items()]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = (json.dumps(build_catalog(), sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != data:
            raise SystemExit("V6 catalog is missing or differs from code-owned values")
    else:
        OUTPUT.write_bytes(data)
    print("V6 catalog " + ("checked" if args.check else "built") + ": " + str(OUTPUT.relative_to(ROOT)))


if __name__ == "__main__":
    main()
