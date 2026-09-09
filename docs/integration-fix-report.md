# Integration fix report

Completed the bounded review wave from `docs/integration-fix-brief.md`. No cloud changes, deployment, paid actions, or source-image edits were performed.

## Changes

- **Expired upload completion:** Worker completion now reconciles previously issued owner-bound sessions even after the reservation expires. It issues no new upload ticket and does not change expiry. The exact assigned path, name, file ID, size, dimensions, MIME and private-file checks still apply. Completed sessions remain owner-bound and idempotent for the same file. The existing client checkpoint reuses its already uploaded file.
- **Public-copy cleanup:** Provider upload responses distinguish definitive rejected uploads (400, 401, 403, 404, 413, 415, 422, 429) from unknown outcomes. A definitive first-attempt rejection clears the newly persisted intent under the mutation fence. If an earlier attempt was unknown, its intent remains, including when a later attempt is rejected. Empty lookup after unknown outcomes continues to preserve cleanup records. Recorded public IDs, wrong dimensions, and lost mutation leases retain existing safety behavior.
- **Upload panel lifecycle:** Queue workers stop starting new items after unmount. Processing that finishes after unmount revokes its new preview. Active controllers are synchronously tracked and aborted on cleanup. Shared mutation requests and busy-response retries accept an optional AbortSignal; upload ticket/completion and artwork creation pass it through. Already issued external side effects cannot be undone by browser cancellation.
- **Refresh failure:** Queue completion resets running state in `finally`. Failed gallery refresh shows an actionable `.upload-refresh-error` alert and a separate retry-refresh button, retaining completed queue items.
- **Artwork creation retry:** Optional UUID `creationId` is validated by the Worker and reused as the artwork ID. A retry returns the existing artwork without adding another row or incrementing its collection version. Reuse with a different collection or asset returns 409. Queue UUIDs provide stable creation IDs. Demo mode follows the same deduplication behavior.
- **Selected artwork routing:** Initial collection loading includes the artwork query, so a direct link can retrieve an artwork beyond the first page. Language links already preserve that query and now reach the corrected initial load.
- **Failure accessibility and navigation:** Gallery image fallbacks avoid nested buttons inside artwork buttons and collection links. Standalone images retain a retry button; the lightbox now displays an alert with a retry button on image failure. Lightbox pointer capture excludes retry controls. The admin logo uses `NEXT_PUBLIC_SITE_URL`, matching the public-site link.
- **Mobile header:** Navigation labels do not wrap within words; compact gaps and a wrapping header support narrow screens.

## Verification evidence

Focused tests were introduced before backend changes. The expired session test failed with 409 instead of entering file verification; creation retries failed validation; definitive rejected public copies remained pending cleanup. These passed after the fixes. The cancellation regression initially timed out because mutation retries ignored cancellation, and the demo idempotence regression produced two different artwork IDs; both passed after implementation.

Final local checks run by this agent on 2026-09-09:

- `node node_modules/vitest/vitest.mjs run`: **56 tests passed**, four files. This includes 45 backend tests using real in-memory SQLite, five demo mutation tests, four client tests, and two upload recovery/cancellation tests.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, no ESLint warnings.
- Prettier ran on the changed production/test files.

Runtime warnings were limited to Node's experimental SQLite notice and the existing npm user-config `home` warning.

Root owns browser tests and visual QA. Root reported all **14 desktop/mobile browser cases passed** before the final AbortSignal/demo parity changes, including the previously failing deep link and refresh failure. Root is rerunning final browser/build checks independently. Root also reported successful real local Worker/D1 smoke testing; this agent did not run that smoke test.

## Boundaries and remaining operational considerations

- No real ImageKit, Access email, deployed Cloudflare, true-artwork quality, or regional network verification is claimed.
- Ambiguous provider writes deliberately remain pending when exact-path reconciliation returns no result. This prevents discarding a record while an upstream request could still create the public file.
- Upload expiry still ends the original reservation and upload ticket; reconciliation adds the verified already-uploaded asset to recorded accounting. The provider remains the source of truth for physical usage, including abandoned uploads.
- Creation idempotence is based on the retained artwork row, including soft-deleted rows. Permanently deleting that row also removes its creation deduplication record. Retrying an old queue after deliberate permanent deletion is outside the normal queue-recovery flow.
- The existing 1000-item reorder request bound was not changed in this fix wave. Root owns documentation of operating limits.
- Browser cancellation stops future client work and aborts transport/retry waiting. It does not promise reversal of provider/database writes already accepted remotely.

Production files changed: `worker/index.ts`, `worker/provider.ts`, `src/lib/api.ts`, `src/lib/upload.ts`, `src/components/admin/Admin.tsx`, `src/components/Gallery.tsx`, `src/components/Lightbox.tsx`, `src/app/globals.css`. Regression files changed: `tests/backend.test.ts`, `tests/demo-mutations.test.ts`, `tests/upload-recovery.test.ts`. No migrations were added.
