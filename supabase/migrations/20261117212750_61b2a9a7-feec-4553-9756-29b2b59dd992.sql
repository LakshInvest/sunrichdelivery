CREATE TABLE public.gate_qr_secret (company_id uuid PRIMARY KEY, secret text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32),'hex'), created_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.gate_qr_secret TO service_role;
ALTER TABLE public.gate_qr_secret ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.vehicle_qr_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(12),'hex'),
  active boolean NOT NULL DEFAULT true,
  revoked_at timestamptz, revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX vehicle_qr_one_active ON public.vehicle_qr_codes(vehicle_id) WHERE active;
GRANT SELECT, INSERT, UPDATE ON public.vehicle_qr_codes TO authenticated;
GRANT ALL ON public.vehicle_qr_codes TO service_role;
ALTER TABLE public.vehicle_qr_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Vehicle QR managers" ON public.vehicle_qr_codes FOR ALL TO authenticated
  USING (company_id = my_company_id() AND has_perm('vehicles','edit'))
  WITH CHECK (company_id = my_company_id() AND has_perm('vehicles','edit'));
INSERT INTO public.vehicle_qr_codes(company_id, vehicle_id) SELECT company_id, id FROM public.vehicles;

CREATE TABLE public.gate_scan_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
  kind text NOT NULL, ref_id uuid, label text, mode text NOT NULL, guard_id uuid, guard_name text,
  created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.gate_scan_log TO authenticated;
GRANT ALL ON public.gate_scan_log TO service_role;
ALTER TABLE public.gate_scan_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gate staff read scan log" ON public.gate_scan_log FOR SELECT TO authenticated
  USING (company_id = my_company_id() AND has_perm('gate','create'));

CREATE OR REPLACE FUNCTION public._gate_secret() RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s text; BEGIN
  SELECT secret INTO s FROM gate_qr_secret WHERE company_id = my_company_id();
  IF s IS NULL THEN INSERT INTO gate_qr_secret(company_id) VALUES (my_company_id()) ON CONFLICT DO NOTHING RETURNING secret INTO s;
    IF s IS NULL THEN SELECT secret INTO s FROM gate_qr_secret WHERE company_id = my_company_id(); END IF; END IF;
  RETURN s; END $$;
REVOKE ALL ON FUNCTION public._gate_secret() FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_staff_qr() RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ts bigint := extract(epoch from now())::bigint; msg text; BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND user_type='staff' AND is_active) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  msg := auth.uid()::text || '.' || ts;
  RETURN 'SQR1.' || msg || '.' || left(encode(extensions.hmac(msg, _gate_secret(), 'sha256'),'hex'), 24);
END $$;
REVOKE ALL ON FUNCTION public.my_staff_qr() FROM public, anon; GRANT EXECUTE ON FUNCTION public.my_staff_qr() TO authenticated;

CREATE OR REPLACE FUNCTION public._gate_staff_hit(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object('kind', CASE WHEN p.is_active THEN 'staff' ELSE 'staff_inactive' END, 'staff_id', p.id, 'driver', p.full_name, 'photo', p.photo_url,
    'role', (SELECT string_agg(r.code, ', ') FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=p.id))
  FROM user_profiles p WHERE p.id = p_id AND p.company_id = my_company_id() AND p.user_type='staff' $$;
REVOKE ALL ON FUNCTION public._gate_staff_hit(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._gate_vehicle_hit(p_vehicle uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t record; v_driver text; v_photo text; v_packs numeric; BEGIN
  SELECT tr.id, tr.trip_no, tr.gate_out_at, tr.gate_in_at, tr.status, tr.driver_user_id, tr.hired_driver_name, v.reg_no, g.qr_token INTO t
    FROM trips tr JOIN vehicles v ON v.id=tr.vehicle_id JOIN gate_passes g ON g.trip_id=tr.id
   WHERE v.id=p_vehicle AND tr.company_id=my_company_id() AND tr.status NOT IN ('settled','cancelled') AND tr.gate_in_at IS NULL
   ORDER BY tr.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('kind','vehicle_no_trip','reg_no',(SELECT reg_no FROM vehicles WHERE id=p_vehicle)); END IF;
  SELECT full_name, photo_url INTO v_driver, v_photo FROM user_profiles WHERE id=t.driver_user_id;
  SELECT coalesce(sum(coalesce(loaded_qty, planned_qty)),0) INTO v_packs FROM trip_loading WHERE trip_id=t.id;
  RETURN jsonb_build_object('kind', CASE WHEN t.gate_out_at IS NULL THEN 'trip_out' ELSE 'trip_in' END, 'trip_id', t.id, 'trip_no', t.trip_no,
    'reg_no', t.reg_no, 'status', t.status, 'token', t.qr_token, 'driver', coalesce(v_driver, t.hired_driver_name), 'photo', v_photo, 'packs', v_packs);
END $$;
REVOKE ALL ON FUNCTION public._gate_vehicle_hit(uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._gate_log(p_kind text, p_ref uuid, p_label text, p_mode text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO gate_scan_log(company_id, kind, ref_id, label, mode, guard_id, guard_name)
  VALUES (my_company_id(), p_kind, p_ref, p_label, p_mode, auth.uid(), (SELECT full_name FROM user_profiles WHERE id=auth.uid())) $$;
REVOKE ALL ON FUNCTION public._gate_log(text,uuid,text,text) FROM public, anon, authenticated;

DROP FUNCTION IF EXISTS public.gate_scan_lookup(text);
CREATE FUNCTION public.gate_scan_lookup(p_token text)
 RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; mp record; tok text := trim(coalesce(p_token,'')); v_driver text; v_packs numeric; parts text[]; v_uid uuid; v_ts bigint; vq record; h jsonb;
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  -- signed staff QR: SQR1.<staff id>.<epoch>.<sig>, valid 90 seconds
  IF tok ~* '^SQR1\.' THEN
    parts := string_to_array(tok, '.');
    IF array_length(parts,1) <> 4 OR parts[2] !~* '^[0-9a-f-]{36}$' OR parts[3] !~ '^\d{1,12}$'
       OR left(encode(extensions.hmac(parts[2]||'.'||parts[3], _gate_secret(), 'sha256'),'hex'),24) <> lower(parts[4]) THEN
      RETURN jsonb_build_object('kind','staff_qr_bad'); END IF;
    v_uid := parts[2]::uuid; v_ts := parts[3]::bigint;
    IF abs(extract(epoch from now())::bigint - v_ts) > 90 THEN RETURN jsonb_build_object('kind','staff_qr_old'); END IF;
    h := _gate_staff_hit(v_uid);
    IF h IS NULL THEN RETURN jsonb_build_object('kind','unknown'); END IF;
    IF h->>'kind'='staff' THEN PERFORM _gate_log('staff', v_uid, h->>'driver', 'qr'); END IF;
    RETURN h;
  END IF;
  -- vehicle QR: secret random code (optionally VQR1.<code>)
  SELECT q.* INTO vq FROM vehicle_qr_codes q WHERE q.company_id=my_company_id() AND q.code = lower(regexp_replace(tok,'^VQR1[.:]','','i'));
  IF FOUND THEN
    IF NOT vq.active THEN RETURN jsonb_build_object('kind','vehicle_qr_cancelled'); END IF;
    RETURN _gate_vehicle_hit(vq.vehicle_id);
  END IF;
  SELECT tr.id, tr.trip_no, tr.gate_out_at, tr.gate_in_at, tr.status, tr.driver_user_id, tr.hired_driver_name, v.reg_no INTO t
    FROM gate_passes g JOIN trips tr ON tr.id = g.trip_id LEFT JOIN vehicles v ON v.id = tr.vehicle_id
   WHERE g.qr_token = tok AND tr.company_id = my_company_id();
  IF FOUND THEN
    SELECT full_name INTO v_driver FROM user_profiles WHERE id = t.driver_user_id;
    SELECT coalesce(sum(coalesce(loaded_qty, planned_qty)), 0) INTO v_packs FROM trip_loading WHERE trip_id = t.id;
    RETURN jsonb_build_object('kind', CASE WHEN t.status IN ('cancelled') THEN 'trip_done' WHEN t.gate_out_at IS NULL THEN 'trip_out' WHEN t.gate_in_at IS NULL THEN 'trip_in' ELSE 'trip_done' END,
      'trip_id', t.id, 'trip_no', t.trip_no, 'reg_no', t.reg_no, 'status', t.status, 'token', tok,
      'driver', coalesce(v_driver, t.hired_driver_name), 'packs', v_packs);
  END IF;
  SELECT * INTO mp FROM material_passes WHERE qr_token = tok AND company_id = my_company_id();
  IF FOUND THEN
    RETURN jsonb_build_object('kind', CASE WHEN mp.scanned_at IS NOT NULL THEN 'material_done'
                                           WHEN mp.valid_till IS NOT NULL AND mp.valid_till < current_date THEN 'material_expired'
                                           ELSE 'material' END,
      'id', mp.id, 'pass_no', mp.pass_no, 'direction', mp.direction, 'party', mp.party, 'vehicle_no', mp.vehicle_no, 'items', mp.items, 'scanned_at', mp.scanned_at);
  END IF;
  -- plain mobile numbers and number plates are no longer accepted as QR codes (manual search only)
  RETURN jsonb_build_object('kind', 'unknown');
END $function$;
REVOKE ALL ON FUNCTION public.gate_scan_lookup(text) FROM public, anon; GRANT EXECUTE ON FUNCTION public.gate_scan_lookup(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.gate_manual_search(p_q text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d text := right(regexp_replace(coalesce(p_q,''),'\D','','g'),10); pl text := upper(regexp_replace(coalesce(p_q,''),'[^A-Za-z0-9]','','g')); res jsonb := '[]'::jsonb; BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF length(pl) < 4 THEN RETURN res; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind','staff','id',p.id,'name',p.full_name,'photo',p.photo_url,'sub',p.mobile,
     'role',(SELECT string_agg(r.code, ', ') FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=p.id))),'[]') INTO res
   FROM (SELECT * FROM user_profiles WHERE company_id=my_company_id() AND user_type='staff' AND is_active AND length(d)=10 AND mobile='+91'||d LIMIT 5) p;
  res := res || coalesce((SELECT jsonb_agg(jsonb_build_object('kind','vehicle','id',v.id,'name',v.reg_no,'photo',NULL,'sub',NULL))
   FROM (SELECT * FROM vehicles WHERE company_id=my_company_id() AND upper(regexp_replace(reg_no,'[^A-Za-z0-9]','','g')) LIKE '%'||pl||'%' LIMIT 5) v),'[]');
  RETURN res; END $$;
REVOKE ALL ON FUNCTION public.gate_manual_search(text) FROM public, anon; GRANT EXECUTE ON FUNCTION public.gate_manual_search(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.gate_manual_confirm(p_kind text, p_id uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE h jsonb; BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_kind='staff' THEN h := _gate_staff_hit(p_id);
  ELSIF p_kind='vehicle' AND EXISTS (SELECT 1 FROM vehicles WHERE id=p_id AND company_id=my_company_id()) THEN h := _gate_vehicle_hit(p_id);
  ELSE RAISE EXCEPTION 'not_found'; END IF;
  IF h IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  PERFORM _gate_log(p_kind, p_id, coalesce(h->>'driver', h->>'reg_no'), 'manual');
  RETURN h || jsonb_build_object('manual', true, 'guard', (SELECT full_name FROM user_profiles WHERE id=auth.uid()));
END $$;
REVOKE ALL ON FUNCTION public.gate_manual_confirm(text,uuid) FROM public, anon; GRANT EXECUTE ON FUNCTION public.gate_manual_confirm(text,uuid) TO authenticated;