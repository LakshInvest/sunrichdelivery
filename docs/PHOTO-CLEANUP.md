# Daily photo clean-up — operations

**Endpoint:** `POST https://delivery.sunrich.in/api/public/photo-cleanup`
**Schedule:** daily at 02:05 IST (20:35 UTC). The database job `sunrich_photo_cleanup_plan`
already runs at 02:00 IST to log, flag files and send 7-day notices; this call deletes the files.

## Authentication
- Header `x-cron-secret` must equal the project secret `LOVABLE_CRON_SECRET`.
- The secret is read inside the handler from server environment only; it is never sent to the browser
  (no `VITE_` copy, not in any client code).
- Comparison is constant-time. Missing/wrong secret → `401 Unauthorized`, nothing runs.
- Only `POST` runs the job.

## What can be deleted
Files are taken only from the database function `photo_cleanup_due`, which returns a photo only when:
1. its `expires_on` date is before today (IST), **and**
2. it has not been deleted already, **and**
3. the company setting `photo_delete_after_download` is OFF, **or** the photo is in a downloaded backup.

UPI photos have no expiry until Accounts verifies them; problem photos none until resolved.
Only the storage file is removed (Storage API). The `photo_files` record is kept and stamped `file_deleted_at`.
That function can be run only by the server (service role) — signed-in users and the public cannot call it.

## Manual run
```
curl -X POST https://delivery.sunrich.in/api/public/photo-cleanup -H "x-cron-secret: <secret>"
```
Expected: `200 {"due":N,"deleted":N,"errors":0}`.

## Repeat calls and failures
- Deleted photos drop out of `photo_cleanup_due`, so a second call returns `{"due":0,"deleted":0,"errors":0}`.
- Up to 500 files per call; call again if `due` was 500.
- Every call writes rows to `photo_cleanup_runs` (`plan` with expired / due / kept-not-downloaded / notices,
  and `delete` with deleted count and an `errors` list of path + message). Files that fail are not stamped,
  so the next run retries them.
