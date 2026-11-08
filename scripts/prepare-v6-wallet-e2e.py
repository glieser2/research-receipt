"""Prepare a separate user-wallet V6 run; never modify the interrupted plan.

No RPC, wallet connection, private key, model, signature or chain write. The
reviewed old planner is reused as an offline oracle engine under explicit new
public actors and file destinations. --check-only writes nothing, uses preview
references, and cannot become an execution plan.
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
OLD_PLAN = "docs/evidence/v6-validation-plan.json"
OLD_SHA = "c731fb736abc2bf2c70e48d5a72cd1e72195a0bc25aa50070d7a9a28564b506e"
DEAD = {"0x29eb14d10ec2e406e5d1419ed08d803b8b18ab70", "0x7036138ada2052af0b07dae5a4d450effd9a40e3"}
INPUT = "artifacts/bradbury/v6-wallet-1-e2e-input.json"
PUBLIC_INPUT = "tests/fixtures/bradbury-v6-wallet-1-input.json"
PLAN = "docs/evidence/v6-wallet-1-validation-plan.json"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def build(owner, prepare=False):
    if not isinstance(owner, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", owner) or int(owner[2:], 16) == 0 or owner.lower() in DEAD:
        raise ValueError("A nonzero user-controlled public wallet address is required; unavailable signers are forbidden")
    assert sha(ENGINE.read_bytes()) == ENGINE_SHA, "Reviewed oracle engine changed"
    assert sha((ROOT / OLD_PLAN).read_bytes()) == OLD_SHA, "Interrupted frozen plan changed"
    spec = importlib.util.spec_from_file_location("rr_wallet_oracle_engine", ENGINE)
    engine = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(engine)
    # These two public addresses are read-only counterexamples, never signing
    # roles. No session file or key is read for the new wallet authority.
    actors = {"owner": owner.lower(), "author": "0x6a1f0a11003b197f192961b006a9e6534b447f75", "outsider": "0x2d13e8caee0a0fdff8cf45026c563843826a18b7"}
    if len(set(actors.values())) != 3:
        raise ValueError("Owner must differ from the fixed nonsigning counterexample addresses")
    engine.public_actors = lambda: dict(actors)
    engine.INPUT_FILE, engine.TEST_INPUT_FILE, engine.PLAN_FILE = INPUT, PUBLIC_INPUT, PLAN
    fixture, serialized, plan = engine.build_plan(prepare)
    assert plan["plannerSha256"] == ENGINE_SHA
    plan["executionAuthority"] = "user-controlled-wallet"
    plan["walletControlVerifiedByPlanner"] = False
    plan["executionRun"] = "v6-wallet-1"
    plan["walletPlannerCommitment"] = {"file": "scripts/prepare-v6-wallet-e2e.py", "sha256": sha(Path(__file__).read_bytes())}
    plan["supersedesExecutionPlan"] = {"file": OLD_PLAN, "sha256": OLD_SHA, "reason": "IN_MEMORY_SIGNERS_UNAVAILABLE_USER_WALLET_SELECTED", "priorPlanAltered": False}
    plan["actorCommitment"]["source"] = "User-selected public wallet owner; author and outsider are nonsigning public counterexamples. No private keys or old session authority used."
    plan["actorCommitment"]["signingAuthority"] = "User confirms every EIP-1193 transaction in their own wallet"
    plan["gates"][1] = "Preserve the recorded default gas-estimation failures. A separately reviewed user-wallet transport may proceed only with the exact deployment request passing a fresh fixed-block eth_call, gas limited to 100000000, total protocol value plus maximum envelope gas at most 0.05 test GEN, complete network/source/fee/account/nonce checks, explicit user confirmation for one deployment, and durable uncertain-send recovery without automatic retry. This replaces only the interrupted run's default-estimate transport gate, not any business oracle or accepted-consensus requirement."
    plan["walletTransportEvidence"] = [{"file": file, "sha256": sha((ROOT / file).read_bytes())} for file in ("docs/evidence/v6-transport-observations.json", "docs/evidence/v6-session-interruption.json")]
    plan["migration"].append("A separate execution run follows loss of the old in-memory signer. All 51 signing roles use the new user-controlled wallet; fresh references and dependent commitments are recomputed offline. Old plan, fixtures and failures remain unchanged; this is not the deployment-only sender addendum.")
    assert len(plan["cases"]) == 51 and len(plan["expected"]) == 10
    assert plan["actorCommitment"]["actors"]["owner"] == owner.lower()
    assert sha((ROOT / OLD_PLAN).read_bytes()) == OLD_SHA
    return fixture, serialized, plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check-only", action="store_true")
    mode.add_argument("--prepare", action="store_true")
    parser.add_argument("--owner", required=True)
    parser.add_argument("--reviewed-source-sha")
    args = parser.parse_args()
    if args.prepare and args.reviewed_source_sha != "e053f1b4250b6a0e7717722c54dfe97717a5d341b374d9404d7b5b2c057e1fcb":
        parser.error("--prepare requires explicitly reviewed actual deployment source")
    paths = [ROOT / file for file in (INPUT, PUBLIC_INPUT, PLAN)]
    if args.prepare and any(path.exists() for path in paths):
        raise SystemExit("Refuse to overwrite an existing wallet run; never resample its references")
    _, serialized, plan = build(args.owner, args.prepare)
    plan_bytes = (json.dumps(plan, ensure_ascii=False, indent=2) + "\n").encode()
    if args.prepare:
        for path, raw in zip(paths, [serialized, serialized, plan_bytes]):
            with path.open("xb") as stream:
                stream.write(raw)
    print(json.dumps({"prepared": args.prepare, "previewOnly": not args.prepare, "owner": args.owner.lower(), "fixtureSha256": sha(serialized), "planSha256": sha(plan_bytes), "planFile": PLAN if args.prepare else None, "cases": 51, "oldPlanUnchanged": True, "networkRequests": 0, "modelCalls": 0, "signatures": 0, "chainWrites": 0}))


if __name__ == "__main__":
    main()
