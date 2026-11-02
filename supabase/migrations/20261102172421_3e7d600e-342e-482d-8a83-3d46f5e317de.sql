
ALTER TABLE public.gate_entries
  ADD COLUMN IF NOT EXISTS challan_photo_path text,
  ADD COLUMN IF NOT EXISTS handed_at timestamptz,
  ADD COLUMN IF NOT EXISTS handed_to text,
  ADD COLUMN IF NOT EXISTS handed_by uuid;

INSERT INTO public.roles (company_id, code, name, name_hi, name_mr, description, is_system, is_active)
SELECT DISTINCT r.company_id, 'STORE', 'Store', 'स्टोर', 'स्टोअर', 'Receives supplier vehicle notices from the gate', false, true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.roles x WHERE x.company_id = r.company_id AND x.code = 'STORE');

INSERT INTO public.role_permissions (role_id, module, action)
SELECT r.id, 'gate_supplier', 'view' FROM public.roles r
WHERE r.code IN ('STORE','ADMIN')
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = r.id AND x.module='gate_supplier' AND x.action='view');

CREATE OR REPLACE FUNCTION public.gate_entry_in(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m text := '+91' || right(regexp_replace(coalesce(p->>'mobile',''), '\D', '', 'g'), 10);
  sid uuid; sname text; nid uuid; et text := coalesce(nullif(p->>'entry_type',''),'visitor');
  meet uuid := nullif(p->>'meet_user_id','')::uuid; photo_rule text; cid uuid := my_company_id();
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF length(m) <> 13 THEN RAISE EXCEPTION 'bad_mobile'; END IF;
  IF EXISTS (SELECT 1 FROM gate_entries WHERE mobile = m AND out_at IS NULL AND company_id = cid) THEN RAISE EXCEPTION 'already_inside'; END IF;
  SELECT id, full_name INTO sid, sname FROM user_profiles WHERE mobile = m AND user_type = 'staff' AND company_id = cid AND is_active LIMIT 1;
  IF sid IS NOT NULL THEN
    INSERT INTO gate_entries (mobile, name, person_type, staff_user_id, entry_type) VALUES (m, sname, 'staff', sid, 'staff') RETURNING id INTO nid;
    RETURN nid;
  END IF;
  IF et NOT IN ('visitor','parcel','supplier','other') THEN RAISE EXCEPTION 'bad_type'; END IF;
  IF coalesce(trim(p->>'name'),'') = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF et = 'supplier' AND coalesce(trim(p->>'vehicle_no'),'') = '' THEN RAISE EXCEPTION 'vehicle_required'; END IF;
  IF meet IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = meet AND company_id = cid AND user_type='staff') THEN RAISE EXCEPTION 'bad_staff'; END IF;
  SELECT coalesce(visitor_photo,'optional') INTO photo_rule FROM delivery_settings WHERE company_id = cid;
  IF coalesce(photo_rule,'optional') = 'required' AND coalesce(p->>'photo_path','') = '' THEN RAISE EXCEPTION 'photo_required'; END IF;
  INSERT INTO gate_entries (mobile, name, person_type, entry_type, from_place, meet_user_id, purpose, vehicle_no, people_count, photo_path, courier_name, parcel_count, challan_photo_path)
  VALUES (m, trim(p->>'name'), 'visitor', et, nullif(trim(p->>'from_place'),''), meet, nullif(trim(p->>'purpose'),''),
    nullif(upper(trim(p->>'vehicle_no')),''), greatest(1, coalesce(nullif(p->>'people_count','')::int,1)),
    CASE WHEN photo_rule = 'off' THEN NULL ELSE nullif(p->>'photo_path','') END,
    nullif(trim(p->>'courier_name'),''), nullif(p->>'parcel_count','')::int, nullif(p->>'challan_photo_path',''))
  RETURNING id INTO nid;
  IF meet IS NOT NULL THEN
    INSERT INTO staff_notifications (company_id, user_id, kind, title, body, ref_id)
    VALUES (cid, meet, CASE WHEN et='parcel' THEN 'gate_parcel' ELSE 'gate_visitor' END,
      CASE WHEN et='parcel' THEN 'Parcel at gate' ELSE 'Visitor at gate' END,
      trim(p->>'name') || coalesce(' (' || nullif(trim(p->>'from_place'),'') || ')','')
        || CASE WHEN et='parcel' THEN coalesce(' · ' || (p->>'parcel_count') || ' parcel(s)','') ELSE coalesce(' · ' || nullif(trim(p->>'purpose'),''),'') END,
      nid);
  END IF;
  IF et = 'supplier' THEN
    INSERT INTO staff_notifications (company_id, user_id, kind, title, body, ref_id)
    SELECT DISTINCT cid, ur.user_id, 'gate_supplier', 'Supplier vehicle at gate',
      upper(trim(p->>'vehicle_no')) || ' · ' || coalesce(nullif(trim(p->>'from_place'),''), trim(p->>'name')), nid
    FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.is_active AND r.company_id = cid
    WHERE r.code = 'STORE';
  END IF;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.gate_parcel_handover(p_entry_id uuid, p_received_by text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF coalesce(trim(p_received_by),'') = '' THEN RAISE EXCEPTION 'receiver_required'; END IF;
  UPDATE gate_entries SET handed_at = now(), handed_to = trim(p_received_by), handed_by = auth.uid(), updated_at = now()
   WHERE id = p_entry_id AND entry_type = 'parcel' AND handed_at IS NULL AND company_id = my_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'already_handed'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.gate_parcel_handover(uuid,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gate_parcel_handover(uuid,text) TO authenticated;

-- one-time action log for offline replays
CREATE TABLE IF NOT EXISTS public.client_ops (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  rpc text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.client_ops TO authenticated;
GRANT ALL ON public.client_ops TO service_role;
ALTER TABLE public.client_ops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own ops read" ON public.client_ops FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own ops insert" ON public.client_ops FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.run_op(p_op_id uuid, p_rpc text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE prev jsonb; fn oid; names text[]; types oid[]; nin int; sets boolean; rt oid;
  parts text[] := '{}'; i int; res jsonb; k text; sqltxt text;
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
  -- pick the overload whose argument names cover every key sent
  SELECT p.oid, p.proargnames, p.proargtypes::oid[], p.pronargs, p.proretset, p.prorettype
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
REVOKE ALL ON FUNCTION public.run_op(uuid,text,jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.run_op(uuid,text,jsonb) TO authenticated;
