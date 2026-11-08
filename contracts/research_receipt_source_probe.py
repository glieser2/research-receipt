# v0.3.0
# { "Depends": "py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0" }
"""Source-only path isolation probe; not a research verdict or model test."""

import genlayer as gl
from genlayer.types import *
from genlayer.storage import TreeMap
import hashlib
import json
import re
from datetime import date


POLICY_VERSION = "research-receipt/4"
MAX_REVISIONS = 5
MAX_SOURCE_BYTES = 16384
SOURCE_HOST = "raw.githubusercontent.com"
STATUSES = ("SUPPORTED", "CONTRADICTED", "SCOPED_UNKNOWN", "NOT_ESTABLISHED")
EVIDENCE_REQUIREMENTS = ("fact_required", "scoped_unknown_allowed")


def fail(message: str):
    raise gl.vm.UserError(message)


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value) -> str:
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def require_keys(value, required, optional=()):
    if not isinstance(value, dict):
        fail("Expected a JSON object")
    if set(value) - set(required) - set(optional) or set(required) - set(value):
        fail("Missing or unsupported fields")


def text(value, field: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        fail(field + " must be non-empty text")
    if len(value.encode("utf-8")) > maximum or "\x00" in value:
        fail(field + " exceeds its byte limit or contains NUL")
    return value.strip()


def parse_payload(raw: str, maximum: int):
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > maximum:
        fail("JSON payload exceeds byte limit")
    try:
        # Duplicate object keys would make a human-readable commitment ambiguous.
        def unique_pairs(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    fail("Duplicate JSON object key")
                result[key] = value
            return result
        return json.loads(raw, object_pairs_hook=unique_pairs)
    except (ValueError, TypeError):
        fail("Invalid JSON payload")


def positive_int(value, field: str, maximum: int) -> int:
    if type(value) is not int or value < 1 or value > maximum:
        fail(field + " must be a bounded positive integer")
    return value


def normalize_spec(raw: str):
    spec = parse_payload(raw, 12288)
    require_keys(spec, ("title", "protocol", "chain", "as_of", "author", "allowed_hosts", "source_roots", "criteria", "client_ref"))
    result = {name: text(spec[name], name, limit) for name, limit in (("title", 120), ("protocol", 100), ("chain", 100))}
    as_of = text(spec["as_of"], "as_of", 10)
    try:
        if date.fromisoformat(as_of).isoformat() != as_of:
            fail("as_of must be YYYY-MM-DD")
    except ValueError:
        fail("as_of must be a valid YYYY-MM-DD")
    result["as_of"] = as_of
    author = text(spec["author"], "author", 42).lower()
    if not re.fullmatch(r"0x[0-9a-f]{40}", author) or author == "0x" + "0" * 40:
        fail("author must be a non-zero EVM address")
    result["author"] = author
    client_ref = text(spec["client_ref"], "client_ref", 64)
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,64}", client_ref):
        fail("client_ref must be a unique 16 to 64 character identifier")
    result["client_ref"] = client_ref
    if spec["allowed_hosts"] != [SOURCE_HOST]:
        fail("Only raw.githubusercontent.com commit-pinned evidence is supported")
    result["allowed_hosts"] = [SOURCE_HOST]
    roots = spec["source_roots"]
    if not isinstance(roots, list) or not 1 <= len(roots) <= 6:
        fail("source_roots must contain 1 to 6 buyer-approved repository roots")
    result["source_roots"] = []
    for root in roots:
        if not isinstance(root, str) or not re.fullmatch(r"raw\.githubusercontent\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/", root):
            fail("source_roots must be raw.githubusercontent.com/owner/repo/")
        if root in result["source_roots"]:
            fail("Duplicate repository root")
        result["source_roots"].append(root)
    criteria = spec["criteria"]
    if not isinstance(criteria, list) or not 1 <= len(criteria) <= 6:
        fail("Provide 1 to 6 acceptance criteria")
    result["criteria"] = []
    ids = set()
    for criterion in criteria:
        require_keys(criterion, ("id", "text", "required", "evidence_requirement"))
        criterion_id = text(criterion["id"], "criterion id", 32)
        if not re.fullmatch(r"[a-z][a-z0-9_-]*", criterion_id) or criterion_id in ids:
            fail("Criterion ids must be unique lower-case identifiers")
        if type(criterion["required"]) is not bool:
            fail("required must be a boolean")
        if criterion["evidence_requirement"] not in EVIDENCE_REQUIREMENTS:
            fail("evidence_requirement must be fact_required or scoped_unknown_allowed")
        ids.add(criterion_id)
        result["criteria"].append({"id": criterion_id, "text": text(criterion["text"], "criterion text", 600), "required": criterion["required"], "evidence_requirement": criterion["evidence_requirement"]})
    if not any(item["required"] for item in result["criteria"]):
        fail("At least one criterion must be required")
    return result


def validate_source_url(url: str, spec) -> str:
    url = text(url, "source URL", 512)
    # Fixed public origin, no userinfo/ports/query/fragment/percent escapes, no
    # IP literals, and no mutable branch names. This deliberately does not
    # implement a general server-side URL fetcher.
    pattern = r"https://raw\.githubusercontent\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)/([0-9a-fA-F]{40})/([A-Za-z0-9_./-]+)"
    match = re.fullmatch(pattern, url)
    if not match or any(part in ("", ".", "..") for part in url[len("https://"):].split("/")):
        fail("Evidence URL must use a full 40-hex Git commit on the supported HTTPS origin")
    if match.group(1) in (".", "..") or match.group(2) in (".", ".."):
        fail("Invalid repository path")
    roots = spec.get("source_roots", [])
    if roots and not any(url[len("https://"):].startswith(root) for root in roots):
        fail("Evidence repository is outside the locked source roots")
    return url


def normalize_submission(raw: str, spec):
    submission = parse_payload(raw, 28672)
    require_keys(submission, ("report_title", "report_body", "report_version", "sources", "claims"))
    result = {
        "report_title": text(submission["report_title"], "report_title", 160),
        "report_body": submission["report_body"],
        "report_version": text(submission["report_version"], "report_version", 40),
        "sources": [], "claims": [],
    }
    body = result["report_body"]
    if not isinstance(body, str) or len(body.encode("utf-8")) > 12000 or "\x00" in body:
        fail("report_body exceeds its byte limit or contains invalid text")
    sources = submission["sources"]
    if not isinstance(sources, list) or len(sources) > 3:
        fail("At most 3 public sources are supported")
    urls = set()
    for source in sources:
        require_keys(source, ("url", "sha256", "byte_length"))
        url = validate_source_url(source["url"], spec)
        sha = source["sha256"]
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
            fail("sha256 must be 64 lower-case hexadecimal characters")
        if url in urls:
            fail("Duplicate source URL")
        urls.add(url)
        result["sources"].append({"url": url, "sha256": sha, "byte_length": positive_int(source["byte_length"], "byte_length", MAX_SOURCE_BYTES)})
    claims = submission["claims"]
    if not isinstance(claims, list) or len(claims) > len(spec["criteria"]):
        fail("At most one claim per criterion is supported")
    valid_ids = {item["id"] for item in spec["criteria"]}
    seen = set()
    for claim in claims:
        require_keys(claim, ("criterion_id", "statement", "evidence_indices"))
        criterion_id = claim["criterion_id"]
        if not isinstance(criterion_id, str) or criterion_id not in valid_ids or criterion_id in seen:
            fail("Unknown or duplicate claim criterion")
        seen.add(criterion_id)
        indices = claim["evidence_indices"]
        if not isinstance(indices, list) or len(indices) > 3 or any(type(i) is not int or i < 0 or i >= len(sources) for i in indices) or len(set(indices)) != len(indices):
            fail("Invalid evidence indices")
        result["claims"].append({"criterion_id": criterion_id, "statement": text(claim["statement"], "claim statement", 1200), "evidence_indices": sorted(indices)})
    by_id = {claim["criterion_id"]: claim for claim in result["claims"]}
    result["claims"] = [by_id[item["id"]] for item in spec["criteria"] if item["id"] in by_id]
    expected_body = "\n".join(claim["statement"] for claim in result["claims"])
    if body != expected_body:
        fail("report_body must exactly join submitted statements in locked criterion order")
    return result



def independent_source_checks(submission):
    checks = []
    materials = {}
    for index, source in enumerate(submission["sources"]):
        check = {"index": index, "status": "UNAVAILABLE", "sha256": ""}
        try:
            response = gl.nondet.web.request(source["url"], method="GET")
            if response.status == 200 and isinstance(response.body, bytes):
                body = response.body
                actual_hash = hashlib.sha256(body).hexdigest()
                check["sha256"] = actual_hash
                if len(body) > MAX_SOURCE_BYTES:
                    check["status"] = "TOO_LARGE"
                elif len(body) != source["byte_length"] or actual_hash != source["sha256"]:
                    check["status"] = "HASH_MISMATCH"
                else:
                    try:
                        materials[index] = body.decode("utf-8", errors="strict")
                        check["status"] = "VERIFIED"
                    except UnicodeDecodeError:
                        check["status"] = "INVALID_ENCODING"
        except Exception:
            # The result is evidence unavailable, never a successful assertion.
            check["status"] = "UNAVAILABLE"
        checks.append(check)
    return checks


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
