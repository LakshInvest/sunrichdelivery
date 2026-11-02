CREATE OR REPLACE FUNCTION public.run_op(p_op_id uuid, p_rpc text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE prev jsonb; fn oid; names text[]; types oid[]; nin int; sets boolean; rt oid;
  parts text[] := '{}'; i int; res jsonb; k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_rpc NOT IN ('gate_out','gate_in','gate_pickup_handover','gate_entry_in','gate_entry_out','gate_parcel_handover','gate_report_problem',
     'gate_material_scan','deliver_stop','record_collection','record_due_collection','add_trip_expense','record_pickup','spot_sale',
     'raise_trip_alert','end_trip','start_trip','mark_arrived','log_location','set_stop_later','record_loading','finalize_loading',
     'flag_load_mismatch','receive_returns','ask_office','settle_trip') THEN
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
END $$;