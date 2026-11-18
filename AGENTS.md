<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Offline trip snapshots and queues are user-scoped; replay preserves action order, server authorization and stable operation IDs. Failed photos/actions remain queued; expired returns use a separate scrap ledger and never increase sellable stock.
- Profile camera/gallery use Base64 conversion and Android restored-result handling before the shared cropper; own-name/photo RPCs audit immutable history so device recreation and removal cannot lose edits or history.
- Delivery role navigation uses a shared browser-safe policy with per-user last-role storage; explicit chooser navigation bypasses automatic selection so Profile always provides access.
- Parent routes that own sub-pages (e.g. `_authenticated/driver` with `driver/$tripId`) must be layouts rendering `<Outlet />`, with the list UI moved to a sibling `.index.tsx` leaf — otherwise the child route renders as the parent page. Same pattern as `loader/`.
- `record_login` must be awaited right after sign-in/session restore (not fire-and-forget) — `has_perm`/RLS for staff depends on the `user_sessions` row existing before gated queries run.
- Trip work RPC payloads must match the DB signatures exactly (e.g. `deliver_stop` lines are `{order_line_id, delivered, short, ...}`; `start_trip` takes no coordinates) — PostgREST rejects unknown arg names.

- Login verifies mobile + PIN server-side (check_pin + device trust); any OTP shown is the magic-link token minted only after a successful PIN check — no server function mints a token from a mobile number alone.
- All Capacitor/native calls go through `src/lib/native.ts` with dynamic imports and an `isNative()` guard — the same build serves the browser and the live-site APK, and SSR must never load plugins.
- Push is enabled only when the APK user-agent contains `push=on` (set by capacitor.config.ts at sync when google-services.json exists) — registering without Firebase crashes Android.
- Trusted-device id is synced to @capacitor/preferences via `initDeviceId()` (src/lib/device.ts) before any PIN/device check — WebView localStorage can be wiped on Android.
- Sign-out goes only through `useTeamAuth().signOut` (record_logout → signOut → `location.replace("/login")`) so no cached profile/roles survive and Back cannot return.
- Trip goods go back into stock only in `receive_returns` (loader unload count), and only undelivered good packs; `gate_in` moves no stock — so damaged/refused never re-enter sellable stock and nothing is counted twice.
- An order's chosen `payment_method` (passed in `p_delivery.payment_method` to `_create_orders`) decides cod vs credit; credit checks run only for credit — customers with a limit can still pay cash/UPI/bank/cheque.
- Stop outcomes are handled by the `trip_stops` status trigger: partial → pending credit note per GST rate (invoice never edited); failed → order back to `approved` with `redeliver_reason` (invoice reused on re-delivery, no note).
- The driver screen shows its spinner only on first load — unmounting the live Google map on refresh throws IntersectionObserver errors.
- Role tasks use routed leaves under a workflow context layout; shared drafts survive step navigation, while one TaskScreen owns the single bottom action so forms never open off-screen.
- Realtime: one stable subscription per trip workflow (task pages reuse it); every table in a combined channel must be in the realtime publication or all bindings fail; recovery polling stays 15s on tasks, 30s on role homes.
- `sunrich:live-refresh` events tag realtime vs recovery refreshes so QA can time updates.
- Security gate is one home (header counts, SCAN, Entry/Exit/Problem, Register): every pass type goes through SCAN and `gate_scan_lookup` decides trip out/in or material; pickup QRs are detected by their `order=` text. Gate RPCs check `has_perm('gate','create')` ("Gate entry"), because the role_permissions action list is fixed.
- Staff actions go through `queueRpc` → `run_op(op_id, rpc, args)`: the op id is recorded in `client_ops`, so offline replays/retries run once; new queued RPCs must be added to run_op's allow-list. Offline photos keep their final storage path and upload from the local photo queue first.
- Gate-in may come before the driver's End trip: `gate_in` sets `gate_in_at` and the trip becomes `returned` only when `ended_at` exists (otherwise `end_trip` moves it on); manual "Mark arrived" is `gate_in(p_manual=true)`. A trip's own driver never settles — they record a cash hand-over and the cashier's `confirm_cash_handover` runs `settle_trip`.
- Photo expiry lives in `photo_files` (filled by triggers on each photo column); files are removed only by `/api/public/photo-cleanup` via the Storage API using `photo_cleanup_due` — SQL cannot delete storage files and records are never deleted.
- Staff OTP retry timing and error classification are shared through a browser-safe policy module; server enforcement remains authoritative so UI countdowns cannot bypass locks.
- Login appearance exposes only three public branding fields through a server function because anonymous table reads return no rows; images cache without a service worker and visualViewport sizes the keyboard sheet.
- Every QR scan goes through `scanCode()` in src/lib/native.ts (isSupported → permission → Google module install → scan) and is called directly from the tap — no intermediate page — so the camera opens at once; browsers get only the type-code box.
- Role homes (driver trip home, loader list, guard home) use `HomeScreen` from role-home.tsx: navy header with avatar → Profile and no back arrow; inner pages keep TaskScreen with back.
- Staff read the overdue-hours limit only via `gate_overdue_hours()` (one value for the caller's company) — the settings table stays closed to staff.
- Tab bar (`BottomNav`) shows only on role homes/Profile, never on TaskScreen, keeping one bottom action. Root launch overlay renders (SSR too) until auth is ready, so first paint is never white.
