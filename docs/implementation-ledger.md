# Implementation ledger — current user-approved online plan

Current scope: Next static frontend + Workers/D1 + Access email OTP + ImageKit free. Four planning documents have been unified to this scope. No cloud credentials are present.

Task boundaries: root owns common types, frontend/admin, scripts/config/docs and integration. Backend implementer owns worker/, migrations/, tests/backend* and wrangler.toml. Review follows implementation.

| Interface | Producer | Consumer | Resolution |
| --- | --- | --- | --- |
| src/lib/types.ts | root | UI and worker | Shared bilingual domain types |
| GET /api/public/gallery | backend | UI | GalleryData, published only, limit/cursor for collection artwork |
| /api/admin/* | backend | admin | Access validated, no production bypass |
| POST uploads + complete | backend | upload UI | UploadTicket / Asset |

Ruling: Work in the user-provided empty workspace, without worktree scripts — no Git repository exists. No unrelated files beyond prior docs are present.
Ruling: Implement API and frontend against a shared contract; only one implementation subagent at a time. Root works on independent UI while backend is developed.
## Progress — 2026-09-09

- Scaffold, bilingual public gallery, online admin UI, browser processing, Workers/D1/Access/ImageKit adapters implemented.
- First backend review fixes landed: collection reorder version snapshots; fenced writes; tracked pending public-copy publication and cleanup.
- Root integration regressions fixed: serialized demo writes, stale demo sort rejection, upload completion checkpoint reuse, unlinked-asset cleanup UI and demo reference protection.
- Verified: typecheck and lint pass; 49 unit/API tests pass; original 6 desktop/mobile e2e pass; 2 additional large-source/batch/transparent upload e2e pass.
- Visual check: desktop/mobile home, collection, About and admin screenshots captured; no page errors or horizontal overflow. Narrow public nav wraps words and is in current fix wave.
- New 1000-artwork deep-link regression correctly fails: selected artwork beyond page 1 omitted from initial request. Fix wave in progress.
- Independent whole-project review: no new critical auth bypass; four important recovery findings in docs/integration-fix-brief.md. Agent integration_fixes owns production fixes, root owns browser tests/visual/docs. Await report and scoped re-review before final acceptance.
- Production build and both Worker dry-runs must be rerun after final fixes.
- Cloud deployment, real OTP, ImageKit, true phone hardware and regional network tests blocked on account setup; not counted as passed.

## Final local handoff — 2026-09-09

- Integration fix report received: docs/integration-fix-report.md. Scoped independent re-review accepted all four important fixes and found no new important breakage in changed code.
- Final root verification: 56 unit/API tests, 16 desktop/mobile e2e, typecheck, lint all passed; Next export10 routes and admin asset packaging passed; both Worker dry-runs passed.
- Real local Wrangler/D1 smoke passed public read, local-only auth, draft isolation, CRUD, trash/restore and cleanup of only its own empty test collection.
- Static production preview at http://127.0.0.1:3100/zh/ and /admin/; default demo remains clearly labelled. Eight production-rendered screenshots checked; no page errors or horizontal overflow; narrow nav no longer splits words.
- Tasks1–6 local implementation/verification complete. Task7 real cloud acceptance requires user service configuration and actual artwork/network conditions; see docs/acceptance.md. No remote deploy or billing changes performed.
- No Git repository found by git rev-parse; files and ledger retained in original project. No merge/push/cleanup performed. Local generated test data was created and removed only by its own smoke script.

Ruling: retain local implementation ledger and reports because no Git history exists; do not delete the only durable execution record.
Ruling: upload retry should reconcile an existing owner-bound session/file rather than blindly reupload after expiry, preserving storage and ownership checks; exact implementation is subject to regression tests and re-review.
