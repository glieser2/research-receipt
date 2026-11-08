# Public reproducibility fixtures

These files contain public source material, public temporary test addresses, and frozen research test inputs. They contain no signing keys. Addresses and client references identify historical experiments; create a fresh isolated account and new references for new tests.

| Packaged file | Original experiment path | SHA-256 |
| --- | --- | --- |
| `bradbury-v3-input.json` | `artifacts/bradbury/v3-e2e-input.json` | `f89ea1dfd5d963c792171a65eb03ed0f8925ead1a15be5a4b46501a85589002e` |
| `bradbury-v4-input.json` | `artifacts/bradbury/v4-e2e-input.json` | `a423530364c4c65fd5c3ef23db2e23f1cefa8a27a587f9dbe692ec0453930dfc` |
| `bradbury-inline-probe-input.json` | `artifacts/bradbury/inline-probe-input.json` | `c9e9884c2467106aa76449f28830f8323e831801450ee0f012bae9429606bb96` |
| `bradbury-v5-input.json` | `artifacts/bradbury/v5-e2e-input.json` | `f34e7384c774f5c048c1343b5f865d738c29df8dbe4f7cfd07c4f776208188d8` |
| `bradbury-typed-probe-input.json` | `artifacts/bradbury/typed-probe-input.json` | `d83ad1fc3877a6dc72ff5f2719ab8ff3ce0abaf253d490a9d5c5551732ec7aa9` |
| `bradbury-structured-probe-input.json` | `artifacts/bradbury/structured-probe-input.json` | `73703b4f60883ae6c51eeca9dd42a4dc945e97d020d88e6616af10679982b0d9` |
| `bradbury-v6-input.json` | `artifacts/bradbury/v6-e2e-input.json` | `0c06e9748c4c60c064991e87da35eb1de7c80f388ce99d2b826ea5a2144eafcc` |

The typed probe is a separate diagnostic schema: buyer-locked review kinds and author claim types, unknown disclosures scoped over both supplied materials, and an explicitly enumerated research boundary. Its `BOUNDARY_DISCLOSED` label does not assert an underlying safety fact. These deliberate schema and scope changes do not alter the v5 fixture or turn the failed v5 positive assessment into a pass. No real typed result is implied by the fixture or stub tests.

The structured fixture removes author-written unknown prose and locks code-owned field IDs. Its unsafe legacy/extra-field/body inputs must be rejected, not cleaned into valid reports. The frozen structured experiment stopped at its fourth leader because rejection was classified differently from its prelocked oracle. The later sufficiency policy reuses these **exact same bytes**: it changes factual/boundary decision semantics and distinguishes declared review basis from model-selected support references. It does not revise the structured experiment's failed expectation or claim that it passed. Actual executions are recorded separately from offline stubs.

`fee-profile-v4-development.json` preserves the profile used by v4 and the source/inline diagnostics, SHA-256 `a6553f6ad12378835b01cc3c632f70e9f451e71fe1439c512beb1be7cd641de3`. v5/v6 use the four-method `src/fee-profile.json` profile, SHA-256 `df9be739a22efd5460db67d6bbb688d0bec87f56f7d163582e4269960ede7415`. Both use 600/600 allocations that are not a measured worst-case resource certification.

The packaged copies preserve the original bytes. Historical plans retain their original paths and hashes; `artifacts/` contains local debugging records and is excluded from the distributable source. The v3 semantic failure remains disclosed in the public simulation evidence. v4 missing-claim input intentionally removes its old unbound paragraph under the new structured-report schema; the plan records that migration.

`v6-compact-build.json` is the exact public build report originally at `artifacts/v6-compact-builds/20261105T134640.219250Z-e053f1b4250b.json`, SHA-256 `5c82e5651cca998c37805560b8707cef7218549942c14a22e053df42c6485131`. It contains the AST/constants/runner checks and offline test result, not a chain proof. The frozen plan keeps its original path; a packaged-source reader may use this byte-identical copy only when the original is absent, never to conceal an altered original.

`candidate-validation-structural.json` belongs to an offline experiment that was not adopted or run as a model accuracy evaluation. Stub tests establish code paths and invariants, not model correctness or committee reliability.

The Ownable and Context source material is from OpenZeppelin Contracts commit `3e6c86392c97fbc30d3d20a378a6f58beba08eba`. Original SPDX notices are preserved; the accompanying MIT license is in `OPENZEPPELIN-LICENSE`. Source commitments prove content integrity, not publisher authority or deployment safety.
