# Frontend checks

Run `npm test` from the repository root. The JavaScript tests use Node's built-in
test runner and require no installed packages or browser downloads.

`app.test.js` executes the actual application module against `dom-harness.js`, a
small DOM model loaded from the site's HTML. It covers text rendering, search and
filters, keyboard tab handlers, selection state, valid empty snapshots, total and
partial index failures, safe links, and fail-closed handling of malformed or
unverified result records.
The harness throws if application code uses `innerHTML`; injected markup in the
test index must remain text.

`accessibility.test.js` checks HTML label/ID relationships, project-relative local
assets, a main-ref Pages build guard, pinned workflow actions, credential separation, and contrast for selected
small-text styles against their declared backgrounds. It does not implement a full
CSS cascade or measure rendered colors. Model tests independently exercise URL
restrictions, exact-commit evidence requirements, timestamps, and axiom filters.

These checks are not browser end-to-end tests or an accessibility certification.
The lightweight DOM does not render layout or implement native keyboard navigation,
screen-reader behavior, browser URL handling, scrolling, or focus-ring visibility.
Real-browser checks at narrow widths, with keyboard navigation and a screen reader,
remain necessary before claiming those behaviors have been validated. Safari was
present during local review, but its WebDriver exited before a session could start;
no browser or automation package was downloaded.

The frontend validates the shape and consistency of published evidence. Authenticity
depends on the trusted index-generation workflow and the upstream proof audit;
client-side checks alone cannot authenticate arbitrary JSON claiming verification.

`test_generate_index.py` exercises the server-side evidence chain. It requires
the reserved production audit-report provenance, exact resource-limit schema and sane
bounds, source/admission bindings, and all trusted-input digests. Pagination
fixtures put the matching release asset beyond the embedded 30-item page and
the matching run artifact beyond 100 entries; truncation, count or membership
changes, duplicate IDs, metadata changes, and the 999-item ceiling all fail
closed. A second complete workflow-run snapshot proves that a new pending or
failed rerun did not appear while evidence was read. Regression fixtures also
prove that the current development-only admission/checker report cannot create
a displayed result. `model.test.js` independently verifies that removing or
corrupting any public provenance field makes the browser's complete results
section unavailable.
