#!/usr/bin/env python3
"""Build a public index from GitHub issues and independently verifiable audit evidence.

The platform workflow runs this trusted code. The library's public release asset
is accepted only if its bytes match the digest of an artifact from a successful
audit-main workflow run for the exact current main commit. No untrusted code is
executed and a missing report never creates a certified result.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
from datetime import datetime, timezone
from urllib import error, parse, request
import zipfile

REPO = "kmehltretter82/tnd-validation"
API = f"https://api.github.com/repos/{REPO}"
WORKFLOW = ".github/workflows/audit-main.yml"
RELEASE_TAG = "tnd-audit-evidence"
ALLOWED_AXIOMS = {"propext", "Quot.sound"}
COMPARATOR = "e3dcf3083fc53d44b27a4431fabf7d43181583f5"
EXPORTER = "5a9a355dc6c5fd82b69058d433e2ae2e8dfbf8fe"
TOOLCHAIN = "leanprover/lean4:v4.35.0"
PROOF_TOOLCHAIN = "4.35.0"
BUILD_IMAGE = "ubuntu@sha256:68ee22004a9109b44973313b02ff7b1de250f1de0f5ecb628d73f579aaff33ac"
RESOURCE_BOUNDARY = "host-tmpfs-v1"
# Reserved for a jointly reviewed upstream schema transition. Current tndlib
# reports explicitly identify admission/checker wrappers as development-only,
# so they must never satisfy these publication markers.
EVIDENCE_PROFILE = "production-evidence-v1"
PRODUCTION_ISOLATION = "native-linux-validated-v1"
DECLARATION_KINDS = {
    "theorem", "definition", "axiom", "opaque", "inductive", "constructor", "recursor", "quotient",
}
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
SOURCE_PATH = re.compile(r"TNDLib/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.lean\Z")
LIBRARY_SOURCE_PATH = re.compile(r"(?:TNDLib\.lean|TNDLib/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.lean)\Z")
MAX_JSON = 4 * 1024 * 1024
MAX_ARCHIVE = 8 * 1024 * 1024
# Filtered workflow-run searches have a 1,000-result API ceiling. Refuse that
# boundary rather than assume an inaccessible older rerun cannot be newer.
MAX_AUDIT_RUNS = 999
MAX_RELEASE_ASSETS = 999
MAX_RUN_ARTIFACTS = 999
MAX_OPEN_ISSUES = 1999
PROPOSAL_LABEL = "tnd/proposal"


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class SafeRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = parse.urlsplit(req.full_url), parse.urlsplit(newurl)
        hosts = ("github.com", "api.github.com", "githubusercontent.com")
        if (new.scheme != "https" or not new.hostname or new.username or new.password or new.port
                or not any(new.hostname == h or new.hostname.endswith("." + h) for h in hosts)):
            raise ValueError("unexpected redirect destination")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected and old.hostname != new.hostname:
            redirected.remove_header("Authorization")
        return redirected


def fetch(url: str, *, limit: int = MAX_JSON, token: str = "") -> bytes:
    parsed = parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in {"api.github.com", "github.com"} or parsed.username or parsed.password or parsed.port:
        raise ValueError("unexpected initial URL")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "tnd-public-index/1", "X-GitHub-Api-Version": "2022-11-28"}
    if token and parsed.hostname == "api.github.com":
        headers["Authorization"] = f"Bearer {token}"
    req = request.Request(url, headers=headers)
    try:
        with request.build_opener(SafeRedirect()).open(req, timeout=25) as response:
            content = response.read(limit + 1)
    except error.HTTPError as exc:
        # The workflow token is scoped to the platform repository. A public
        # library endpoint may be visible anonymously even when that token has
        # no permission there. Retry without credentials, never with a broader
        # or user-supplied token.
        if token and parsed.hostname == "api.github.com" and exc.code in (403, 404):
            return fetch(url, limit=limit)
        raise
    if len(content) > limit:
        raise ValueError("response exceeds size limit")
    return content


def api(path: str, token: str = ""):
    return json.loads(fetch(API + path, token=token))


def _complete_listing(page_fetch, *, label: str, limit: int, wrapped: bool) -> list[dict]:
    """Read one bounded snapshot, rejecting truncation, count changes, and duplicate IDs."""
    records, seen, expected = [], set(), None
    for page in range(1, limit // 100 + 2):
        response = page_fetch(page)
        if wrapped:
            if not isinstance(response, dict):
                raise ValueError(f"invalid {label} listing")
            total, batch = response.get("total_count"), response.get("artifacts")
            if (isinstance(total, bool) or not isinstance(total, int) or not 0 <= total <= limit
                    or not isinstance(batch, list) or len(batch) > 100):
                raise ValueError(f"invalid or oversized {label} listing")
            if expected is None:
                expected = total
            elif total != expected:
                raise ValueError(f"{label} listing changed during pagination")
        else:
            batch = response
            if not isinstance(batch, list) or len(batch) > 100:
                raise ValueError(f"invalid {label} listing")
        if len(records) + len(batch) > limit:
            raise ValueError(f"{label} listing exceeds complete-query limit")
        for record in batch:
            record_id = record.get("id") if isinstance(record, dict) else None
            if (isinstance(record_id, bool) or not isinstance(record_id, int)
                    or record_id < 1 or record_id in seen):
                raise ValueError(f"{label} listing contains invalid or duplicate IDs")
            seen.add(record_id)
            records.append(record)
        if wrapped:
            if len(records) == expected:
                return records
            if len(records) > expected or len(batch) < 100:
                raise ValueError(f"{label} listing is incomplete")
        elif len(batch) < 100:
            return records
    raise ValueError(f"{label} pagination limit reached before completion")


def stable_listing(page_fetch, *, label: str, limit: int, wrapped: bool, fingerprint=None) -> list[dict]:
    """Require two complete snapshots with identical security-relevant records."""
    first = _complete_listing(page_fetch, label=label, limit=limit, wrapped=wrapped)
    second = _complete_listing(page_fetch, label=label, limit=limit, wrapped=wrapped)
    identify = fingerprint or (lambda item: item["id"])
    if [identify(item) for item in first] != [identify(item) for item in second]:
        raise ValueError(f"{label} listing changed while it was read")
    return second


def validated_resource_limits(value: object) -> dict:
    keys = {"schema_version", "build_bytes", "build_inodes", "export_bytes", "export_inodes"}
    if (not isinstance(value, dict) or set(value) != keys
            or isinstance(value.get("schema_version"), bool)
            or not isinstance(value.get("schema_version"), int)
            or value.get("schema_version") != 1):
        raise ValueError("audit report has invalid resource-limit schema")
    for name in ("build_bytes", "export_bytes"):
        amount = value[name]
        if isinstance(amount, bool) or not isinstance(amount, int) or not 4096 <= amount <= 4 * 1024**3:
            raise ValueError("audit report has invalid byte limit")
    for name in ("build_inodes", "export_inodes"):
        amount = value[name]
        if isinstance(amount, bool) or not isinstance(amount, int) or not 16 <= amount <= 1_000_000:
            raise ValueError("audit report has invalid inode limit")
    return {name: value[name] for name in ("schema_version", "build_bytes", "build_inodes", "export_bytes", "export_inodes")}


def task_records(issues: list[dict]) -> list[dict]:
    records = []
    for issue in issues:
        if not isinstance(issue, dict) or "pull_request" in issue or issue.get("state") != "open":
            continue
        number, title = issue.get("number"), issue.get("title")
        if isinstance(number, bool) or not isinstance(number, int) or number < 1 or not isinstance(title, str) or not title.strip():
            continue
        labels = [label.get("name", "") for label in issue.get("labels", []) if isinstance(label, dict)]
        if "choir/task" in labels:
            state = "Claimed (label)" if "choir/claimed" in labels else "Available (label)" if "choir/available" in labels else "Task"
        elif PROPOSAL_LABEL in labels:
            state = "Request"
        else:
            # Bugs, support questions, and other repository issues are not
            # mathematical proposals merely because they are open.
            continue
        topics = [label for label in labels if isinstance(label, str)
                  and not label.startswith("choir/") and label != PROPOSAL_LABEL][:12]
        records.append({"title": title[:300], "url": f"https://github.com/{REPO}/issues/{number}",
                        "description": "", "statement": "", "topics": topics, "status": state})
    return records


def issue_snapshot(issue: dict) -> str:
    """Capture every issue field that can affect the public task projection."""
    return json.dumps({
        "id": issue.get("id"),
        "number": issue.get("number"),
        "title": issue.get("title"),
        "state": issue.get("state"),
        "pull_request": "pull_request" in issue,
        "labels": issue.get("labels"),
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def public_tasks(token: str) -> list[dict]:
    issues = stable_listing(
        lambda page: api(f"/issues?state=open&per_page=100&page={page}", token),
        label="open issue",
        limit=MAX_OPEN_ISSUES,
        wrapped=False,
        fingerprint=issue_snapshot,
    )
    return task_records(issues)


def run_origin(run: dict, sha: str) -> bool:
    if not isinstance(run, dict) or not isinstance(run.get("repository"), dict) or not isinstance(run.get("head_repository"), dict):
        return False
    return (isinstance(run.get("id"), int) and not isinstance(run["id"], bool)
            and run["id"] > 0 and run.get("head_sha") == sha and run.get("head_branch") == "main"
            and run.get("event") in {"push", "schedule", "workflow_dispatch"}
            and str(run.get("path", "")).split("@", 1)[0] == WORKFLOW
            and run.get("repository", {}).get("full_name") == REPO
            and run.get("head_repository", {}).get("full_name") == REPO)


def attempt_order(run: dict) -> tuple[datetime, int, int]:
    """Order attempts by start/request time, never by when they completed.

    A first attempt that has not started can use its creation time. A rerun's
    creation time belongs to its original attempt, so missing start metadata on
    a rerun is unknowable and makes the snapshot unavailable. Validate every
    matching run rather than silently discard incomplete newer evidence.
    """
    attempt = run.get("run_attempt")
    if isinstance(attempt, bool) or not isinstance(attempt, int) or attempt < 1:
        raise ValueError("audit run has invalid attempt metadata")

    def timestamp(value):
        if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", value):
            raise ValueError("audit run has missing or invalid timing metadata")
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)

    created = timestamp(run.get("created_at"))
    started = run.get("run_started_at")
    if started is None and attempt == 1 and run.get("status") in {"queued", "requested", "waiting", "pending"}:
        started = created
    else:
        started = timestamp(started)
    if started < created:
        raise ValueError("audit attempt started before its run was created")
    return started, run["id"], attempt


def audit_runs(sha: str, token: str) -> list[dict]:
    """Read a complete bounded listing, rejecting truncation or moving pages."""
    runs, seen = [], set()
    expected = None
    for page in range(1, 11):
        response = api(f"/actions/workflows/audit-main.yml/runs?head_sha={sha}&branch=main&per_page=100&page={page}", token)
        if not isinstance(response, dict):
            raise ValueError("invalid workflow run listing")
        total, batch = response.get("total_count"), response.get("workflow_runs")
        if (isinstance(total, bool) or not isinstance(total, int) or not 0 <= total <= MAX_AUDIT_RUNS
            or not isinstance(batch, list) or len(batch) > 100):
            raise ValueError("workflow run listing is invalid or exceeds the complete-query limit")
        if expected is None:
            expected = total
        elif total != expected:
            raise ValueError("workflow run listing changed during pagination")
        for run in batch:
            run_id = run.get("id") if isinstance(run, dict) else None
            if isinstance(run_id, bool) or not isinstance(run_id, int) or run_id < 1 or run_id in seen:
                raise ValueError("workflow run listing contains invalid or duplicate IDs")
            seen.add(run_id)
            runs.append(run)
        if len(runs) == expected:
            return runs
        if len(runs) > expected or len(batch) < 100:
            raise ValueError("workflow run listing is incomplete")
    raise ValueError("workflow run pagination limit reached before completion")


def audit_run_snapshot(runs: list[dict]) -> list[str]:
    """Canonicalize every field that can affect run origin, ordering, or acceptance."""
    records = []
    for run in runs:
        repository = run.get("repository") if isinstance(run.get("repository"), dict) else {}
        head_repository = run.get("head_repository") if isinstance(run.get("head_repository"), dict) else {}
        records.append(json.dumps({
            "id": run.get("id"),
            "head_sha": run.get("head_sha"),
            "head_branch": run.get("head_branch"),
            "event": run.get("event"),
            "path": run.get("path"),
            "status": run.get("status"),
            "conclusion": run.get("conclusion"),
            "run_attempt": run.get("run_attempt"),
            "created_at": run.get("created_at"),
            "run_started_at": run.get("run_started_at"),
            "updated_at": run.get("updated_at"),
            "repository": repository.get("full_name"),
            "head_repository": head_repository.get("full_name"),
        }, sort_keys=True, separators=(",", ":")))
    return sorted(records)


def valid_run(run: dict, sha: str) -> bool:
    return run_origin(run, sha) and run.get("status") == "completed" and run.get("conclusion") == "success"


def read_report(archive: bytes, expected_digest: str) -> dict:
    if not isinstance(expected_digest, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", expected_digest):
        raise ValueError("missing artifact digest")
    if hashlib.sha256(archive).hexdigest() != expected_digest[7:]:
        raise ValueError("release asset does not match audit artifact digest")
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        entries = z.infolist()
        if len(entries) != 1 or entries[0].filename != "audit.json" or entries[0].file_size > MAX_JSON:
            raise ValueError("unexpected audit archive contents")
        data = z.read(entries[0])
    result = json.loads(data)
    if not isinstance(result, dict):
        raise ValueError("unexpected audit report")
    return result


def result_records(report: dict, sha: str, run: dict) -> list[dict]:
    proof = report.get("proof_check")
    ci = report.get("ci")
    source_files = report.get("source_files")
    admissions = report.get("admission")
    export_digests = report.get("export_sha256")
    certification = report.get("certification")
    if (type(report.get("schema_version")) is not int or report["schema_version"] != 1
        or report.get("status") != "verified"
        or report.get("base_sha") != sha or report.get("head_sha") != sha
        or report.get("toolchain") != TOOLCHAIN or report.get("comparator_revision") != COMPARATOR
        or report.get("exporter_revision") != EXPORTER
        or report.get("build_image") != BUILD_IMAGE
        or report.get("resource_boundary") != RESOURCE_BOUNDARY
        or not isinstance(certification, dict)
        or set(certification) != {"schema_version", "evidence_profile",
                                  "source_binding_validated", "resource_boundary_validated"}
        or type(certification.get("schema_version")) is not int
        or certification["schema_version"] != 1
        or certification.get("evidence_profile") != EVIDENCE_PROFILE
        or certification.get("source_binding_validated") is not True
        or certification.get("resource_boundary_validated") is not True
        or not isinstance(ci, dict)
        or set(ci) != {"repository", "workflow", "event", "run_id", "run_attempt", "head_sha"}
        or ci.get("repository") != REPO or ci.get("workflow") != WORKFLOW
        or ci.get("event") != run.get("event") or ci.get("run_id") != run.get("id")
        or type(ci.get("run_id")) is not int or ci["run_id"] < 1
        or type(ci.get("run_attempt")) is not int or ci["run_attempt"] < 1
        or ci.get("run_attempt") != run.get("run_attempt") or ci.get("head_sha") != sha
        or not isinstance(source_files, dict) or set(source_files) != {"base", "head"}
        or not isinstance(admissions, dict) or set(admissions) != {"base", "head"}
        or not isinstance(export_digests, dict) or set(export_digests) != {"base", "head"}
        or not isinstance(proof, dict)
        or type(proof.get("schema_version")) is not int or proof["schema_version"] != 1
        or proof.get("status") != "verified-proof-objects"
        or proof.get("toolchain") != PROOF_TOOLCHAIN
        or proof.get("comparator_revision") != COMPARATOR
        or proof.get("development_only") is not False
        or proof.get("checker_isolation") != PRODUCTION_ISOLATION
        or not isinstance(proof.get("permitted_axioms"), list)
        or not all(isinstance(name, str) for name in proof["permitted_axioms"])
        or len(proof["permitted_axioms"]) != len(ALLOWED_AXIOMS)
        or set(proof["permitted_axioms"]) != ALLOWED_AXIOMS
        or not isinstance(proof.get("declarations"), list) or not proof["declarations"]
        or report.get("tasks") != []):
        raise ValueError("audit report does not prove the selected revision")
    resource_limits = validated_resource_limits(report.get("resource_limits"))
    for name in ("inventory_sha256", "checker_sha256", "exporter_sha256"):
        if not isinstance(report.get(name), str) or not HEX64.fullmatch(report[name]):
            raise ValueError("audit report has a missing or malformed trusted-input digest")
    if (not all(isinstance(value, str) and HEX64.fullmatch(value)
                for value in export_digests.values())
            or export_digests["base"] != export_digests["head"]):
        raise ValueError("audit report has invalid or inconsistent export digests")
    for label in ("base", "head"):
        files = source_files[label]
        admission = admissions[label]
        if (not isinstance(files, dict) or not files
                or "TNDLib.lean" not in files
                or not all(isinstance(path, str) and LIBRARY_SOURCE_PATH.fullmatch(path)
                           and isinstance(value, str) and HEX64.fullmatch(value)
                           for path, value in files.items())
                or not isinstance(admission, dict)
                or set(admission) != {"status", "scope", "development_only", "source_sha256",
                                      "policy_sha256", "parser_sha256", "parser_isolation"}
                or admission.get("status") != "admitted-source-syntax"
                or admission.get("scope") != "approved-library-source-only"
                or admission.get("development_only") is not False
                or admission.get("parser_isolation") != PRODUCTION_ISOLATION
                or admission.get("source_sha256") != files
                or not isinstance(admission.get("policy_sha256"), str)
                or not HEX64.fullmatch(admission["policy_sha256"])
                or not isinstance(admission.get("parser_sha256"), str)
                or not HEX64.fullmatch(admission["parser_sha256"])):
            raise ValueError("audit report has invalid source-admission provenance")
    if (source_files["base"] != source_files["head"]
            or admissions["base"]["policy_sha256"] != admissions["head"]["policy_sha256"]
            or admissions["base"]["parser_sha256"] != admissions["head"]["parser_sha256"]):
        raise ValueError("audit report base/head provenance differs for one published commit")
    files = source_files["head"]
    evidence = {
        "verified": True,
        "source_commit": sha,
        "audit_commit": sha,
        "url": f"https://github.com/{REPO}/actions/runs/{run['id']}",
        "toolchain": TOOLCHAIN,
        "comparator_revision": COMPARATOR,
        "exporter_revision": EXPORTER,
        "build_image": BUILD_IMAGE,
        "resource_boundary": RESOURCE_BOUNDARY,
        "resource_limits": resource_limits,
        "evidence_profile": EVIDENCE_PROFILE,
        "source_binding_validated": True,
        "resource_boundary_validated": True,
        "inventory_sha256": report["inventory_sha256"],
        "checker_sha256": report["checker_sha256"],
        "exporter_sha256": report["exporter_sha256"],
        "export_sha256": dict(export_digests),
        "admission_policy_sha256": admissions["head"]["policy_sha256"],
        "admission_parser_sha256": admissions["head"]["parser_sha256"],
        "admission_parser_isolation": PRODUCTION_ISOLATION,
        "checker_isolation": PRODUCTION_ISOLATION,
    }
    results, names = [], set()
    for entry in proof["declarations"]:
        if not isinstance(entry, dict):
            raise ValueError("invalid declaration")
        name, source, axioms = entry.get("name"), entry.get("source_path"), entry.get("axioms")
        statement_axioms = entry.get("statement_axioms")
        if (not isinstance(name, str) or not name.startswith("TNDLib.") or name in names
            or entry.get("kind") not in DECLARATION_KINDS
            or not isinstance(source, str) or not SOURCE_PATH.fullmatch(source)
            or ".." in PurePosixPath(source).parts or not HEX64.fullmatch(str(files.get(source, "")))
            or not isinstance(axioms, list) or not all(isinstance(a, str) and a in ALLOWED_AXIOMS for a in axioms)
            or len(axioms) != len(set(axioms))
            or not isinstance(statement_axioms, list)
            or not all(isinstance(a, str) and a in axioms for a in statement_axioms)
            or len(statement_axioms) != len(set(statement_axioms))
            or not isinstance(entry.get("display"), bool)
            or entry.get("source_sha") != sha
            or entry.get("source_blob_sha256") != files.get(source)
            or not isinstance(entry.get("statement"), str) or not entry["statement"].strip()):
            raise ValueError("unsafe or unmapped audit declaration")
        names.add(name)
        if not entry["display"]:
            continue
        description, contributor, citation = entry.get("description"), entry.get("contributor"), entry.get("citation")
        if (not isinstance(description, str) or not description.strip()
            or not isinstance(contributor, str) or not contributor.strip()
            or not isinstance(citation, str) or not citation.strip()):
            raise ValueError("displayed declaration lacks explanation, contributor attribution, or source citation")
        topic = name.split(".")[1] if name.count(".") >= 2 else "Library"
        result_evidence = dict(evidence)
        result_evidence["source_blob_sha256"] = entry["source_blob_sha256"]
        results.append({"name": name, "statement": entry["statement"], "topics": [topic], "axioms": axioms,
                        "description": description.strip(), "contributor": contributor.strip(), "citation": citation.strip(),
                        "source_url": f"https://github.com/{REPO}/blob/{sha}/" + parse.quote(source, safe="/"),
                        "evidence": result_evidence})
    return results


def public_results(sha: str, token: str) -> list[dict]:
    runs = audit_runs(sha, token)
    matching = [run for run in runs if run_origin(run, sha)]
    if not matching:
        raise ValueError("no trusted audit run for this revision")
    # A new run or re-run supersedes earlier evidence, even while pending or
    # failed. Never silently fall back to an older success for the same SHA.
    ordered = [(attempt_order(run), run) for run in matching]
    latest_start = max(order[0] for order, _ in ordered)
    latest = [(order, run) for order, run in ordered if order[0] == latest_start]
    # API timestamps have second precision. A tied unsuccessful attempt cannot
    # be proven older, so it blocks rather than losing an arbitrary ID tie-break.
    if any(not valid_run(run, sha) for _, run in latest):
        raise ValueError("latest audit run has not succeeded")
    run = max(latest, key=lambda item: item[0])[1]
    release = api(f"/releases/tags/{RELEASE_TAG}", token)
    release_id = release.get("id") if isinstance(release, dict) else None
    if (isinstance(release_id, bool) or not isinstance(release_id, int) or release_id < 1
            or release.get("tag_name") != RELEASE_TAG):
        raise ValueError("invalid audit evidence release")
    assets = stable_listing(
        lambda page: api(f"/releases/{release_id}/assets?per_page=100&page={page}", token),
        label="release asset", limit=MAX_RELEASE_ASSETS, wrapped=False,
        fingerprint=lambda asset: (
            asset.get("id"), asset.get("name"), asset.get("state"), asset.get("size"),
            asset.get("browser_download_url"),
        ),
    )
    current_release = api(f"/releases/tags/{RELEASE_TAG}", token)
    if (not isinstance(current_release, dict) or current_release.get("id") != release_id
            or current_release.get("tag_name") != RELEASE_TAG):
        raise ValueError("audit evidence release changed while it was read")
    run_id = run["id"]
    artifacts = stable_listing(
        lambda page: api(
            f"/actions/runs/{run_id}/artifacts?name=tnd-audit-report&per_page=100&page={page}",
            token,
        ),
        label="run artifact", limit=MAX_RUN_ARTIFACTS, wrapped=True,
        fingerprint=lambda artifact: (
            artifact.get("id"), artifact.get("name"), artifact.get("expired"), artifact.get("digest"),
            artifact.get("workflow_run", {}).get("id")
            if isinstance(artifact.get("workflow_run"), dict) else None,
            artifact.get("workflow_run", {}).get("head_sha")
            if isinstance(artifact.get("workflow_run"), dict) else None,
        ),
    )
    for artifact in artifacts:
        artifact_id = artifact.get("id")
        workflow_run = artifact.get("workflow_run")
        if (artifact.get("name") != "tnd-audit-report" or artifact.get("expired") is not False
            or isinstance(artifact_id, bool) or not isinstance(artifact_id, int) or artifact_id < 1
            or not isinstance(workflow_run, dict) or workflow_run.get("id") != run_id
            or workflow_run.get("head_sha") != sha):
            continue
        expected_name = f"audit-{sha}-{run_id}-{artifact_id}.zip"
        matching_assets = [x for x in assets if x.get("name") == expected_name]
        if len(matching_assets) > 1:
            raise ValueError("audit evidence release contains duplicate matching asset names")
        asset = matching_assets[0] if matching_assets else None
        if (not asset or asset.get("state") != "uploaded" or isinstance(asset.get("size"), bool)
                or not isinstance(asset.get("size"), int) or not 0 < asset["size"] <= MAX_ARCHIVE):
            continue
        expected_url = f"https://github.com/{REPO}/releases/download/{RELEASE_TAG}/{expected_name}"
        if asset.get("browser_download_url") != expected_url:
            continue
        archive = fetch(expected_url, limit=MAX_ARCHIVE)
        if len(archive) != asset["size"]:
            continue
        try:
            records = result_records(read_report(archive, artifact.get("digest")), sha, run)
        except (ValueError, TypeError, zipfile.BadZipFile):
            # A run can have artifacts from older attempts. The embedded
            # GitHub attempt must match; never use the old one as fallback.
            continue
        if audit_run_snapshot(audit_runs(sha, token)) != audit_run_snapshot(runs):
            raise ValueError("audit workflow runs changed while evidence was read")
        return records
    raise ValueError("current audit evidence is unavailable or invalid")


def generate(token: str = "") -> dict:
    output = {"schema_version": 1, "generated_at": stamp(), "library": {"repository": REPO, "revision": None},
              "tasks": {"status": "unavailable", "generated_at": None, "items": []},
              "results": {"status": "unavailable", "items": []}}
    try:
        output["tasks"]["items"] = public_tasks(token)
        output["tasks"]["generated_at"] = stamp()
        output["tasks"]["status"] = "ok"
    except (OSError, ValueError, TypeError, AttributeError, KeyError) as exc:
        print(f"Task snapshot unavailable: {type(exc).__name__}", file=sys.stderr)
    try:
        sha = api("/commits/main", token).get("sha")
        if not isinstance(sha, str) or not HEX40.fullmatch(sha):
            raise ValueError("invalid main revision")
        output["library"]["revision"] = sha
        output["results"]["items"] = public_results(sha, token)
        output["results"]["status"] = "ok"
    except (OSError, ValueError, TypeError, AttributeError, KeyError, zipfile.BadZipFile) as exc:
        print(f"Verified results unavailable: {type(exc).__name__}", file=sys.stderr)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("site/data/index.json"))
    args = parser.parse_args()
    document = generate(os.environ.get("GITHUB_TOKEN", ""))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(".tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)


if __name__ == "__main__":
    main()
