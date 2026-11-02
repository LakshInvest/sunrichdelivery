CREATE OR REPLACE FUNCTION public.pending_ask_office()
RETURNS TABLE(alert_id uuid, trip_id uuid, trip_no text, stop_id uuid, order_no text, customer text, driver text, request jsonb, raised_at timestamptz, deadline timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  select a.id, t.id, t.trip_no, a.stop_id, o.order_no, coalesce(o.business_name, o.customer_name), up.full_name,
         case when a.note ~ '^\{' then split_part(a.note, ' | office:', 1)::jsonb else jsonb_build_object('note', a.note) end,
         a.raised_at,
         a.raised_at + make_interval(mins => coalesce(ds.ask_office_wait_minutes, 15))
    from public.trip_alerts a
    join public.trips t on t.id = a.trip_id and t.company_id = public.my_company_id()
    left join public.trip_stops s on s.id = a.stop_id
    left join public.orders o on o.id = s.order_id
    left join public.user_profiles up on up.id = a.raised_by
    left join public.delivery_settings ds on ds.company_id = t.company_id
   where a.alert_type = 'ask_office' and a.resolution is null and public.has_perm('ask_office', 'answer')
   order by a.raised_at
$$;
REVOKE EXECUTE ON FUNCTION public.pending_ask_office() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pending_ask_office() TO authenticated;