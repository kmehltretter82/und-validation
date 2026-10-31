# Public verification evidence

The platform publishes a result only after `scripts/generate_index.py` can bind
one successful `tndlib` audit to the exact `main` commit being indexed. This is
a fail-closed display contract, not an independent certification claim. Missing,
malformed, stale, truncated, or changing evidence makes the complete results
section unavailable.

## Reserved production report profile

The generator reserves `production-evidence-v1` for a future reviewed extension
of audit report schema 1. No current `audit/run.py` report satisfies this
profile. A future accepted report must have all of these bindings:

- `base_sha`, `head_sha`, the indexed source commit, the audit workflow run, and
  the report's CI run ID and attempt must all identify the same commit and run.
- The maintained pins must be exact: Lean
  `leanprover/lean4:v4.35.0`, proof-report Lean `4.35.0`, comparator revision
  `e3dcf3083fc53d44b27a4431fabf7d43181583f5`, exporter revision
  `5a9a355dc6c5fd82b69058d433e2ae2e8dfbf8fe`, and build image
  `ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac`.
- The resource boundary must be exactly `host-tmpfs-v1`. Its limit object must
  contain only schema version 1 plus exact integer `build_bytes`,
  `build_inodes`, `export_bytes`, and `export_inodes` values. Byte values must
  be between 4 KiB and 4 GiB; inode values must be between 16 and 1,000,000.
  The accepted numbers are copied into every public evidence record.
- A top-level `certification` object must contain only schema version 1,
  `evidence_profile: production-evidence-v1`, and true
  `source_binding_validated` and `resource_boundary_validated` markers. These
  markers may be emitted only after the corresponding upstream review; merely
  adding their text to a development report is not that review.
- Both source snapshots must contain `TNDLib.lean`, contain only approved
  `TNDLib` Lean paths, have identical file/digest maps for a one-commit audit,
  and match their admission maps. Admission must set `development_only` to
  false and record the reserved `native-linux-validated-v1` isolation profile,
  plus well-formed policy and parser SHA-256 digests.
- Inventory, checker-binary, exporter-binary, base export, and head export
  digests must be well-formed SHA-256 values. Base and head export bytes must be
  identical. Each declaration must also bind the indexed commit and the digest
  of its exact source blob.
- The proof report must have its current schema and pins, a nonempty unique
  declaration inventory, `development_only: false`, the same reserved
  `native-linux-validated-v1` checker-isolation profile, no unreviewed task
  proof, and only `propext` and `Quot.sound` in its permitted and actual axiom
  sets. Displayed declarations additionally require a nonblank statement,
  explanation, attribution, and citation.

The browser validates the public subset again. It requires the same toolchain,
comparator, exporter, image, resource boundary and exact limits; every listed
digest; production profile and validation booleans; admission and checker
isolation markers; source-blob digest; exact source/audit commit; safe source
and audit URLs; and the axiom allowlist. One malformed result makes the results
section unavailable rather than silently dropping that record.

The current upstream report is deliberately rejected: its admissions say
`development_only: true` and `development-docker`, and its proof wrapper says it
cannot be used as certification and does not emit a production checker marker.
Turning on the two policy flags without replacing and validating those
development-only boundaries is insufficient.

## Trust root and reviewed manifest

The platform does not independently prove that an arbitrary 64-hex digest or a
range-valid quota is safe. Its intended trust root is a reviewed, protected
`tndlib/main` production profile plus the exact successful workflow attempt for
the indexed commit. Digest fields preserve provenance inside that decision;
they are not independent allowlist entries today. Likewise, the current numeric
checks reject malformed or unbounded schemas but do not select production
budgets.

Before the first release, the jointly reviewed profile must record the selected
byte/inode values and trusted-input digests (inventory, checker, exporter,
admission policy, and parser) in a versioned manifest keyed by the exact release
commit or immutable profile revision. The generator and browser constants and
fixtures must then require that manifest, not merely a digest shape or allowed
range. Any later policy/binary/budget change creates a new reviewed manifest and
requires a coordinated platform update. Until that exists, current reports
remain unavailable and the site must not describe its digest checks as an
independent certification authority.

## GitHub evidence lookup

Workflow-run searches are read completely, up to a fail-closed ceiling of 999,
before the newest attempt is chosen. A pending or failed newer attempt blocks
fallback to an older successful run.

For the matching successful run, the generator:

1. resolves the `tnd-audit-evidence` release by tag and validates its numeric
   release ID;
2. lists `/releases/{id}/assets?per_page=100&page=...` to completion twice,
   rejecting invalid or duplicate IDs, a ceiling hit, or changes to membership,
   ordering, name, state, size, or download URL;
3. resolves the tag again and requires the same release ID and tag;
4. lists `/actions/runs/{id}/artifacts?name=tnd-audit-report&per_page=100&page=...`
   to the API's reported `total_count` twice, rejecting truncation, count
   changes, duplicate IDs, the ceiling, or changes to security-relevant
   artifact metadata; and
5. requires the exact immutable asset name, repository URL, bounded size, and
   downloaded-byte size and SHA-256 artifact digest before opening the one-file
   `audit.json` archive; and
6. after validating the report, reads the complete workflow-run listing again
   and requires every origin, run ID, attempt, state, conclusion, and timing
   field to be unchanged, so a newly queued or failed rerun cannot race an old
   success into the public index.

This avoids relying on the release object's embedded asset array, whose API
page can omit assets after its default page, and avoids assuming a run has at
most 100 artifacts.

## Readiness and review rule

`tndlib/.choir/certification.json` currently leaves source binding and resource
boundary validation false and provides no production resource limits. In
addition, `audit/run.py` currently consumes development-only admission and
checker wrappers and does not emit the reserved production profile. The guarded
audit therefore cannot emit an accepted production report today, and verified
public results are expected to remain unavailable. Native-Linux boundary
validation, replacement or promotion of the two development-only wrappers,
selected numeric budgets, an actual cross-repository run, and live GitHub Pages
evidence are still required.

Any Lean version, comparator/exporter revision, build-image digest, admission
schema, resource-boundary schema, or audit-report schema change requires an
explicit joint review of `tndlib` and this generator. Update the exact constants,
browser validator, fixtures, and this document together. Until that review is
merged, the intended behavior is an unavailable results section.
