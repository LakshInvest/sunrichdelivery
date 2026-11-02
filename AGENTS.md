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
