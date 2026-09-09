# Backend implementation

Cloudflare Worker entry: `worker/index.ts`. D1 migrations: `migrations/0001_gallery.sql` and `migrations/0002_pending_publication.sql`; apply both. `coverId` identifies an artwork. Provider credentials are server-only; deploy requires replacing Wrangler placeholders and setting `IMAGEKIT_PRIVATE_KEY` as a secret.

## Routes

- Public: `GET /api/public/gallery?slug=&limit=24&cursor=0&artwork=`. Only published, non-deleted collections and artworks backed by verified public copies appear. Provider file IDs are blanked; management versions are zero. Covers and an explicitly selected artwork may be injected beyond the page size; they do not advance `nextCursor`.
- Admin read: `GET /api/admin/me`, `/gallery`, `/export`. Gallery returns five-minute signed private originals. Export contains raw metadata and provider asset records for backup/cleanup, but no secrets.
- `POST /api/admin/collections`, `PATCH /api/admin/collections/:id`; `POST /api/admin/artworks`, `PATCH /api/admin/artworks/:id`.
- `POST /api/admin/{collections|artworks}/:id/{publish|unpublish|restore}` and `DELETE /api/admin/{collections|artworks}/:id` / `:id/permanent`. Existing-record mutations require `version`. Artwork parent and image are immutable after creation. Permanent collection deletion requires removing its child artworks first.
- `POST /api/admin/collections/:id/order` enforces exact non-deleted membership and updates artwork/collection versions atomically.
- `POST /api/admin/collections/order` accepts `{collectionIds,versions:{[id]:version}}` with exact non-deleted collection membership, checks every expected version, and atomically persists collection order. Public collections include `artworkCount` for all visible published works; `nextCursor` is a number or null.
- `PATCH /api/admin/profile` accepts the complete profile.
- `POST /api/admin/uploads` issues a five-minute ImageKit V1 ticket. Upload with the returned folder/name, `useUniqueFileName=false`, `isPrivateFile=true`. `POST /api/admin/uploads/:id/complete` accepts only `{fileId}` and verifies the result with the provider plus an authenticated image HEAD request. Upload verification sessions expire after 15 minutes. Allowed MIME types: JPEG, PNG, WebP, AVIF; max 5,000,000 bytes; max long edge 3840 pixels.
- `DELETE /api/admin/assets/:id` with JSON `{}` safely retries cleanup of an asset without artwork references. A failed provider cleanup retains its asset record and marks it unverified. Permanent artwork deletion may return `{deleted:true,cleanupPending:true}` when record deletion succeeded but provider cleanup needs retry.

## Security and consistency

All admin API and static requests require cryptographically verified Access JWTs with RS256, issuer, audience, expiry and an email allowlist. Missing configuration fails closed. A local bypass requires both `ENVIRONMENT=development`, `DEV_AUTH=true`, and an actual loopback hostname. Mutation Origin must exactly match the API request origin. The public endpoint grants CORS only to `PUBLIC_ORIGIN`. Responses are not cached. Static assets use Worker-first routing, so the exported `/admin/` and its JS cannot bypass Access verification.

A separate read Worker may use the same D1 with `PUBLIC_ONLY=true`. That flag rejects every path/method except `GET` and `OPTIONS /api/public/gallery` before authentication or static-asset handling, even for authenticated users. This avoids having an Access policy on the admin hostname intercept the public API.

All mutations obtain a database-wide five-minute lease. Provider requests have 15-second timeouts. Every write/batch checks the current lease token inside the same D1 transaction, preventing an expired worker from committing after takeover. Lost workers can be retried after lease expiry. Version checks prevent stale edits; upload completion is owner-bound, atomically persisted, and idempotent for the same file ID. Body parsing is capped at 32 KiB. Public-copy failure cannot change an artwork to published.

Storage admission reserves twice each original's bytes, covering its eventual public copy. Pending, unexpired reservations count against 2.5 GB. Shared assets are stored once; provider cleanup only runs after all artwork references (including recycle-bin records) are gone. Deletion first makes the asset unavailable for new references.

Admin gallery/export include `usage.storedBytes` (recorded originals plus public copies) and `usage.reservedBytes` (pending upload reservations plus headroom for future public copies). Their sum matches application admission usage. `Asset.bytes` remains the original file size. Public responses omit usage.

## Provider decisions and limitations

The ImageKit documentation explicitly says a private file cannot have its private flag changed after upload. Publishing therefore uploads a separate deterministic public copy from the signed original URL, using `isPrivateFile=false`, `useUniqueFileName=false`, and `overwriteFile=true`, then fetches file details to confirm path, privacy, size and dimensions before persisting the public URL. Retrying an interrupted copy uses the same filename, avoiding another randomly named copy. Originals remain private.

Publication intent (`public_path`) is committed before uploading. The returned provider ID is committed as `pending_public_file_id` before fetching details, so a verification failure still leaves a cleanup target. If the ID could not be recorded because the response or lease was lost, cleanup searches ImageKit for the exact deterministic path and filename. It never deletes a near match or ambiguous result. An unresolved result retains the asset/intent for a later cleanup retry. A known pending ID is reused for verification on publication retry.

Unpublishing hides gallery metadata; it does not revoke a previously shared or cached public CDN URL. Permanent deletion asks ImageKit to remove both files. CDN cache purge/expiry is separate and is not promised by this implementation.

ImageKit V1's signature covers token and expiry, not the upload payload. Authenticated administrators can technically use a ticket to upload a file the application will reject. Abandoned/rejected provider files and provider versions can occupy space outside accepted-asset accounting. Use provider-side usage alerts/limits and periodic orphan reconciliation; the application capacity guard is not a provider-enforced hard quota. A production ImageKit/Access account was not available for live integration verification.

Official references checked during implementation:

- [ImageKit upload API](https://imagekit.io/docs/api-reference/upload-file/upload-file)
- [ImageKit file details](https://imagekit.io/docs/api-reference/digital-asset-management-dam/managing-assets/get-file-details)
- [ImageKit private files and signed URLs](https://imagekit.io/docs/media-delivery-basic-security)
- [ImageKit update API](https://imagekit.io/docs/api-reference/digital-asset-management-dam/managing-assets/update-file-details)
- [ImageKit list/search API](https://imagekit.io/docs/api-reference/digital-asset-management-dam/list-and-search-assets)

## Validation

`tests/backend.test.ts` uses locally signed JWTs and a real in-memory SQLite database with a D1 adapter. It covers identity rejection cases, privacy projection, publication prerequisites, upload verification, retries, version/order checks, lock exclusion and stale-token fencing, shared-file deletion and provider cleanup retry, storage reservation, CORS, and request limits.

Verified locally: **40/40 backend Vitest tests pass**, full project `tsc --noEmit --pretty false` exits 0, and scoped ESLint has zero warnings/errors. Regression coverage includes successful upload followed by failed details verification, deletion of that pending copy, exact-path reconciliation, and stale collection-order rejection. Live ImageKit and Cloudflare Access integration still requires deployment credentials. Worker packaging is checked separately by the root task after the admin export exists.
