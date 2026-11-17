ALTER TABLE public.products ADD COLUMN IF NOT EXISTS packs_per_crate integer;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS crates_planned integer,
  ADD COLUMN IF NOT EXISTS crates_planned_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crates_loaded integer,
  ADD COLUMN IF NOT EXISTS crates_load_reason text,
  ADD COLUMN IF NOT EXISTS crates_returned integer,
  ADD COLUMN IF NOT EXISTS crates_return_reason text;

-- Move existing crate entries (saved on products) to the trip.
UPDATE public.trips t SET crates_loaded = s.c
  FROM (SELECT trip_id, sum(crates_count)::int c FROM public.trip_loading WHERE coalesce(crates_count,0) > 0 GROUP BY trip_id) s
 WHERE s.trip_id = t.id AND t.crates_loaded IS NULL;
UPDATE public.trip_loading SET crates_count = NULL WHERE crates_count IS NOT NULL;

-- Planned crates: Dispatch value if set, else packs / packs-per-crate for crated products.
CREATE OR REPLACE FUNCTION public.trip_crates_plan(p_trip_id uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN t.crates_planned_manual THEN coalesce(t.crates_planned,0) ELSE
    coalesce((SELECT sum(ceil(l.planned_qty / p.packs_per_crate))::int FROM trip_loading l JOIN products p ON p.id = l.product_id
               WHERE l.trip_id = t.id AND coalesce(p.packs_per_crate,0) > 0),0) END
    FROM trips t WHERE t.id = p_trip_id AND t.company_id = my_company_id() AND public.has_perm('dispatch','view');
$$;
REVOKE ALL ON FUNCTION public.trip_crates_plan(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.trip_crates_plan(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_trip_crates_planned(p_trip_id uuid, p_crates integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not public.has_perm('dispatch','edit') then raise exception 'Not allowed'; end if;
  update public.trips set crates_planned = greatest(p_crates,0), crates_planned_manual = p_crates is not null
   where id = p_trip_id and company_id = public.my_company_id();
end $$;
REVOKE ALL ON FUNCTION public.set_trip_crates_planned(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_trip_crates_planned(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_trip_crates_loaded(p_trip_id uuid, p_crates integer, p_reason text DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_plan int;
begin
  if not (public.has_perm('dispatch', 'edit') or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
          where ur.user_id = auth.uid() and r.code = 'LOADER')) then raise exception 'Not allowed'; end if;
  if p_crates is null or p_crates < 0 then raise exception 'Crates required'; end if;
  if not exists (select 1 from public.trips where id = p_trip_id and company_id = public.my_company_id() and status in ('planned','loading')) then
    raise exception 'Trip is not in loading'; end if;
  v_plan := coalesce(public.trip_crates_plan(p_trip_id),0);
  if p_crates <> v_plan and nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Reason required'; end if;
  update public.trips set crates_planned = case when crates_planned_manual then crates_planned else v_plan end,
         crates_loaded = p_crates, crates_load_reason = case when p_crates <> v_plan then btrim(p_reason) end
   where id = p_trip_id;
  if p_crates <> v_plan then
    insert into public.trip_alerts (trip_id, alert_type, note, raised_by)
    values (p_trip_id, 'load_mismatch', format('Crates: planned %s, loaded %s. %s', v_plan, p_crates, btrim(p_reason)), auth.uid());
  end if;
end $$;
REVOKE ALL ON FUNCTION public.confirm_trip_crates_loaded(uuid, integer, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.confirm_trip_crates_loaded(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.trip_return_expected(p_trip_id uuid)
 RETURNS TABLE(product_id uuid, kind text, expected_qty numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
  union all select null::uuid, 'crates', coalesce(t.crates_loaded,0)::numeric from public.trips t where t.id = p_trip_id and public.has_perm('dispatch','view')
$function$;

CREATE OR REPLACE FUNCTION public.receive_returns(p_trip_id uuid, p_lines jsonb, p_note text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    if (l->>'kind') = 'crates' then
      update public.trips set crates_returned = coalesce((l->>'actual')::numeric,0)::int,
             crates_return_reason = case when coalesce((l->>'expected')::numeric,0) <> coalesce((l->>'actual')::numeric,0) then p_note end
       where id = p_trip_id;
    end if;
    if coalesce((l->>'expected')::numeric,0) <> coalesce((l->>'actual')::numeric,0) then
      v_diff := v_diff || format('%s %s: expected %s, got %s; ', l->>'kind', coalesce(l->>'name',''), l->>'expected', l->>'actual');
    end if;
  end loop;
  if v_diff <> '' then
    insert into public.trip_alerts (trip_id, alert_type, note, raised_by) values (p_trip_id, 'return_mismatch', v_diff || coalesce(p_note,''), auth.uid());
  end if;
  update public.trips set returns_received_at = now() where id = p_trip_id;
end $function$;

CREATE OR REPLACE FUNCTION public.run_op(p_op_id uuid, p_rpc text, p_args jsonb)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $function$
DECLARE prev jsonb; fn oid; names text[]; types oid[]; nin int; sets boolean; rt oid;
  parts text[] := '{}'; i int; res jsonb; k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_rpc NOT IN ('gate_out','gate_in','gate_pickup_handover','gate_entry_in','gate_entry_out','gate_parcel_handover','gate_report_problem',
     'gate_material_scan','deliver_stop','record_collection','record_due_collection','add_trip_expense','record_pickup','spot_sale',
     'raise_trip_alert','end_trip','start_trip','mark_arrived','log_location','set_stop_later','record_loading','finalize_loading',
     'flag_load_mismatch','receive_returns','ask_office','settle_trip','record_cash_handover','confirm_cash_handover','confirm_trip_crates_loaded') THEN
    RAISE EXCEPTION 'op_not_allowed';
  END IF;
  SELECT result INTO prev FROM client_ops WHERE id = p_op_id AND user_id = auth.uid();
  IF FOUND THEN RETURN prev; END IF;
  SELECT p.oid, p.proargnames, string_to_array(nullif(p.proargtypes::text,''), ' ')::oid[], p.pronargs, p.proretset, p.prorettype
    INTO fn, names, types, nin, sets, rt
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = p_rpc
     AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_args) kk WHERE NOT (kk = ANY (p.proargnames[1:p.pronargs])))
   ORDER BY p.pronargs LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'op_bad_args'; END IF;
  FOR i IN 1..nin LOOP
    k := names[i];
    IF p_args ? k THEN
      parts := parts || format('%I => (CASE WHEN jsonb_typeof($1->%L) IN (''object'',''array'') THEN ($1->%L)::text ELSE $1->>%L END)::%s', k, k, k, k, format_type(types[i], NULL));
    END IF;
  END LOOP;
  IF rt = 'void'::regtype THEN
    EXECUTE format('SELECT public.%I(%s)', p_rpc, array_to_string(parts, ', ')) USING p_args;
    res := 'null'::jsonb;
  ELSIF sets THEN
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) FROM public.%I(%s) x', p_rpc, array_to_string(parts, ', ')) INTO res USING p_args;
  ELSE
    EXECUTE format('SELECT to_jsonb(public.%I(%s))', p_rpc, array_to_string(parts, ', ')) INTO res USING p_args;
  END IF;
  INSERT INTO client_ops (id, rpc, result) VALUES (p_op_id, p_rpc, res);
  RETURN res;
END $function$;