# Integration review fix wave

Approved scope: docs/01-structured-prompt.md and 02-technical-design.md. No git repository; work only in this project. No cloud credentials/deployment. Do not spawn subagents. Follow TDD and local Next docs before frontend code changes. Root owns tests/e2e/gallery.spec.ts, scripts/visual-check.mjs, docs except your report; don't edit those. You own production fixes and relevant unit/backend tests.

Review findings to address:

1. upload.ts retained WeakMap checkpoint reuses expired session forever. Upload succeeded but completion failed, wait 15 min then Retry -> SESSION_EXPIRED permanently. Implement explicit safe recovery, preferably server can reconcile a previously issued owner-bound expired session using the same exact file details without extending upload authorization; do not orphan/reupload blindly. Add regression. Preserve complete idempotence and input validation.
2. worker/index.ts cleanupAsset public_path is set before publicCopy upload; definitive 429/rejection creates no file. Later lookup empty causes permanent PUBLIC_COPY_UNRESOLVED. Persist definitive rejection or bounded safe reconciliation, preserving caution for ambiguous in-flight side effects. Add tests distinguishing empty after definitive rejection from unknown failure. Existing tests verify failed publish/wrong dimensions/fenced writes and tracked pending-public copy. Keep their safety properties.
3. Admin UploadPanel.run await onDone then setRunning(false) has no finally, so gallery GET failure locks queue forever. Finally reset running, show actionable refresh error. Also prevent continuing queued processing/upload after panel unmount; original images must remain untouched.
4. Gallery CollectionPage initial effect calls collectionPage(slug) ignoring artwork query; load() retry correctly passes it. Root added real failing e2e 1000-artwork deep link test in gallery.spec.ts. Fix selected context so initial and language routes load selected beyond first page.
5. Minor failure UI: ArtworkImage renders retry button nested in parent button/link; Lightbox lacks image failure fallback. Use non-nested accessible error/retry interactions; admin logo must target configured public URL, not unavailable admin bundle /zh route.

Additional integration correctness observed by root: POST artwork creation after unknown response can be retried and create duplicate art; queue remembers assetId but not logical creation id. If feasible add stable client creation id/idempotency optional field validated server-side and reuse same queue id; test repeat POST. Avoid broad unnecessary changes.

Run covering tests, typecheck/lint (root reruns final full suite). Report in docs/integration-fix-report.md with actual evidence and any unresolved concerns. Do not declare cloud verified. No irreversible operations, cloud writes or paid service actions.
