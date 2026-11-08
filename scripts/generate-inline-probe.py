"""Generate an HTTP-free diagnostic from the exact frozen v4 business source.

No network, model or chain access. Only the separate inline-probe file is written.
"""
from pathlib import Path
import hashlib

ROOT = Path(__file__).resolve().parents[1]
FROZEN_SHA256 = "f5a656c23224a4cff7c9f87f2a04c24efd7b4a413a7f0a0449c2a1c7c5408c61"

INLINE_HELPERS = '''

PROBE_VERSION = "research-receipt/inline-source-probe/1"
PROBE_CRITERIA = ("permissions", "withdrawals", "audit", "limitations")
FIXED_SOURCES = [
    {"url": "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/3e6c86392c97fbc30d3d20a378a6f58beba08eba/contracts/access/Ownable.sol", "sha256": "38578bd71c0a909840e67202db527cc6b4e6b437e0f39f0c909da32c1e30cb81", "byte_length": 3102},
    {"url": "https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/3e6c86392c97fbc30d3d20a378a6f58beba08eba/contracts/utils/Context.sol", "sha256": "9c1cc43aa4a2bde5c7dea0d4830cd42c54813ff883e55c8d8f12e6189bf7f10a", "byte_length": 860},
]


def verified_inline_sources(submission, inline_materials):
    if submission["sources"] != FIXED_SOURCES:
        fail("Inline probe requires the two fixed source commitments in exact order")
    if not isinstance(inline_materials, (list, tuple)) or len(inline_materials) != 2:
        fail("Exactly two UTF-8 inline materials are required")
    checks = []
    materials = {}
    for index, (source, material) in enumerate(zip(submission["sources"], inline_materials)):
        if not isinstance(material, str):
            fail("Inline material must be UTF-8 text")
        try:
            body = material.encode("utf-8", errors="strict")
        except UnicodeError:
            fail("Inline material is not valid UTF-8")
        actual_hash = hashlib.sha256(body).hexdigest()
        if len(body) > MAX_SOURCE_BYTES or len(body) != source["byte_length"] or actual_hash != source["sha256"]:
            fail("Inline material does not match the fixed source bytes")
        materials[index] = material
        checks.append({"index": index, "status": "VERIFIED", "sha256": actual_hash})
    return checks, materials
'''

CTOR_PREFIX = '''

class ResearchReceiptInlineProbe(gl.contract.Contract):
    receipt: str
    assessment: str

    def __init__(self, input_json: str):
        payload = parse_payload(input_json, 65536)
        require_keys(payload, ("spec", "submission", "materials"))
        spec = normalize_spec(canonical(payload["spec"]))
        submission = normalize_submission(canonical(payload["submission"]), spec)
        if tuple(item["id"] for item in spec["criteria"]) != PROBE_CRITERIA:
            fail("Inline diagnostic requires all four criteria in their locked order")
        if tuple(item["criterion_id"] for item in submission["claims"]) != PROBE_CRITERIA or any(not item["evidence_indices"] for item in submission["claims"]):
            fail("Inline diagnostic requires four bound claims with verified references")
        if not isinstance(payload["materials"], list):
            fail("materials must be an indexed JSON array")
        inline_materials = tuple(payload["materials"])
        # Deterministic rejection before any nondeterministic block/model call.
        verified_inline_sources(submission, inline_materials)

'''

CTOR_SUFFIX = '''
        self.assessment = canonical(assessment)
        self.receipt = canonical({
            "probe_version": PROBE_VERSION,
            "spec_hash": digest(spec),
            "submission_hash": digest(submission),
            "assessment": stable_projection(assessment),
        })

    @gl.public.view
    def get_receipt(self) -> str:
        return self.receipt

    @gl.public.view
    def get_assessment(self) -> str:
        return self.assessment
'''


def generate():
    raw = (ROOT / "contracts/archive/research_receipt_v4_f5a656.py").read_bytes()
    if hashlib.sha256(raw).hexdigest() != FROZEN_SHA256:
        raise SystemExit("Frozen v4 source changed; review before regenerating")
    business = raw.decode("utf-8")
    prefix = business[business.index("import genlayer as gl"):business.index("def independent_assessment(")]
    loop_start = business.index("    claims = ", business.index("def independent_assessment("))
    loop_end = business.index("\n\ndef stable_projection(", loop_start)
    loop = business[loop_start:loop_end]
    validation = business[business.index("def stable_projection("):business.index("class ResearchReceipt(")]
    callback_start = business.index("        def leader_fn():", business.index("    def evaluate("))
    callbacks = business[callback_start:business.index("        assessment.update(", callback_start)]
    callbacks = callbacks.replace("independent_assessment(spec, submission)", "independent_assessment(spec, submission, inline_materials)")
    header = "\n".join(business.splitlines()[:2])
    result = header + '\n"""Fixed inline-source, full four-task diagnostic; constructor inputs are public."""\n\n'
    result += prefix + INLINE_HELPERS + "\n\ndef independent_assessment(spec, submission, inline_materials):\n"
    result += "    checks, materials = verified_inline_sources(submission, inline_materials)\n" + loop
    result += "\n\n" + validation + CTOR_PREFIX + callbacks + CTOR_SUFFIX
    target = ROOT / "contracts/research_receipt_inline_probe.py"
    target.write_text(result, encoding="utf-8", newline="\n")
    print(hashlib.sha256(target.read_bytes()).hexdigest())


if __name__ == "__main__":
    generate()
