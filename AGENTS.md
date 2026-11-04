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
- Security gate is one home (header counts, SCAN, Entry/Exit/Problem, Register): every pass type goes through SCAN and `gate_scan_lookup` decides trip out/in or material; pickup QRs are detected by their `order=` text. Gate RPCs check `has_perm('gate','create')` ("Gate entry"), because the role_permissions action list is fixed.
- Staff actions go through `queueRpc` → `run_op(op_id, rpc, args)`: the op id is recorded in `client_ops`, so offline replays/retries run once; new queued RPCs must be added to run_op's allow-list. Offline photos keep their final storage path and upload from the local photo queue first.
- Gate-in may come before the driver's End trip: `gate_in` sets `gate_in_at` and the trip becomes `returned` only when `ended_at` exists (otherwise `end_trip` moves it on); manual "Mark arrived" is `gate_in(p_manual=true)`. A trip's own driver never settles — they record a cash hand-over and the cashier's `confirm_cash_handover` runs `settle_trip`.
- Photo expiry lives in `photo_files` (filled by triggers on each photo column); files are removed only by `/api/public/photo-cleanup` via the Storage API using `photo_cleanup_due` — SQL cannot delete storage files and records are never deleted.
