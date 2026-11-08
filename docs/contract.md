# ResearchReceipt contract v5

**Current acceptance gate is failed/incomplete.** The v5 positive evaluation finalized undetermined and its suite stopped. A later, undeployed typed diagnostic exposed a validator accepting an unsupported promise; full comparison rejected that pair. See [v5 attempts](evidence/bradbury-v5-attempt.json) and [typed simulations](evidence/typed-probe-simulations.json). The descriptions below specify implemented rules, not proof of general semantic accuracy. A separate structured-disclosure experiment is not yet adopted into this contract.

`contracts/research_receipt.py` is a GenLayer Python Intelligent Contract. It owns
the research-delivery assessment: the frontend supplies locked claims and evidence
references, not a precomputed verdict. There is no custody, escrow, payout, token
issuance, investment recommendation, or claim that a protocol is safe.

The frozen source records `policy_version: "research-receipt/5"`, SHA-256
`60b89ea573ca9abba76c4432c0ae38195c5405e85bad7f492b77000d9b6b9d65`.
V5 adds a separate immutable-source verification step. Every criterion requires an explicit
`evidence_requirement`, findings contain code-derived `delivery_status`, and the
body is now strictly derived from bound statements. Legacy inputs are not silently
converted to this policy. V5 is independently deployed at
`0xF21F4c3e49963a093F7e5b4De414f43E503f09B5`, with zero-order baseline verified.
The [24-case v5 plan](evidence/v5-validation-plan.json) is in progress, so business
E2E is not complete. Earlier v4 simulations and isolation diagnostics do not verify
this new transaction boundary or establish general model reliability.
V1 (`3817bc2c658b5c5501e50b39263cd3291eaa8e6b29181110007ccb352ecb32c3`)
and v2 (`cec6eb14adace3dcdb1034ffa71b9a758fd147c1722a49b67daa40d37212b745`)
archives and receipts retain their original policies. Both have verified public
deployments, but public business E2E remains incomplete after model disagreement.
V3 was not deployed. Its first real negative paired simulation failed semantic
validation: both models marked an incorrect permissions statement `SUPPORTED`,
and another criterion disagreed. The remaining two planned pairs were stopped.
Its frozen source, 11-case plan, fixture and failed outputs remain archived. V4's
bounded observations do not establish the root cause of that failure or eliminate
semantic risk; see [validation](validation.md) and [public simulation evidence](evidence/public-semantic-simulations.json).
V4 is archived at `contracts/archive/research_receipt_v4_f5a656.py`; its public
committee assessment failed despite the observed leader matching the oracle.
Source-only and fixed-inline diagnostics have separate successful proofs, with
one inline validator disagreement retained. No single failure cause is proven.

## Trust boundary

The buyer creates an immutable order, specifying a non-zero author address and
acceptance criteria. The author accepts those terms by submitting a revision. Only
that author can submit; the buyer cannot silently rewrite the criteria or sources.
Only the buyer or locked author may verify evidence or request the current revision's assessment.
An unrelated party cannot force the one-shot assessment before the parties are
ready, even if that party is willing to pay the protocol fee.

The initial evidence policy is deliberately narrow: public UTF-8 text from
`https://raw.githubusercontent.com/OWNER/REPO/FULL_40_HEX_COMMIT/PATH` only.
Credentials, IP literals, custom ports, queries, fragments, percent-encoded paths,
dot traversal, mutable branches and other origins are rejected before web access.
At least one buyer-approved repository root is mandatory; the author cannot
select an unrelated repository on the same host.

An accepted hash proves consistency with the submitted bytes, not authorship,
official publisher identity, historical availability, or real-world truth. The
buyer must review the repository identity and evidence roots. A commit pin does
not prove when the content became available or that an old version describes a
current deployment. No snapshot date is invented. A literal statement about the
exact pinned commit's contents can be supported by those contents. Claims about
publication time, what held on the order's `as_of` date, current freshness or an
actual deployment still need appropriate evidence; a commit pin alone does not
establish them. Unsupported temporal/deployment assertions remain insufficient.

The fixed origin avoids creating a general URL-fetch service. The underlying
GenVM web service's response-size, redirect and DNS behavior remain a deployment
verification item. The contract rejects oversized bodies after receipt; it cannot
guarantee that network transfer was bounded before the body arrived. Do not expand
origins without an independent fetch-security review.

## Public API

All mutation methods are non-payable (`@gl.public.write`). SDK arguments are JSON
strings, regular integers, or the client reference string. Order IDs and revision
numbers start at 1.

| Method | Arguments | Return |
| --- | --- | --- |
| `create_order` | `spec_json: str` | order ID |
| `get_order_id` | `client_ref: str` | exact ID, or 0 if not found |
| `submit_revision` | `order_id: int, submission_json: str` | revision number |
| `verify_evidence` | `order_id: int, revision: int` | no return value; read immutable snapshot |
| `evaluate` | `order_id: int, revision: int` | requires snapshot; no source HTTP; read assessment |
| `get_order` | `order_id: int` | JSON record; missing order is an error |
| `get_revision` | `order_id: int, revision: int` | JSON record; missing revision is an error |
| `get_assessment` | `order_id: int, revision: int` | JSON record, or empty string before assessment |
| `get_evidence_snapshot` | `order_id: int, revision: int` | JSON snapshot, or empty string before verification |
| `get_order_count` | none | integer count |

Use a fresh UUID `client_ref` for each order and resolve it with `get_order_id`
after transaction finalization. Never use the global order count to discover the
ID of your own concurrently created order. References are globally unique;
duplicate references are rejected. They are correlation identifiers, not secrets
or ownership credentials.

### Order specification

```json
{
  "client_ref": "a-client-generated-uuid",
  "title": "Withdrawal and control review",
  "protocol": "An example DeFi protocol",
  "chain": "Ethereum",
  "as_of": "2026-11-04",
  "author": "0x2222222222222222222222222222222222222222",
  "allowed_hosts": ["raw.githubusercontent.com"],
  "source_roots": ["raw.githubusercontent.com/OWNER/REPO/"],
  "criteria": [
    {
      "id": "permissions",
      "text": "Identify who can pause withdrawals and cite the pinned code or documentation.",
      "required": true,
      "evidence_requirement": "fact_required"
    }
  ]
}
```

`source_roots` is required and must contain 1–6 repository roots reviewed by the
buyer. Empty or omitted roots are rejected. Roots have no scheme and must end in
`/` after the repository name. A root locks repository identity but does not
independently prove that the repository is an official publisher.
`as_of` must be a valid `YYYY-MM-DD` no later than the order transaction date.
At least one criterion must be required. Criterion IDs match `[a-z][a-z0-9_-]*`.
Unknown fields and duplicate JSON keys are rejected.

Every criterion must include `evidence_requirement`, exactly `fact_required` or
`scoped_unknown_allowed`; omission and unknown values are rejected. The first
requires the underlying requested facts; the second permits a complete, accurate
disclosure of the submitted materials' unknown scope. This field is locked by the
buyer and cannot be replaced by an instruction in the criterion's natural text.

### Revision submission

```json
{
  "report_title": "Withdrawal controls",
  "report_body": "The bounded factual claim made by the report.",
  "report_version": "1.0",
  "sources": [
    {
      "url": "https://raw.githubusercontent.com/OWNER/REPO/0123456789abcdef0123456789abcdef01234567/README.md",
      "sha256": "64 lower-case hexadecimal characters of the exact source response bytes",
      "byte_length": 1234
    }
  ],
  "claims": [
    {
      "criterion_id": "permissions",
      "statement": "The bounded factual claim made by the report.",
      "evidence_indices": [0]
    }
  ]
}
```

This is a schema illustration, not fetchable evidence; replace every placeholder.
`report_body` must exactly equal all submitted normalized `claim.statement` values,
joined by one newline in the order of the locked criteria. Claim arrays are
normalized into that same order. Statement text is trimmed under the existing
text rules; body text itself is not silently trimmed or corrected. Extra paragraphs,
surrounding whitespace, reordered body text or missing-claim analysis hidden in
the body are rejected. With zero submitted claims, only `""` is a valid body;
the omitted criteria receive deterministic `NOT_ESTABLISHED`. Titles and external
report links are not accepted report content. This is structured statement
acceptance, not a separate free-form full-report audit.

The canonical body is committed directly, not read from an unversioned website.
Sources use SHA-256 of raw response bytes, not browser-rendered
HTML, normalized text, or a hexadecimal string with a `0x` prefix. Byte lengths
are UTF-8 bytes, not JavaScript string lengths. Each criterion has at most one
claim; omitted claims remain explicitly insufficient. Evidence indices are
zero-based and identify the listed source records.

| Input | Limit |
| --- | --- |
| Order JSON | 12,288 UTF-8 bytes |
| Submission JSON | 28,672 UTF-8 bytes |
| Title / protocol / chain | 120 / 100 / 100 bytes |
| `client_ref` | 16–64 ASCII `[A-Za-z0-9_-]` characters |
| Criteria | 1–6, each text at most 600 bytes; ID at most 32 bytes |
| Repository roots | 1–6, required |
| Report title / body / version | 160 / 12,000 / 40 bytes |
| Sources | at most 3; each at most 16,384 bytes; URL at most 512 bytes |
| Claims | at most one per criterion; statement at most 1,200 bytes |
| Revisions | at most 5 per order |

Non-empty text fields other than the strictly matched body are trimmed before the canonical commitment. The stored
normalized JSON is the authoritative payload. Numeric fields require actual JSON
integers; booleans and strings are not coerced to integers.

### Read record shapes

`get_order` returns:

```text
{id, owner, spec, spec_hash, policy_version, revision_count, status, created_at}
```

`get_revision` returns:

```text
{order_id, revision, submission, submission_hash, content_hash,
 previous_submission_hash, submitted_by, submitted_at}
```

`get_assessment` returns:

```text
{order_id, revision, spec_hash, submission_hash, content_hash, snapshot_hash, policy_version, assessed_at, scope,
 verdict,
 findings: [{criterion_id, status, delivery_status, evidence_indices, reason}],
 source_checks: [{index, status, sha256}]}
```

Source-check statuses are `VERIFIED`, `UNAVAILABLE`, `TOO_LARGE`, `HASH_MISMATCH`
and `INVALID_ENCODING`. The check's `sha256` is the actually fetched hash, or `""`
when no body could be checked. Source failures cannot produce substantive support
or contradiction for a claim citing that source.
Indices must be consecutive integers in source-input order. Hashes are empty or
64 lower-case hex characters; every status except `UNAVAILABLE` requires a hash.
`VERIFIED` must match the committed hash; other non-empty hashes describe the
actually received bytes. `UNAVAILABLE` may retain a computed hash if a later
fetch-processing exception occurred, preserving the frozen fetch semantics.

`get_evidence_snapshot` returns the following canonical record. Its public material
strings are exact decoded UTF-8, without trimming, newline conversion or Unicode
normalization; failed entries are strictly `null`:

```text
{snapshot_version: "research-receipt/evidence-snapshot/1",
 binding: {policy_version: "research-receipt/5", order_id, revision,
           spec_hash, submission_hash, content_hash,
           sources: [{url, sha256, byte_length}]},
 source_checks: [{index, status, sha256}],
 materials: [text_or_null], snapshot_hash}
```

`snapshot_hash` is SHA-256 of canonical JSON for every field above except the hash
itself (`ensure_ascii=False`, sorted keys, compact separators, UTF-8). The binding
is rebuilt from the current chain order/revision and their recomputed commitments;
there is no public API accepting an author-supplied snapshot or inline bytes.
All source commitments are bound in input-index order, including unused sources.
Clients must also bind exported receipt provenance to the selected network and
contract; snapshots cannot be imported across deployments.

## Decision and consensus policy

The model classifies evidence as `SUPPORTED`, `CONTRADICTED`, `SCOPED_UNKNOWN`,
or `NOT_ESTABLISHED`. A missing claim becomes deterministic `NOT_ESTABLISHED`;
unavailable, mismatched or otherwise unverified cited sources become code-only
`SOURCE_UNAVAILABLE`, without a model call or repair for that claim. V5 separates
source provenance and semantic judgment into two transactions:

1. `verify_evidence` independently executes the frozen raw HTTP fetch/check loop in
   leader and validator. The validator requires `Return`, validates complete check
   shape, ordered indices and hashes, independently fetches again, and compares
   the entire checks/materials result. Every `VERIFIED` material must re-encode
   to exactly the committed SHA-256 and byte length within 16 KiB. Every other
   status requires `null` material; hidden or unused material is rejected. The
   chain stores the accepted, fully bound snapshot once, including failure checks.
2. `evaluate` requires that chain snapshot. Before any model call, each independent
   side rechecks its binding, fingerprint and all material UTF-8/hash/length
   commitments, then executes the unchanged criterion prompt/model loop. It makes
   zero source HTTP requests. Bad or unavailable evidence remains ineligible;
   the model cannot replace a failed source with an unknown disclaimer or support.

During evaluation the validator independently revalidates snapshot bytes and
reruns the semantic task, rather than re-fetching HTTP. It validates the leader's full result shape and
compares the verdict, per-criterion evidence status, derived delivery status,
evidence indices and source checks. It recomputes delivery rather than trusting
the leader's supplied field. Matching overall verdicts alone do not suffice.
It does not merely validate a JSON enum or trust a model confidence score.
Reason wording may differ. Substantive findings require verified source references.
If evidence choice or classification differs, the validator disagrees. This is
conservative and may cause a protocol-level undetermined result; it does not imply
perfect model accuracy.

### Criterion isolation and evidence scope

Each prompt names the current criterion and includes only its `id`, `text` and
`required` fields, current claim and verified selected sources, plus necessary
protocol/chain/as_of metadata. Full report body, other claims, other criterion
text, titles and unselected sources are excluded. `evidence_requirement` is
completely excluded: changing only buyer
policy produces byte-identical prompts and must not change evidence classification.
No desired delivery status or aggregate verdict is sent. The short prompt requires
judging the exact assertion, including negations: it must not first correct a false
claim and then label that corrected claim supported, or equate discussing a topic
with proving it. A neutral, valid JSON Schema lists all four labels rather than
anchoring the output with one `SUPPORTED` example. It prints the exact allowed
zero-based evidence-index integer array for that call. Strings, decimals,
booleans, duplicate references and references outside the selected verified set
are rejected without coercion or renumbering. `SUPPORTED`, `CONTRADICTED` and
`SCOPED_UNKNOWN` require at least one verified reference. `NOT_ESTABLISHED` may use
an empty array. The model returns exactly `status`, `evidence_indices`, `reason`;
`delivery_status` and `SOURCE_UNAVAILABLE` are not valid model output.

Before either `SUPPORTED` or `SCOPED_UNKNOWN`, the current statement must
cover every materially requested part of this criterion. A true but irrelevant
file-name detail or permissions analysis omitting a requested upgrade mechanism
is `NOT_ESTABLISHED`; a scope disclaimer does not waive buyer requirements.
`SUPPORTED` additionally requires all materially requested facts to be established,
with none reported unknown, and source support for every substantive assertion.
`SCOPED_UNKNOWN` requires complete, accurate disclosure of the requested unknowns
and needed known content within the submitted-material scope, including at least
one accurately unknown requested fact; all others must be established or accurately
unknown. Out-of-scope deployment disclaimers do not count as requested unknowns.
An arbitrary unknown
sentence, omitted analysis, or unknown text mixed with an unsupported assertion or
promise cannot qualify. A genuinely refuted assertion remains `CONTRADICTED`,
even when other coverage is missing.

Code derives delivery after evidence classification:

| Evidence status | `fact_required` | `scoped_unknown_allowed` |
| --- | --- | --- |
| `SUPPORTED` | `FULFILLED` | `FULFILLED` |
| `CONTRADICTED` | `CONTRADICTED` | `CONTRADICTED` |
| `SCOPED_UNKNOWN` | `INSUFFICIENT` | `FULFILLED` |
| `NOT_ESTABLISHED` / `SOURCE_UNAVAILABLE` | `INSUFFICIENT` | `INSUFFICIENT` |

A scoped unknown is not proof of the underlying fact. No policy can turn a
contradiction, absent claim or failed source into fulfilled delivery.

The prompt distinguishes exact-commit source-content statements from historical
or current deployment assertions. These are instructions governing a model's
interpretation, not a deterministic proof of its semantic correctness. Independent
validator re-evaluation and full stable-field comparison remain required.

### One bounded output-format repair per independent assessment

For each eligible criterion, the first output passing pure parsing, schema and
reference validation is used immediately, including a legal `CONTRADICTED` or
`SCOPED_UNKNOWN` or `NOT_ESTABLISHED` result. There is no retry to select a more favorable verdict.

One additional `exec_prompt` call is permitted **for the entire
`independent_assessment` invocation**, not one per criterion. It can be consumed
only by an invalid returned candidate: JSON parsing, exact output keys/status,
reason's existing hard boundary or reference format. The repair repeats the same
original prompt and already fetched source evidence, adding a fixed error code
and neutral formatting instruction. It never concatenates the previous model's
free text or a suggested favorable status. A second invalid output, or a later
invalid criterion after that budget was consumed, fails closed. Provider I/O or
resource exceptions arise outside pure decoding and are not retried by this path.

Reasons are requested to be a single line of at most 120 characters to reduce
unnecessary output. **This is generation guidance only.** The hard constraint
remains the prior non-empty text, 800 UTF-8 byte and no-NUL boundary. A 150-character
or multiline reason within that boundary does not trigger repair; reason prose
does not participate in consensus matching. Oversized/invalid reason text still
fails structural validation, without truncation or a default verdict.

Each leader/validator independent invocation has its own identical one-repair
budget. With at most six eligible criteria, one invocation makes at most seven
model calls; actual protocol rounds/validators can multiply that work and must
be profiled separately. No nested nondeterministic block was added: the existing
`run_nondet_default` callback directly performs its phase's operations: web only
for verification and models only for assessment. Source bounds,
hash checks, permissions, revision/replay rules, assessment validation and the
full stable result projection, including derived delivery, remain enforced.

The final application verdict is deterministic, using code-derived delivery:

1. Any contradicted **required** criterion → `NOT_ACCEPTED`.
2. Otherwise, any insufficient **required** criterion → `INSUFFICIENT_EVIDENCE`.
3. Otherwise, any contradicted optional criterion → `REVISION_REQUIRED`.
4. Otherwise → `ACCEPTED`. Insufficient optional criteria remain visible and do
   not prevent acceptance of all required work.

The LLM cannot select the overall verdict independently. Documents, claims and
reports are explicitly treated as untrusted material; criterion text cannot
override the fixed policy or source checks. This is input hygiene, not proof of
prompt-injection immunity. Real adversarial-model evaluation is still required.

## Revisions and lifecycle

Orders begin `OPEN`; author submission moves them to `SUBMITTED`. Evaluation
records one immutable assessment for the current revision and updates order
status to its verdict. Repeated evaluation after a stored assessment is rejected.
Verification is restricted to the owner or locked author and the current revision,
with no existing assessment or snapshot. It leaves order status `SUBMITTED`; UI
phase is derived from snapshot presence and assessment presence. Evaluation before
verification, repeated verification and cross-revision snapshot reuse fail before
source/model work. After assessment, both records remain immutable.

**Failure snapshots are one-shot too.** A transient HTTP failure can therefore
lock that revision's evidence as unavailable. It must be assessed with the failed
source ineligible, then genuinely corrected evidence/research can use a new bounded
revision. Title/version-only changes and meaningless paraphrasing are not an
approved recovery workflow. Identical content cannot be resubmitted merely to
re-fetch availability. A better bounded-attempt mechanism would require a separate
review; none is silently added here. A reverted/undetermined verification has not
stored a snapshot and must stay unresolved in the UI until its transaction outcome
is known. An evaluation failure does not erase a snapshot committed by the earlier
verification transaction.
An accepted order is closed. A non-accepted order may receive a new version, up
to five revisions, only after the previous revision has an assessment. Each
revision links the preceding submission hash and preserves all prior records.
`submission_hash` commits the entire normalized submission, including its title
and version. A separate `content_hash` excludes those two labels and canonicalizes
source ordering and citation indices by source identity, and claim ordering by
criterion ID. Every new revision is checked against **all** earlier content
hashes: changing only title/version, rearranging equivalent source/citation
arrays, or replaying A after A→B cannot buy another assessment. Report version
labels must also be unique within an order.

This bounds successful re-evaluation attempts but does not prove complete
resistance to model-output selection: prose changes are not semantically
canonicalized, and failed/reverted/undetermined transactions
cannot increment a committed counter, and network protocol retries remain under
protocol rules. Revisions deliberately permit corrected evidence, including
recovery after source unavailability, within the cap. The buyer should inspect
the complete history rather than only the last result.

The contract's application status is distinct from transaction consensus status.
The frontend must wait for protocol finality, inspect execution success and
re-read finalized application state. A mined EVM transaction or `Accepted`
consensus status is not a final successful assessment. Protocol appeals can alter
non-final state; there is no separate application-level appeal contract.

## Verification performed and remaining gates

Run the local deterministic suite with:

```powershell
python -m unittest discover -s tests/python -v
```

The suite injects a small `genlayer` stub solely to execute the real Python module
and independently invoke leader and validator functions. It covers role checks,
unique client references, revision history, URL policy, malformed input/model
output, hash failures, missing/oversized/invalid-UTF-8 sources, disagreement,
verdict precedence and prompt construction. It is **not** a GenVM, consensus,
fee, model-accuracy, or on-chain E2E test.

The current production business suite has 90 passing stub tests, including the
prior permissions/source/replay/repair properties, v3 explicit-policy validation,
delivery mapping, policy-blind paired prompts, forged-delivery refusal, full
evidence-status comparison, coverage counterexamples, strict body binding,
claim-order normalization, single-item prompt isolation and mutually exclusive
requested-fact status instructions.
The 19 additional v5 cases cover record/binding rehashing, forged verified bytes,
unused material, null/status mapping, immutable failure snapshots, cross-order and
cross-revision reuse, pre-verification rejection, zero-HTTP assessment and the
unchanged four prelocked semantic oracles under scripted responses. The complete Python
discovery run has 125 passing tests: 90 business, 12 unadopted candidate-probe,
11 source-only and 12 inline diagnostic stubs. The 35 experimental/isolation
checks must not be counted as production model
validation. Scripted outputs prove control flow and validation properties, not
real-model accuracy, better consensus rates or lower fees. V3's first negative pair
failed and is preserved. V4 negative/positive/strict-unknown pairs each ran exactly
once (6 `gen_call`, 24 `exec_prompt`) and matched their prelocked results. These
unsigned simulations are not deployment or transaction proof. The separate v4
deployment proof verifies source/finality/execution/block and order count 0; its
public committee assessment later failed. Source-only and inline-source probes
subsequently passed their own independent full-receipt gates, without proving the
original cause. V5 has a new verified deployment/zero baseline and a prelocked
24-case plan; signed business E2E is still in progress.

Before a contribution claims live contract verification, preserve: exact
deployment source/SDK/network identity; deployment transaction and address;
create/submit/evaluate transaction hashes and finalized successful receipts;
post-finalization reads; normal, contradictory and unavailable-source examples;
and representative fee profiles. Stub tests do not establish these gates.

## Official references used for implementation

- [Storage reference](https://docs.genlayer.com/developers/intelligent-contracts/features/storage)
- [Equivalence principle and independent validation](https://docs.genlayer.com/developers/intelligent-contracts/equivalence-principle)
- [Web access](https://docs.genlayer.com/developers/intelligent-contracts/features/web-access)
- [Calling LLMs](https://docs.genlayer.com/developers/intelligent-contracts/features/calling-llms)
- [Transaction context](https://docs.genlayer.com/developers/intelligent-contracts/features/transaction-context)
- [Address type](https://docs.genlayer.com/developers/intelligent-contracts/types/address)

The contract currently targets `# v0.3.0` and pins
`py-genlayer:babwp9t37jw9g4j2bccgn14g6x7x9s1f7dsmh7emvz735pz4zxa0`.
This pin is matched to the official executor revision identified below and was
selected after the integration owner successfully introspected a minimal Storage
contract with it on the development endpoint. This is not yet evidence that every
ResearchReceipt method has run on that endpoint.

The migrated API uses `import genlayer as gl`, types from `genlayer.types`,
`TreeMap` from `genlayer.storage`, `gl.contract.Contract`, `gl.vm.UserError`,
and `gl.message.raw['datetime']`. Sized integers are annotation metadata and are
not called as runtime constructors. HTTP reads use
`gl.nondet.web.request(url, method='GET')`, whose response fields are `status`
and `body`; `body` must be bytes. The custom validator still receives
`gl.vm.Return` and reads `.calldata`. `run_nondet_default` runs the validator in
an additional sandbox; the local stub checks the leader/validator control flow
but does not simulate that sandbox or its error semantics.
This is an intentional selection of the SDK's recommended error-isolated custom
validation API, not a rename of the old unsafe function. The two positional
arguments match the pinned implementation. Both callbacks capture only parsed
in-memory specification/submission and bound snapshot dictionaries and call stateless helpers; they
neither capture `self` nor read or write contract storage or send messages. The
validator first requires a successful `Return`; source verification independently
fetches, while evaluation independently revalidates the stored bytes and reruns
the model task. Failed or malformed leader/model results cannot become an
application verdict. Default error-comparison hooks and `catch_vm_error=False`
are left unchanged; real `evaluate` execution must still verify sandbox behavior
against the pinned runtime before this integration is claimed complete.

- [Pinned official v0.3 SDK VM implementation](https://github.com/genlayerlabs/genvm-executor/blob/536c58ffd517e1548db33807e81f5047b7c7e79e/runners/genlayer-py-std/src/genlayer/vm/__init__.py)
- [Pinned HTTP API](https://github.com/genlayerlabs/genvm-executor/blob/536c58ffd517e1548db33807e81f5047b7c7e79e/runners/genlayer-py-std/src/genlayer/nondet/web.py)
- [Pinned transaction context](https://github.com/genlayerlabs/genvm-executor/blob/536c58ffd517e1548db33807e81f5047b7c7e79e/runners/genlayer-py-std/src/genlayer/message.py)

### Development-network compatibility check (2026-11-05)

Initially schema introspection was blocked on
`https://studio-dev.genlayer.com/api`. The integration owner observed GenVM
`v0.3.0-rc10` returning `invalid_contract runner malformed` for both this contract
and the current official minimal Storage example. The same default runner
identifier appeared in both failures. This isolates the observed blocker to the
server runner/introspection path; it does not prove this contract is otherwise
compatible or justify reporting a successful deployment.

Source inspection found the official Studio repository's current main sample uses
`# v0.3.0`, dependency
`py-genlayer:9b8kjyda2ycxyq4ea6g4yfpnydxhd52gqba5rb8dw7krkh5mn9p0`,
`import genlayer as gl`, and `gl.contract.Contract`. The older documentation and
boilerplate still show the previous dependency/import style. Later testing by the
integration owner found the `babwp9...` pin above succeeds for a minimal Storage
schema, whereas the current-main `9b8...` sample does not on the chosen endpoint.
ResearchReceipt was consequently migrated to the supported v0.3 API and that
specific pin. V1 subsequently completed hosted development E2E and public
Bradbury deployment. Its initial public business assessment attempts were
undetermined; one observed failure included invalid model evidence references.
That operational evidence motivated the v2 output instructions and bounded
repair, without loosening source verification or consensus comparison.
V2 subsequently passed independent public deployment verification, but its scope
negative assessment also encountered model disagreement. Public business E2E is
not complete. V3 separated evidence classification from buyer policy but its first
negative simulation failed semantics and was stopped. V4 additionally binds the
body to statements and removes cross-item/full-report model context. Three bounded
v4 pairs and its deployment passed separate gates, but its public committee later
failed. Two isolation diagnostics then passed their own receipt gates. V5's staged
snapshot implementation and deployment have been independently reviewed, while
the new 24-case business suite remains incomplete. Historical receipts retain their own policy
meaning, and no version has a blanket model-safety guarantee.

- [Pinned official Storage sample](https://github.com/genlayerlabs/genlayer-studio/blob/c94072951e483510329670aa427fba3fa6944f45/examples/contracts/storage.py)
- [Pinned runner header and version specification](https://github.com/genlayerlabs/genvm-manager/blob/f684cfdea3413c491781a7540f56fe18663d5dec/docs/website/src/spec/02-execution-environment/04-runners.rst)

The integration owner retains actual request/response artifacts and runs the
version-specific schema, deployment and E2E checks. Do not substitute a successful
minimal sample or the local stub suite for those ResearchReceipt-specific results.
