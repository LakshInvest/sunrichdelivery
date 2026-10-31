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

