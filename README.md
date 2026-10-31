# TND platform

This repository contains the GitHub Pages frontend for TND, a project exploring constructive mathematics in Lean. Its library and proof-task lifecycle live in [tndlib](https://github.com/kmehltretter82/tnd-validation).

The checked-in `site/data/index.json` is an empty bootstrap index. It is not certification evidence: it shows no verified results and has no generation timestamp. The site deliberately displays an empty or unavailable state until trusted, commit-bound library audit data and a task snapshot have been published.

## Local development

The frontend is buildless and uses relative paths so it works under the `/und/` GitHub Pages project URL. Run `python3 -m http.server 8000 --directory site` and visit `http://localhost:8000/`. Run `npm test` for the index validation and filtering tests; no packages need to be installed.

## Index contract

`site/data/index.json` uses schema version 1. Each section reports whether it is available; the task section also has its own snapshot timestamp. Result entries are displayed only when they include a source URL at the index's exact 40-character `tndlib` revision, verification evidence for that same source and audit commit, and axiom dependencies within the proposed `propext`/`Quot.sound` allowlist. The generator checks the successful library workflow and artifact digest before writing results; a `verified` field by itself is never proof. Cross-repository publication and deployment remain to be tested against the actual audit workflow before publication.

The complete evidence contract is documented in
[`docs/EVIDENCE.md`](docs/EVIDENCE.md). It pins the current Lean, comparator,
exporter, and build image; requires exact bounded `host-tmpfs-v1` byte/inode
limits and all trusted-input digests; and describes the complete, stable GitHub
release-asset and run-artifact pagination checks. The upstream certification
flags and resource policy are still unset, and the upstream admission/checker
wrappers still identify themselves as development-only. The platform rejects
those current reports and reserves an explicit future production-evidence
profile, so verified results are deliberately unavailable until those
boundaries and the schema transition are validated and reviewed.

An `ok` section is accepted by the browser only with its required timestamp,
revision, and entirely valid record set. A malformed task or result makes that
section unavailable instead of silently turning bad evidence into an apparently
authoritative empty snapshot. Result statements must be nonempty, and source
links must name a Lean file below `TNDLib/` at the exact indexed revision.

The reviewed Pages workflow builds on main-branch pushes and hourly, and deploys from a separate job. Its build job has an explicit `refs/heads/main` guard so a manual dispatch cannot route branch-selected code into the Pages writer. It needs GitHub Pages configured to use GitHub Actions. The generator uses public GitHub API metadata and a public copy of the exact library audit artifact; it does not put credentials into the site. If task or evidence retrieval fails, the corresponding section says unavailable instead of claiming that no tasks or results exist.

TND is short for *tertium non datur*, the law of excluded middle. The project studies what can be established without assuming this law for every proposition; it does not assert its negation.

The [contributor launch plan](docs/LAUNCH.md) records what must work before a pilot and how the community can grow afterward.

## License

The TND platform is available under the Apache License 2.0; see
[`LICENSE`](LICENSE).

`tests/browser-check.mjs` drives the site in real browsers; its header explains how
to run it. It needs downloaded engines, so it is not part of `npm test`.

The site self-hosts DM Sans and DM Serif Display under the SIL Open Font License; see
`site/assets/fonts/`. It loads nothing from a third party.
