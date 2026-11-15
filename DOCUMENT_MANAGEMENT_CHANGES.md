# Captain document management completion

Implemented locally on 2026-11-15.

## Source changes

- apps/admin/public/launch-console.js: both document navigation entries now show the same grouped captain interface. Each captain has one expandable panel containing all nine current uploads, all renewal requests, independent decision forms, reviewer information and review history. Includes captain counters, name/phone/reference search, state filters and priority ordering. Search, filters and expanded panels survive decision refreshes; counters refresh after decisions. All interpolated user content is escaped.
- apps/hub/worker/document-renewal.js: grouped management API reads all records in database pages rather than silently truncating captains or renewal history. Classifies required expiry documents as expired, expiring through the inclusive 30-day boundary, valid beyond 30 days, or missing (including invalid dates or missing upload metadata). Pending review is independent of current document validity. Supplemental images are identified as present without inventing expiry dates. Counters count captains with each state; a captain can occur in several counters. Priority is pending, expired, missing, expiring, valid, followed by name and ID.
- The same Worker module preserves protected current/renewal file access, safe MIME allowlists, sandbox headers, no-store and nosniff. Current-file links use the existing renewals permission boundary so operations staff do not require broader application access. Captain renewal status responses now also include reviewer and review time.
- Review decisions require the existing admin authorization boundary, authenticated reviewer, same-origin POST, explicit review confirmation for approval and a rejection reason. Approving an already expired replacement is rejected. D1 batch atomically claims a pending request, records previous and replacement metadata, records the existing general activity event, and updates only the selected document on approval. Duplicate/stale decisions return conflict; rejected documents leave current documents untouched. Audit failure rolls back the whole decision.
- apps/hub/worker/admin.js and apps/hub/worker/launch-operations.js: route document monitoring through the shared management implementation; existing staff permission rules remain unchanged.
- apps/hub/drizzle/0020_document_review_history.sql: additive reviewer column, unique per-renewal audit table and captain history index. Old decisions remain visible through renewal records; unknown historical reviewers are explicitly marked as unrecorded. No historical actors are fabricated.
- apps/hub/tests/document-management.test.mjs: eight local SQLite/D1-adapter tests covering date boundaries, missing uploads, fully healthy captains, counters/search/filter, independent decisions and original metadata preservation, authorization and origin validation, stale approval prevention, rollback, pagination beyond the old limits, protected files and a lost pending-review claim.

## Validation

Final `npm test` succeeded. It rebuilt hub, rider and admin locally, then passed all 135 tests: hub 122, rider 8, admin 5. No failed or skipped tests. The eight added tests are included in the hub total. JavaScript syntax validation also passed for the changed admin console.

Full test output: local-test-results.txt.

Build scripts refreshed local dist output for all three apps and generated hub/rider service-worker/version assets as part of their existing build process. No browser interaction test was run; UI behavior was checked through implementation review and JavaScript syntax validation, with API behavior exercised by automated tests.

Migration execution was limited to isolated in-memory test databases. The new migration still needs to be applied through a separately authorized release process before the changed API is used against an existing database. No deployment, push, production access, remote migration, or secret modification was performed. The supplied workspace has no Git repository metadata, so Git diff/status comparison was unavailable.
