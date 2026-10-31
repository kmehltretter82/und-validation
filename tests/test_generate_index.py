import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("generate_index", Path(__file__).parents[1] / "scripts/generate_index.py")
index = importlib.util.module_from_spec(spec)
spec.loader.exec_module(index)
SHA = "a" * 40
FILE_SHA = "b" * 64
ROOT_SHA = "3" * 64
EXPORT_SHA = "c" * 64
INVENTORY_SHA = "d" * 64
CHECKER_SHA = "e" * 64
EXPORTER_SHA = "f" * 64
POLICY_SHA = "1" * 64
PARSER_SHA = "2" * 64
RESOURCE_LIMITS = {"schema_version": 1, "build_bytes": 2 * 1024**3,
                   "build_inodes": 200_000, "export_bytes": 256 * 1024**2,
                   "export_inodes": 4096}


def report():
    return {"schema_version": 1, "status": "verified", "base_sha": SHA, "head_sha": SHA,
            "toolchain": index.TOOLCHAIN, "comparator_revision": index.COMPARATOR,
            "exporter_revision": index.EXPORTER, "build_image": index.BUILD_IMAGE,
            "resource_boundary": index.RESOURCE_BOUNDARY, "resource_limits": dict(RESOURCE_LIMITS),
            "certification": {"schema_version": 1, "evidence_profile": index.EVIDENCE_PROFILE,
                              "source_binding_validated": True,
                              "resource_boundary_validated": True},
            "ci": {"repository": index.REPO, "workflow": index.WORKFLOW, "event": "push",
                   "run_id": 42, "run_attempt": 1, "head_sha": SHA},
            "source_files": {label: {"TNDLib.lean": ROOT_SHA, "TNDLib/Logic.lean": FILE_SHA}
                             for label in ("base", "head")},
            "admission": {label: {"status": "admitted-source-syntax",
                "scope": "approved-library-source-only", "development_only": False,
                "source_sha256": {"TNDLib.lean": ROOT_SHA, "TNDLib/Logic.lean": FILE_SHA},
                "policy_sha256": POLICY_SHA, "parser_sha256": PARSER_SHA,
                "parser_isolation": index.PRODUCTION_ISOLATION}
                for label in ("base", "head")},
            "export_sha256": {"base": EXPORT_SHA, "head": EXPORT_SHA},
            "inventory_sha256": INVENTORY_SHA, "checker_sha256": CHECKER_SHA,
            "exporter_sha256": EXPORTER_SHA, "tasks": [],
            "proof_check": {"schema_version": 1, "status": "verified-proof-objects",
              "toolchain": index.PROOF_TOOLCHAIN, "comparator_revision": index.COMPARATOR,
              "development_only": False, "checker_isolation": index.PRODUCTION_ISOLATION,
              "permitted_axioms": ["propext", "Quot.sound"], "declarations": [
                {"name": "TNDLib.Logic.sample", "kind": "theorem", "source_path": "TNDLib/Logic.lean", "statement": "True", "display": True,
                 "description": "Truth holds constructively.", "contributor": "Ada", "citation": "Original formalization of constructive truth.",
                 "axioms": ["propext"], "statement_axioms": [], "source_sha": SHA,
                 "source_blob_sha256": FILE_SHA}]}}


def archive(doc, extra=None):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("audit.json", json.dumps(doc))
        if extra:
            z.writestr(extra, "untrusted")
    return output.getvalue()


def run():
    return {"id": 42, "head_sha": SHA, "head_branch": "main", "event": "push",
            "status": "completed", "conclusion": "success", "path": index.WORKFLOW,
            "run_attempt": 1, "updated_at": "2026-10-29T10:00:00Z",
            "created_at": "2026-10-29T09:00:00Z", "run_started_at": "2026-10-29T09:00:00Z",
            "repository": {"full_name": index.REPO}, "head_repository": {"full_name": index.REPO}}


class IndexTests(unittest.TestCase):
    def test_exact_audit_produces_bound_result(self):
        data = archive(report())
        digest = "sha256:" + hashlib.sha256(data).hexdigest()
        records = index.result_records(index.read_report(data, digest), SHA, run())
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["name"], "TNDLib.Logic.sample")
        self.assertEqual(records[0]["evidence"]["source_commit"], SHA)
        self.assertEqual(records[0]["description"], "Truth holds constructively.")
        self.assertEqual(records[0]["contributor"], "Ada")
        self.assertEqual(records[0]["citation"], "Original formalization of constructive truth.")
        self.assertIn(f"/blob/{SHA}/TNDLib/Logic.lean", records[0]["source_url"])
        evidence = records[0]["evidence"]
        self.assertEqual(evidence["exporter_revision"], index.EXPORTER)
        self.assertEqual(evidence["build_image"], index.BUILD_IMAGE)
        self.assertEqual(evidence["resource_boundary"], index.RESOURCE_BOUNDARY)
        self.assertEqual(evidence["resource_limits"], RESOURCE_LIMITS)
        self.assertEqual(evidence["inventory_sha256"], INVENTORY_SHA)
        self.assertEqual(evidence["export_sha256"], {"base": EXPORT_SHA, "head": EXPORT_SHA})
        self.assertEqual(evidence["evidence_profile"], index.EVIDENCE_PROFILE)
        self.assertTrue(evidence["source_binding_validated"])
        self.assertTrue(evidence["resource_boundary_validated"])
        self.assertEqual(evidence["admission_parser_isolation"], index.PRODUCTION_ISOLATION)
        self.assertEqual(evidence["checker_isolation"], index.PRODUCTION_ISOLATION)
        self.assertEqual(evidence["source_blob_sha256"], FILE_SHA)

    def test_report_requires_complete_build_and_admission_provenance(self):
        required = ("exporter_revision", "build_image", "resource_boundary", "resource_limits", "certification",
                    "inventory_sha256", "checker_sha256", "exporter_sha256", "export_sha256",
                    "source_files", "admission", "tasks")
        for field in required:
            with self.subTest(missing=field):
                doc = report()
                del doc[field]
                with self.assertRaises(ValueError):
                    index.result_records(doc, SHA, run())
        mutations = (
            lambda doc: doc.update(exporter_revision="0" * 40),
            lambda doc: doc.update(build_image="ubuntu:latest"),
            lambda doc: doc.update(resource_boundary="ordinary-directory"),
            lambda doc: doc.update(schema_version=True),
            lambda doc: doc["certification"].update(evidence_profile="development-evidence"),
            lambda doc: doc["certification"].update(source_binding_validated=False),
            lambda doc: doc.update(resource_limits={**RESOURCE_LIMITS, "build_bytes": True}),
            lambda doc: doc.update(resource_limits={**RESOURCE_LIMITS, "export_inodes": 1_000_001}),
            lambda doc: doc.update(resource_limits={**RESOURCE_LIMITS, "extra": 1}),
            lambda doc: doc.update(inventory_sha256="not-a-digest"),
            lambda doc: doc.update(checker_sha256=True),
            lambda doc: doc.update(exporter_sha256="0" * 63),
            lambda doc: doc["export_sha256"].update(head="9" * 64),
            lambda doc: doc["source_files"]["base"].update({"TNDLib/Logic.lean": "8" * 64}),
            lambda doc: doc["admission"]["head"].update(policy_sha256="7" * 64),
            lambda doc: doc["admission"]["head"].update(parser_isolation="host-process"),
            lambda doc: doc["admission"]["head"].update(development_only=True),
            lambda doc: doc["source_files"]["head"].pop("TNDLib.lean"),
            lambda doc: doc["proof_check"].update(schema_version=True),
            lambda doc: doc["proof_check"].update(toolchain="4.34.0"),
            lambda doc: doc["proof_check"].update(development_only=True),
            lambda doc: doc["proof_check"].update(checker_isolation="development-docker"),
            lambda doc: doc["proof_check"]["declarations"][0].update(kind="unknown"),
            lambda doc: doc["proof_check"]["declarations"][0].update(source_sha="6" * 40),
            lambda doc: doc["proof_check"]["declarations"][0].update(source_blob_sha256="5" * 64),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                doc = report()
                mutate(doc)
                with self.assertRaises(ValueError):
                    index.result_records(doc, SHA, run())

    def test_current_development_only_audit_report_cannot_publish_results(self):
        doc = report()
        del doc["certification"]
        for admission in doc["admission"].values():
            admission["development_only"] = True
            admission["parser_isolation"] = "development-docker"
        doc["proof_check"].pop("development_only")
        doc["proof_check"].pop("checker_isolation")
        with self.assertRaises(ValueError):
            index.result_records(doc, SHA, run())

    def test_displayed_results_require_explanation_attribution_and_citation(self):
        for field in ("description", "contributor", "citation"):
            for value in (None, "", " \n\t ", 42, {}, []):
                with self.subTest(field=field, value=value):
                    doc = report()
                    doc["proof_check"]["declarations"][0][field] = value
                    with self.assertRaisesRegex(ValueError, "explanation, contributor attribution, or source citation"):
                        index.result_records(doc, SHA, run())
            doc = report()
            del doc["proof_check"]["declarations"][0][field]
            with self.assertRaisesRegex(ValueError, "explanation, contributor attribution, or source citation"):
                index.result_records(doc, SHA, run())

    def test_metadata_is_trimmed_but_hidden_helpers_need_no_description(self):
        doc = report()
        entry = doc["proof_check"]["declarations"][0]
        entry.update(description="  Explanation \n", contributor="  Ada  ", citation="  Original work.  ")
        record = index.result_records(doc, SHA, run())[0]
        self.assertEqual(record["description"], "Explanation")
        self.assertEqual(record["contributor"], "Ada")
        self.assertEqual(record["citation"], "Original work.")
        del entry["description"]
        del entry["contributor"]
        del entry["citation"]
        entry["display"] = False
        self.assertEqual(index.result_records(doc, SHA, run()), [])

    def test_rejects_corrupt_archive_and_extra_files(self):
        data = archive(report())
        with self.assertRaises(ValueError):
            index.read_report(data, "sha256:" + "0" * 64)
        data = archive(report(), "extra")
        with self.assertRaises(ValueError):
            index.read_report(data, "sha256:" + hashlib.sha256(data).hexdigest())

    def test_rejects_mismatched_or_failed_runs(self):
        self.assertTrue(index.valid_run(run(), SHA))
        for key, value in [("head_sha", "c" * 40), ("conclusion", "failure"),
                           ("head_branch", "other"), ("event", "pull_request"),
                           ("path", ".github/workflows/other.yml")]:
            bad = run()
            bad[key] = value
            self.assertFalse(index.valid_run(bad, SHA), key)

    def test_newer_failed_or_pending_run_prevents_old_success_fallback(self):
        for status, conclusion in [("completed", "failure"), ("in_progress", None)]:
            newer = dict(run(), id=43, run_started_at="2026-10-29T11:00:00Z", status=status, conclusion=conclusion)
            with patch.object(index, "api", return_value={"total_count": 2, "workflow_runs": [newer, run()]}) as query:
                with self.assertRaisesRegex(ValueError, "latest audit run"):
                    index.public_results(SHA, "")
                self.assertEqual(query.call_count, 1)

    def test_old_success_completing_later_does_not_mask_newer_failure(self):
        older = dict(run(), updated_at="2026-10-29T12:00:00Z")
        newer = dict(run(), id=43, run_started_at="2026-10-29T11:00:00Z",
                     updated_at="2026-10-29T11:05:00Z", conclusion="failure")
        with patch.object(index, "api", return_value={"total_count": 2, "workflow_runs": [newer, older]}) as query:
            with self.assertRaisesRegex(ValueError, "latest audit run has not succeeded"):
                index.public_results(SHA, "")
            self.assertEqual(query.call_count, 1)

    def test_queued_first_attempt_uses_creation_time(self):
        queued = dict(run(), id=43, created_at="2026-10-29T11:00:00Z", run_started_at=None,
                      status="queued", conclusion=None)
        with patch.object(index, "api", return_value={"total_count": 2, "workflow_runs": [queued, run()]}):
            with self.assertRaisesRegex(ValueError, "latest audit run has not succeeded"):
                index.public_results(SHA, "")

    def test_missing_or_invalid_rerun_metadata_never_falls_back(self):
        for change in ({"run_started_at": None}, {"run_started_at": "invalid"},
                       {"created_at": None}, {"run_attempt": None},
                       {"run_started_at": "2026-02-30T10:00:00Z"}):
            uncertain = dict(run(), id=1, run_attempt=2, status="queued", conclusion=None)
            uncertain.update(change)
            with self.subTest(change=change), patch.object(index, "api", return_value={
                "total_count": 2, "workflow_runs": [run(), uncertain],
            }):
                with self.assertRaises(ValueError):
                    index.public_results(SHA, "")

    def test_completed_attempt_requires_start_time(self):
        incomplete = dict(run(), run_started_at=None)
        with patch.object(index, "api", return_value={"total_count": 1, "workflow_runs": [incomplete]}):
            with self.assertRaisesRegex(ValueError, "timing metadata"):
                index.public_results(SHA, "")

    def test_tied_start_times_cannot_hide_an_unsuccessful_attempt(self):
        uncertain_failure = dict(run(), id=1, run_attempt=2, conclusion="failure")
        with patch.object(index, "api", return_value={
            "total_count": 2, "workflow_runs": [run(), uncertain_failure],
        }):
            with self.assertRaisesRegex(ValueError, "latest audit run has not succeeded"):
                index.public_results(SHA, "")

    def test_rerun_hidden_beyond_first_page_prevents_success(self):
        first_page = [dict(run(), id=n) for n in range(3, 103)]
        newer_rerun = dict(run(), id=2, run_attempt=2, run_started_at="2026-10-29T11:00:00Z",
                           updated_at="2026-10-29T11:05:00Z", conclusion="failure")
        pages = [{"total_count": 101, "workflow_runs": first_page},
                 {"total_count": 101, "workflow_runs": [newer_rerun]}]
        with patch.object(index, "api", side_effect=pages) as query:
            with self.assertRaisesRegex(ValueError, "latest audit run has not succeeded"):
                index.public_results(SHA, "")
            self.assertEqual(query.call_count, 2)
            self.assertTrue(query.call_args_list[0].args[0].endswith("&page=1"))
            self.assertTrue(query.call_args_list[1].args[0].endswith("&page=2"))

    def test_pagination_rejects_incomplete_changed_and_duplicate_results(self):
        first_page = [dict(run(), id=n) for n in range(3, 103)]
        invalid_seconds = [
            {"total_count": 101, "workflow_runs": []},
            {"total_count": 102, "workflow_runs": [dict(run(), id=2)]},
            {"total_count": 101, "workflow_runs": [first_page[0]]},
        ]
        for second in invalid_seconds:
            with self.subTest(second=second), patch.object(index, "api", side_effect=[
                {"total_count": 101, "workflow_runs": first_page}, second,
            ]):
                with self.assertRaises(ValueError):
                    index.public_results(SHA, "")

    def test_missing_total_or_api_result_ceiling_is_unavailable(self):
        for response in ({"workflow_runs": [run()]},
                         {"total_count": 1000, "workflow_runs": [run()]}):
            with patch.object(index, "api", return_value=response):
                with self.assertRaises(ValueError):
                    index.public_results(SHA, "")

    def test_report_must_match_the_current_run_attempt(self):
        old = report()
        with self.assertRaises(ValueError):
            index.result_records(old, SHA, dict(run(), run_attempt=2))

    def test_rejects_axioms_unmapped_paths_and_changed_commits(self):
        for mutate in (
            lambda r: r["proof_check"]["declarations"][0].update(axioms=["Classical.choice"]),
            lambda r: r["proof_check"]["declarations"][0].update(source_path="TNDLib/missing.lean"),
            lambda r: r["proof_check"]["declarations"][0].update(source_path="TNDLib/../secret.lean"),
            lambda r: r["proof_check"]["declarations"][0].update(source_path="TNDLib/not-lean.txt"),
            lambda r: r["proof_check"]["declarations"][0].update(statement=" \n\t "),
            lambda r: r.update(head_sha="c" * 40),
            lambda r: r["proof_check"].update(comparator_revision="wrong"),
        ):
            bad = report()
            mutate(bad)
            with self.assertRaises(ValueError):
                index.result_records(bad, SHA, run())

    def test_generated_helpers_are_audited_but_not_displayed(self):
        candidate = report()
        hidden = dict(candidate["proof_check"]["declarations"][0], name="TNDLib.Logic.sample.match_1", display=False)
        candidate["proof_check"]["declarations"].append(hidden)
        self.assertEqual([x["name"] for x in index.result_records(candidate, SHA, run())], ["TNDLib.Logic.sample"])
        hidden["axioms"] = ["Classical.choice"]
        with self.assertRaises(ValueError):
            index.result_records(candidate, SHA, run())

    def test_full_public_artifact_chain_uses_complete_release_assets(self):
        data = archive(report())
        digest = "sha256:" + hashlib.sha256(data).hexdigest()
        name = f"audit-{SHA}-42-19.zip"
        url = f"https://github.com/{index.REPO}/releases/download/{index.RELEASE_TAG}/{name}"
        asset = {"id": 700, "name": name, "state": "uploaded", "size": len(data),
                 "browser_download_url": url}
        distractors = [{"id": n, "name": f"old-{n}.zip", "state": "uploaded", "size": 1,
                        "browser_download_url": f"https://github.com/{index.REPO}/old-{n}.zip"}
                       for n in range(1, 32)]
        artifact = {"id": 19, "name": "tnd-audit-report", "expired": False, "digest": digest,
                    "workflow_run": {"id": 42, "head_sha": SHA}}

        def api(path, token=""):
            if path.startswith("/actions/workflows/"):
                return {"total_count": 1, "workflow_runs": [run()]}
            if path == f"/releases/tags/{index.RELEASE_TAG}":
                return {"id": 7, "tag_name": index.RELEASE_TAG, "assets": distractors[:30]}
            if path.startswith("/releases/7/assets?"):
                return [*distractors, asset]
            if path.startswith("/actions/runs/"):
                return {"total_count": 1, "artifacts": [artifact]}
            raise AssertionError(path)

        with patch.object(index, "api", side_effect=api), patch.object(index, "fetch", return_value=data):
            self.assertEqual(len(index.public_results(SHA, "")), 1)
            artifact["expired"] = True
            with self.assertRaises(ValueError):
                index.public_results(SHA, "")
            artifact["expired"] = False
            asset["size"] += 1
            with self.assertRaises(ValueError):
                index.public_results(SHA, "")

    def test_run_artifact_pagination_finds_match_after_one_hundred(self):
        data = archive(report())
        digest = "sha256:" + hashlib.sha256(data).hexdigest()
        artifact_id = 101
        name = f"audit-{SHA}-42-{artifact_id}.zip"
        url = f"https://github.com/{index.REPO}/releases/download/{index.RELEASE_TAG}/{name}"
        asset = {"id": 700, "name": name, "state": "uploaded", "size": len(data),
                 "browser_download_url": url}
        old = [{"id": n, "name": "tnd-audit-report", "expired": True, "digest": digest,
                "workflow_run": {"id": 42, "head_sha": SHA}} for n in range(1, 101)]
        artifact = {"id": artifact_id, "name": "tnd-audit-report", "expired": False,
                    "digest": digest, "workflow_run": {"id": 42, "head_sha": SHA}}

        def api(path, token=""):
            if path.startswith("/actions/workflows/"):
                return {"total_count": 1, "workflow_runs": [run()]}
            if path == f"/releases/tags/{index.RELEASE_TAG}":
                return {"id": 7, "tag_name": index.RELEASE_TAG}
            if path.startswith("/releases/7/assets?"):
                return [asset]
            if path.startswith("/actions/runs/"):
                page = 2 if path.endswith("page=2") else 1
                return {"total_count": 101, "artifacts": [artifact] if page == 2 else old}
            raise AssertionError(path)

        with patch.object(index, "api", side_effect=api), patch.object(index, "fetch", return_value=data):
            self.assertEqual(len(index.public_results(SHA, "")), 1)

    def test_new_rerun_appearing_during_evidence_read_blocks_old_success(self):
        data = archive(report())
        digest = "sha256:" + hashlib.sha256(data).hexdigest()
        artifact_id = 19
        name = f"audit-{SHA}-42-{artifact_id}.zip"
        url = f"https://github.com/{index.REPO}/releases/download/{index.RELEASE_TAG}/{name}"
        asset = {"id": 700, "name": name, "state": "uploaded", "size": len(data),
                 "browser_download_url": url}
        artifact = {"id": artifact_id, "name": "tnd-audit-report", "expired": False,
                    "digest": digest, "workflow_run": {"id": 42, "head_sha": SHA}}
        pending = dict(run(), id=43, status="queued", conclusion=None, run_attempt=2,
                       run_started_at="2026-10-29T11:00:00Z", updated_at="2026-10-29T11:00:00Z")
        workflow_reads = 0

        def api(path, token=""):
            nonlocal workflow_reads
            if path.startswith("/actions/workflows/"):
                workflow_reads += 1
                runs = [run()] if workflow_reads == 1 else [pending, run()]
                return {"total_count": len(runs), "workflow_runs": runs}
            if path == f"/releases/tags/{index.RELEASE_TAG}":
                return {"id": 7, "tag_name": index.RELEASE_TAG}
            if path.startswith("/releases/7/assets?"):
                return [asset]
            if path.startswith("/actions/runs/"):
                return {"total_count": 1, "artifacts": [artifact]}
            raise AssertionError(path)

        with patch.object(index, "api", side_effect=api), patch.object(index, "fetch", return_value=data):
            with self.assertRaisesRegex(ValueError, "workflow runs changed"):
                index.public_results(SHA, "")

    def test_release_asset_pagination_rejects_ceiling_duplicates_and_changes(self):
        with self.assertRaisesRegex(ValueError, "complete-query limit"):
            index.stable_listing(
                lambda page: [{"id": (page - 1) * 100 + offset} for offset in range(1, 101)],
                label="release asset", limit=999, wrapped=False,
            )
        with self.assertRaisesRegex(ValueError, "duplicate"):
            index.stable_listing(
                lambda _page: [{"id": 1}, {"id": 1}],
                label="release asset", limit=999, wrapped=False,
            )
        snapshots = iter(([{"id": 1}], [{"id": 2}]))
        with self.assertRaisesRegex(ValueError, "changed while"):
            index.stable_listing(
                lambda _page: next(snapshots),
                label="release asset", limit=999, wrapped=False,
            )
        snapshots = iter(([{"id": 1, "name": "before"}], [{"id": 1, "name": "after"}]))
        with self.assertRaisesRegex(ValueError, "changed while"):
            index.stable_listing(
                lambda _page: next(snapshots),
                label="release asset", limit=999, wrapped=False,
                fingerprint=lambda asset: (asset["id"], asset["name"]),
            )

    def test_run_artifact_pagination_rejects_incomplete_changed_and_duplicate_lists(self):
        first = [{"id": n} for n in range(1, 101)]
        cases = (
            [
                {"total_count": 101, "artifacts": first},
                {"total_count": 101, "artifacts": []},
            ],
            [
                {"total_count": 101, "artifacts": first},
                {"total_count": 102, "artifacts": [{"id": 101}, {"id": 102}]},
            ],
            [{"total_count": 2, "artifacts": [{"id": 1}, {"id": 1}]}],
        )
        for responses in cases:
            with self.subTest(responses=responses), self.assertRaises(ValueError):
                pages = iter(responses)
                index.stable_listing(
                    lambda _page: next(pages),
                    label="run artifact", limit=999, wrapped=True,
                )
        snapshots = iter((
            {"total_count": 1, "artifacts": [{"id": 1}]},
            {"total_count": 1, "artifacts": [{"id": 2}]},
        ))
        with self.assertRaisesRegex(ValueError, "changed while"):
            index.stable_listing(
                lambda _page: next(snapshots),
                label="run artifact", limit=999, wrapped=True,
            )
        snapshots = iter((
            {"total_count": 1, "artifacts": [{"id": 1, "digest": "before"}]},
            {"total_count": 1, "artifacts": [{"id": 1, "digest": "after"}]},
        ))
        with self.assertRaisesRegex(ValueError, "changed while"):
            index.stable_listing(
                lambda _page: next(snapshots),
                label="run artifact", limit=999, wrapped=True,
                fingerprint=lambda artifact: (artifact["id"], artifact["digest"]),
            )

    def test_tasks_exclude_pull_requests_and_expose_label_state(self):
        issues = [{"number": 1, "title": "task", "state": "open", "labels": [{"name": "choir/task"}, {"name": "choir/available"}, {"name": "Logic"}]},
                  {"number": 2, "title": "pr", "state": "open", "labels": [], "pull_request": {}},
                  {"number": 3, "title": "request", "state": "open", "labels": [{"name": index.PROPOSAL_LABEL}, {"name": "Topology"}]},
                  {"number": 4, "title": "ordinary bug", "state": "open", "labels": [{"name": "bug"}]}]
        result = index.task_records(issues)
        self.assertEqual([item["status"] for item in result], ["Available (label)", "Request"])
        self.assertEqual(result[0]["topics"], ["Logic"])
        self.assertEqual(result[1]["topics"], ["Topology"])

    def test_task_pagination_reads_more_than_one_hundred_twice(self):
        issues = [
            {"id": number, "number": number, "title": f"request {number}", "state": "open",
             "labels": [{"name": index.PROPOSAL_LABEL}]}
            for number in range(1, 102)
        ]

        def api(path, token=""):
            page = int(path.rsplit("page=", 1)[1])
            return issues[:100] if page == 1 else issues[100:]

        with patch.object(index, "api", side_effect=api) as query:
            result = index.public_tasks("token")
        self.assertEqual(len(result), 101)
        self.assertEqual([call.args[0].rsplit("page=", 1)[1] for call in query.call_args_list],
                         ["1", "2", "1", "2"])

    def test_task_pagination_rejects_duplicate_and_mutated_snapshots(self):
        duplicate = {"id": 1, "number": 1, "title": "one", "state": "open",
                     "labels": [{"name": index.PROPOSAL_LABEL}]}
        with patch.object(index, "api", return_value=[duplicate, duplicate]), \
             self.assertRaisesRegex(ValueError, "duplicate"):
            index.public_tasks("")

        changed = dict(duplicate, labels=[])
        with patch.object(index, "api", side_effect=[[duplicate], [changed]]), \
             self.assertRaisesRegex(ValueError, "changed while"):
            index.public_tasks("")

    def test_api_failure_is_unavailable_not_an_empty_success(self):
        with patch.object(index, "public_tasks", side_effect=OSError("network")), \
             patch.object(index, "api", side_effect=OSError("network")):
            result = index.generate()
        self.assertEqual(result["tasks"]["status"], "unavailable")
        self.assertIsNone(result["tasks"]["generated_at"])
        self.assertEqual(result["results"]["status"], "unavailable")

    def test_cross_host_redirect_never_retains_authorization(self):
        from urllib.request import Request
        req = Request("https://api.github.com/path", headers={"Authorization": "Bearer secret"})
        redirected = index.SafeRedirect().redirect_request(req, None, 302, "Found", {},
                                                           "https://release-assets.githubusercontent.com/example")
        self.assertNotIn("Authorization", redirected.headers)
        with self.assertRaises(ValueError):
            index.SafeRedirect().redirect_request(req, None, 302, "Found", {}, "https://evil.example/path")
        for destination in ("https://api.github.com:444/path", "https://user@github.com/path"):
            with self.subTest(destination=destination), self.assertRaises(ValueError):
                index.SafeRedirect().redirect_request(req, None, 302, "Found", {}, destination)


if __name__ == "__main__":
    unittest.main()
