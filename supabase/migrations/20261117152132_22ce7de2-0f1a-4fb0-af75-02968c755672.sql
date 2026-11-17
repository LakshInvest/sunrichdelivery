create or replace function public.gate_overdue_hours()
returns integer language sql stable security definer set search_path = public as $$
  select s.trip_overdue_hours from public.app_settings s
  join public.user_profiles p on p.company_id = s.company_id
  where p.id = auth.uid() limit 1
$$;
revoke all on function public.gate_overdue_hours() from public, anon;
grant execute on function public.gate_overdue_hours() to authenticated;

-- QA-only: push the QA timing trip's gate-out back 11 hours so the overdue chip can be tested.
update public.trips set gate_out_at = now() - interval '11 hours'
where id = '5ef5a8ec-842d-4f2e-8ed7-07a47f963741' and trip_no like 'QA-TEST/%';