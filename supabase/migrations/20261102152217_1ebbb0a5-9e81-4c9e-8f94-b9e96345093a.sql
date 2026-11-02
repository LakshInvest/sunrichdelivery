ALTER TABLE public.trip_alerts DROP CONSTRAINT IF EXISTS ta_type;
ALTER TABLE public.trip_alerts ADD CONSTRAINT ta_type CHECK (alert_type = ANY (ARRAY['breakdown','accident','other','sos','ask_office','load_mismatch','return_mismatch']));
ALTER TABLE public.delivery_settings ADD COLUMN IF NOT EXISTS ask_office_wait_minutes int NOT NULL DEFAULT 15;
ALTER TABLE public.delivery_settings ADD COLUMN IF NOT EXISTS ask_office_no_reply text NOT NULL DEFAULT 'deliver_and_flag' CHECK (ask_office_no_reply IN ('deliver_and_flag','do_not_deliver'));
ALTER TABLE public.trip_alerts ADD COLUMN IF NOT EXISTS stop_id uuid REFERENCES public.trip_stops(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.trip_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id),
  kind text NOT NULL CHECK (kind IN ('undelivered','damaged','refused','empties','crates')),
  expected_qty numeric NOT NULL DEFAULT 0,
  actual_qty numeric NOT NULL DEFAULT 0,
  note text,
  received_by uuid DEFAULT auth.uid(),
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.trip_returns TO authenticated;
GRANT ALL ON public.trip_returns TO service_role;
ALTER TABLE public.trip_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY trr_read ON public.trip_returns FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_returns.trip_id));
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS returns_received_at timestamptz;

CREATE OR REPLACE FUNCTION public.ask_office(p_trip_id uuid, p_stop_id uuid, p_mode text, p_amount numeric, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_id uuid;
begin
  if not public._is_my_trip(p_trip_id) then raise exception 'Not allowed'; end if;
  if p_mode not in ('part','none') then raise exception 'Bad mode'; end if;
  if not exists (select 1 from public.trip_stops where id = p_stop_id and trip_id = p_trip_id) then raise exception 'Stop not found'; end if;
  select id into v_id from public.trip_alerts where stop_id = p_stop_id and alert_type = 'ask_office' and resolution is null;
  if v_id is not null then return v_id; end if;
  insert into public.trip_alerts (trip_id, stop_id, alert_type, note, raised_by)
  values (p_trip_id, p_stop_id, 'ask_office', jsonb_build_object('mode', p_mode, 'amount', coalesce(p_amount,0), 'reason', p_reason)::text, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

CREATE OR REPLACE FUNCTION public.ask_office_status(p_alert_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare a public.trip_alerts; s public.delivery_settings; v_deadline timestamptz;
begin
  select * into a from public.trip_alerts where id = p_alert_id and alert_type = 'ask_office';
  if a.id is null or not public._is_my_trip(a.trip_id) then raise exception 'Not allowed'; end if;
  select * into s from public.delivery_settings where company_id = public.my_company_id();
  v_deadline := a.raised_at + make_interval(mins => coalesce(s.ask_office_wait_minutes, 15));
  if a.resolution is null and now() >= v_deadline then
    update public.trip_alerts set resolution = 'no_reply:' || coalesce(s.ask_office_no_reply, 'deliver_and_flag'), resolved_at = now()
      where id = a.id returning * into a;
  end if;
  return jsonb_build_object('resolution', a.resolution, 'deadline', v_deadline, 'now', now());
end $$;

CREATE OR REPLACE FUNCTION public.flag_load_mismatch(p_trip_id uuid, p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_id uuid;
begin
  if not public.has_perm('dispatch', 'view') then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Reason required'; end if;
  insert into public.trip_alerts (trip_id, alert_type, note, raised_by) values (p_trip_id, 'load_mismatch', p_note, auth.uid()) returning id into v_id;
  return v_id;
end $$;

CREATE OR REPLACE FUNCTION public.trip_return_expected(p_trip_id uuid)
RETURNS TABLE(product_id uuid, kind text, expected_qty numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  with given as (
    select ol.product_id, sum(dl.delivered_qty) d, sum(dl.damaged_qty) dm, sum(dl.refused_qty) rf, sum(dl.empties_returned) em
    from public.delivery_lines dl join public.trip_stops s on s.id = dl.stop_id join public.order_lines ol on ol.id = dl.order_line_id
    where s.trip_id = p_trip_id group by ol.product_id),
  pick as (select product_id, sum(qty) q from public.trip_pickups where trip_id = p_trip_id group by product_id),
  base as (
    select l.product_id, coalesce(l.loaded_qty,0) loaded, coalesce(g.d,0) d, coalesce(g.dm,0) dm, coalesce(g.rf,0) rf, coalesce(g.em,0) em
    from public.trip_loading l left join given g on g.product_id = l.product_id where l.trip_id = p_trip_id)
  select product_id, 'undelivered', greatest(loaded - d - dm - rf, 0) from base where public.has_perm('dispatch','view')
  union all select product_id, 'damaged', dm from base where public.has_perm('dispatch','view')
  union all select product_id, 'refused', rf from base where public.has_perm('dispatch','view')
  union all select coalesce(b.product_id, p.product_id), 'empties', coalesce(b.em,0) + coalesce(p.q,0)
    from base b full join pick p on p.product_id = b.product_id where public.has_perm('dispatch','view')
  union all select null::uuid, 'crates', coalesce(sum(crates_count),0) from public.trip_loading where trip_id = p_trip_id and public.has_perm('dispatch','view')
$$;

CREATE OR REPLACE FUNCTION public.receive_returns(p_trip_id uuid, p_lines jsonb, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_t public.trips; l jsonb; v_diff text := '';
begin
  if not public.has_perm('dispatch', 'view') then raise exception 'Not allowed'; end if;
  select * into v_t from public.trips where id = p_trip_id for update;
  if v_t.id is null then raise exception 'Trip not found'; end if;
  if v_t.gate_in_at is null then raise exception 'Vehicle not back yet'; end if;
  if v_t.returns_received_at is not null then raise exception 'Returns already received'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.trip_returns (trip_id, product_id, kind, expected_qty, actual_qty, note)
    values (p_trip_id, nullif(l->>'product_id','')::uuid, l->>'kind', coalesce((l->>'expected')::numeric,0), coalesce((l->>'actual')::numeric,0), p_note);
    if (l->>'kind') = 'undelivered' and coalesce((l->>'actual')::numeric,0) > 0 then
      insert into public.stock_movements (company_id, unit_id, product_id, qty, movement_type, ref_type, ref_id, created_by)
      values (v_t.company_id, v_t.unit_id, (l->>'product_id')::uuid, (l->>'actual')::numeric, 'return', 'trip', p_trip_id, auth.uid());
    end if;
    if coalesce((l->>'expected')::numeric,0) <> coalesce((l->>'actual')::numeric,0) then
      v_diff := v_diff || format('%s %s: expected %s, got %s; ', l->>'kind', coalesce(l->>'name',''), l->>'expected', l->>'actual');
    end if;
  end loop;
  if v_diff <> '' then
    insert into public.trip_alerts (trip_id, alert_type, note, raised_by) values (p_trip_id, 'return_mismatch', v_diff || coalesce(p_note,''), auth.uid());
  end if;
  update public.trips set returns_received_at = now() where id = p_trip_id;
end $$;

GRANT EXECUTE ON FUNCTION public.ask_office(uuid,uuid,text,numeric,text), public.ask_office_status(uuid), public.flag_load_mismatch(uuid,text), public.trip_return_expected(uuid), public.receive_returns(uuid,jsonb,text) TO authenticated;