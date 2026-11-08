"""Generate the source-only isolation probe from the exact frozen business source.

This generator performs no network access or deployment. It refuses source drift.
"""
from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]
FROZEN_SHA256 = "f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61"

TAIL = '''

PROBE_VERSION = "research-receipt/source-only-probe/1"
SOURCE_CHECK_STATUSES = ("VERIFIED", "UNAVAILABLE", "TOO_LARGE", "HASH_MISMATCH", "INVALID_ENCODING")


def validate_source_checks(checks, submission):
    if not isinstance(checks, list) or len(checks) != len(submission["sources"]):
        fail("Invalid source-check count")
    for index, check in enumerate(checks):
        require_keys(check, ("index", "status", "sha256"))
        if type(check["index"]) is not int or check["index"] != index or check["status"] not in SOURCE_CHECK_STATUSES:
            fail("Invalid source-check result")
        sha = check["sha256"]
        if not isinstance(sha, str) or (sha != "" and not re.fullmatch(r"[0-9a-f]{64}", sha)):
            fail("Invalid source-check hash")
        if check["status"] != "UNAVAILABLE" and sha == "":
            fail("A checked source requires its actual hash")
        if check["status"] == "VERIFIED" and sha != submission["sources"][index]["sha256"]:
            fail("Verified source hash mismatch")
    return checks


class ResearchReceiptSourceProbe(gl.contract.Contract):
    receipt: str

    def __init__(self, spec_json: str, submission_json: str):
        spec = normalize_spec(spec_json)
        submission = normalize_submission(submission_json, spec)
        if len(submission["sources"]) != 2:
            fail("This isolation probe requires exactly two committed sources")

        def leader_fn():
            return independent_source_checks(submission)

        def validator_fn(leader):
            if not isinstance(leader, gl.vm.Return):
                return False
            try:
                proposed = validate_source_checks(leader.calldata, submission)
                independent = validate_source_checks(independent_source_checks(submission), submission)
                return canonical(proposed) == canonical(independent)
            except gl.vm.UserError:
                return False

        checks = validate_source_checks(gl.vm.run_nondet_default(leader_fn, validator_fn), submission)
        self.receipt = canonical({
            "probe_version": PROBE_VERSION,
            "spec_hash": digest(spec),
            "submission_hash": digest(submission),
            "source_checks": checks,
            "committed_sources": [dict(source) for source in submission["sources"]],
        })

    @gl.public.view
    def get_receipt(self) -> str:
        return self.receipt
'''


def generate():
    business_path = ROOT / "contracts/archive/research_receipt_v4_f5a656.py"
    raw = business_path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != FROZEN_SHA256:
        raise SystemExit("Frozen business source fingerprint changed; review before regenerating")
    business = raw.decode("utf-8")
    header = "\n".join(business.splitlines()[:2])
    # Keep all normalizers and their dependencies byte-for-byte. Do not include
    # any business decision, prompt, assessment or storage implementation.
    prefix = business[business.index("import genlayer as gl"):business.index("\ndef content_fingerprint(")]
    start = business.index("def independent_assessment(")
    fetch = business[business.index("    checks = []", start):business.index("    claims = ", start)]
    result = header + '\n"""Source-only path isolation probe; not a research verdict or model test."""\n\n'
    result += prefix + "\n\ndef independent_source_checks(submission):\n" + fetch + "    return checks\n" + TAIL
    target = ROOT / "contracts/research_receipt_source_probe.py"
    target.write_text(result, encoding="utf-8", newline="\n")
    print(hashlib.sha256(target.read_bytes()).hexdigest())


if __name__ == "__main__":
    generate()
