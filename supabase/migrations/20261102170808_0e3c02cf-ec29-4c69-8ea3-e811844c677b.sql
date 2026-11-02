
INSERT INTO public.role_permissions (role_id, module, action)
SELECT r.id, 'gate', 'create' FROM public.roles r
WHERE r.code IN ('SECURITY','ADMIN')
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x WHERE x.role_id = r.id AND x.module='gate' AND x.action='create');

ALTER TABLE public.delivery_settings ADD COLUMN IF NOT EXISTS visitor_photo text NOT NULL DEFAULT 'optional';

ALTER TABLE public.gate_entries
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'visitor',
  ADD COLUMN IF NOT EXISTS from_place text,
  ADD COLUMN IF NOT EXISTS meet_user_id uuid,
  ADD COLUMN IF NOT EXISTS people_count int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS photo_path text,
  ADD COLUMN IF NOT EXISTS courier_name text,
  ADD COLUMN IF NOT EXISTS parcel_count int;

CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  ref_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.staff_notifications TO authenticated;
GRANT ALL ON public.staff_notifications TO service_role;
ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own notifications read" ON public.staff_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Own notifications mark read" ON public.staff_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.gate_problems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.my_company_id(),
  problem_type text NOT NULL,
  note text,
  photo_path text,
  raised_by uuid NOT NULL DEFAULT auth.uid(),
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gate_problems TO authenticated;
GRANT ALL ON public.gate_problems TO service_role;
ALTER TABLE public.gate_problems ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gate staff read problems" ON public.gate_problems FOR SELECT TO authenticated
  USING (company_id = public.my_company_id() AND public.has_perm('gate','create'));

CREATE TABLE IF NOT EXISTS public.guard_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  guard_user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  selfie_path text,
  handed_over_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.guard_shifts TO authenticated;
GRANT ALL ON public.guard_shifts TO service_role;
ALTER TABLE public.guard_shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gate staff read shifts" ON public.guard_shifts FOR SELECT TO authenticated
  USING (company_id = public.my_company_id() AND public.has_perm('gate','create'));

CREATE TABLE IF NOT EXISTS public.material_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.my_company_id(),
  pass_no text NOT NULL,
  qr_token text NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(12),'hex'),
  direction text NOT NULL DEFAULT 'out',
  party text,
  vehicle_no text,
  items text NOT NULL,
  is_returnable boolean NOT NULL DEFAULT false,
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  scanned_at timestamptz,
  scanned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.material_passes TO authenticated;
GRANT ALL ON public.material_passes TO service_role;
ALTER TABLE public.material_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read material passes" ON public.material_passes FOR SELECT TO authenticated
  USING (company_id = public.my_company_id() AND public.is_staff());

INSERT INTO public.material_passes (company_id, pass_no, qr_token, direction, party, vehicle_no, items)
SELECT p.company_id, 'MP-QA-0001', 'qa-material-0001', 'out', 'QA test data — Repair shop', 'QA-MH24-0001', '2 × empty 20L jars (QA test)'
FROM public.user_profiles p WHERE p.mobile = '+919999900014'
ON CONFLICT (qr_token) DO NOTHING;

UPDATE public.gate_entries SET out_at = now(), updated_at = now()
 WHERE out_at IS NULL AND mobile IN ('+919999900011','+919999900013');

DROP FUNCTION IF EXISTS public.gate_entry_in(text,text,text,text);

CREATE OR REPLACE FUNCTION public.gate_find_person(p_mobile text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m text := '+91' || right(regexp_replace(coalesce(p_mobile,''), '\D', '', 'g'), 10); r record; l record;
  ins boolean;
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  ins := EXISTS (SELECT 1 FROM gate_entries WHERE mobile = m AND out_at IS NULL AND company_id = my_company_id());
  SELECT id, full_name INTO r FROM user_profiles
   WHERE mobile = m AND company_id = my_company_id() AND is_active AND user_type = 'staff' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('mobile', m, 'found', true, 'is_staff', true, 'name', r.full_name, 'user_id', r.id, 'inside', ins);
  END IF;
  SELECT name, from_place, entry_type, meet_user_id, vehicle_no, courier_name INTO l FROM gate_entries
   WHERE mobile = m AND company_id = my_company_id() AND person_type <> 'staff' ORDER BY in_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('mobile', m, 'found', true, 'is_staff', false, 'name', l.name, 'from_place', l.from_place,
      'entry_type', l.entry_type, 'meet_user_id', l.meet_user_id, 'vehicle_no', l.vehicle_no, 'courier_name', l.courier_name, 'inside', ins);
  END IF;
  SELECT full_name INTO r FROM user_profiles WHERE mobile = m AND company_id = my_company_id() AND is_active LIMIT 1;
  RETURN jsonb_build_object('mobile', m, 'found', FOUND, 'is_staff', false, 'name', r.full_name, 'inside', ins);
END $$;

CREATE OR REPLACE FUNCTION public.gate_staff_list()
RETURNS TABLE(id uuid, full_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name FROM user_profiles p
   WHERE public.has_perm('gate','create') AND p.company_id = my_company_id() AND p.user_type = 'staff' AND p.is_active AND p.full_name IS NOT NULL
   ORDER BY p.full_name;
$$;

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
  IF meet IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = meet AND company_id = cid AND user_type='staff') THEN RAISE EXCEPTION 'bad_staff'; END IF;
  SELECT coalesce(visitor_photo,'optional') INTO photo_rule FROM delivery_settings WHERE company_id = cid;
  IF coalesce(photo_rule,'optional') = 'required' AND coalesce(p->>'photo_path','') = '' THEN RAISE EXCEPTION 'photo_required'; END IF;
  INSERT INTO gate_entries (mobile, name, person_type, entry_type, from_place, meet_user_id, purpose, vehicle_no, people_count, photo_path, courier_name, parcel_count)
  VALUES (m, trim(p->>'name'), 'visitor', et, nullif(trim(p->>'from_place'),''), meet, nullif(trim(p->>'purpose'),''),
    nullif(upper(trim(p->>'vehicle_no')),''), greatest(1, coalesce(nullif(p->>'people_count','')::int,1)),
    CASE WHEN photo_rule = 'off' THEN NULL ELSE nullif(p->>'photo_path','') END,
    nullif(trim(p->>'courier_name'),''), nullif(p->>'parcel_count','')::int)
  RETURNING id INTO nid;
  IF meet IS NOT NULL THEN
    INSERT INTO staff_notifications (company_id, user_id, kind, title, body, ref_id)
    VALUES (cid, meet, CASE WHEN et='parcel' THEN 'gate_parcel' ELSE 'gate_visitor' END,
      CASE WHEN et='parcel' THEN 'Parcel at gate' ELSE 'Visitor at gate' END,
      trim(p->>'name') || coalesce(' (' || nullif(trim(p->>'from_place'),'') || ')','')
        || CASE WHEN et='parcel' THEN coalesce(' · ' || (p->>'parcel_count') || ' parcel(s)','') ELSE coalesce(' · ' || nullif(trim(p->>'purpose'),''),'') END,
      nid);
  END IF;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.gate_entry_out(p_entry_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE gate_entries SET out_at = now(), out_by = auth.uid(), updated_at = now()
   WHERE id = p_entry_id AND out_at IS NULL AND company_id = my_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_inside'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.gate_report_problem(p_type text, p_note text, p_photo text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nid uuid;
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_type NOT IN ('vehicle','person','material','safety','other') THEN RAISE EXCEPTION 'bad_type'; END IF;
  IF coalesce(trim(p_note),'') = '' THEN RAISE EXCEPTION 'note_required'; END IF;
  INSERT INTO gate_problems (problem_type, note, photo_path) VALUES (p_type, trim(p_note), nullif(p_photo,'')) RETURNING id INTO nid;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.gate_scan_lookup(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; mp record; tok text := trim(coalesce(p_token,''));
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT tr.id, tr.trip_no, tr.gate_out_at, tr.gate_in_at, tr.status, v.reg_no INTO t
    FROM gate_passes g JOIN trips tr ON tr.id = g.trip_id LEFT JOIN vehicles v ON v.id = tr.vehicle_id
   WHERE g.qr_token = tok AND tr.company_id = my_company_id();
  IF FOUND THEN
    RETURN jsonb_build_object('kind', CASE WHEN t.gate_out_at IS NULL THEN 'trip_out' WHEN t.gate_in_at IS NULL THEN 'trip_in' ELSE 'trip_done' END,
      'trip_id', t.id, 'trip_no', t.trip_no, 'reg_no', t.reg_no, 'status', t.status);
  END IF;
  SELECT * INTO mp FROM material_passes WHERE qr_token = tok AND company_id = my_company_id();
  IF FOUND THEN
    RETURN jsonb_build_object('kind', CASE WHEN mp.scanned_at IS NULL THEN 'material' ELSE 'material_done' END,
      'id', mp.id, 'pass_no', mp.pass_no, 'direction', mp.direction, 'party', mp.party, 'vehicle_no', mp.vehicle_no, 'items', mp.items, 'scanned_at', mp.scanned_at);
  END IF;
  RETURN jsonb_build_object('kind', 'unknown');
END $$;

CREATE OR REPLACE FUNCTION public.gate_material_scan(p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE material_passes SET scanned_at = now(), scanned_by = auth.uid(), updated_at = now()
   WHERE qr_token = trim(p_token) AND scanned_at IS NULL AND company_id = my_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'pass_used_or_missing'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.gate_change_guard(p_mobile text, p_pin text, p_selfie text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE m text := '+91' || right(regexp_replace(coalesce(p_mobile,''), '\D', '', 'g'), 10);
  g record; ph text; cid uuid := my_company_id(); ok boolean;
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF coalesce(p_selfie,'') = '' THEN RAISE EXCEPTION 'selfie_required'; END IF;
  SELECT id, full_name INTO g FROM user_profiles WHERE mobile = m AND user_type='staff' AND company_id = cid AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'guard_not_found'; END IF;
  IF g.id = auth.uid() THEN RAISE EXCEPTION 'same_guard'; END IF;
  SELECT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active JOIN role_permissions rp ON rp.role_id=r.id
     WHERE ur.user_id = g.id AND rp.module='gate' AND rp.action='create') INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'not_a_guard'; END IF;
  SELECT pin_hash INTO ph FROM user_pins WHERE user_id = g.id;
  IF ph IS NULL OR ph <> crypt(p_pin, ph) THEN RAISE EXCEPTION 'wrong_pin'; END IF;
  UPDATE guard_shifts SET ended_at = now(), updated_at = now() WHERE company_id = cid AND ended_at IS NULL;
  INSERT INTO guard_shifts (company_id, guard_user_id, selfie_path, handed_over_by) VALUES (cid, g.id, p_selfie, auth.uid());
  RETURN jsonb_build_object('name', g.full_name);
END $$;

CREATE OR REPLACE FUNCTION public.gate_register(p_from timestamptz, p_to timestamptz, p_kind text DEFAULT NULL)
RETURNS TABLE(at timestamptz, kind text, title text, detail text, by_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ok AS (SELECT public.has_perm('gate','create') AS v, my_company_id() AS cid),
  rws AS (
    SELECT e.in_at AS at, 'entry_in'::text AS kind, e.name AS title,
      concat_ws(' · ', e.entry_type, e.mobile, e.from_place, e.purpose, e.vehicle_no, CASE WHEN e.people_count > 1 THEN e.people_count || ' people' END,
        CASE WHEN e.entry_type='parcel' THEN coalesce(e.courier_name,'') || coalesce(' ' || e.parcel_count || ' parcel(s)','') END) AS detail, e.in_by AS who
      FROM gate_entries e, ok WHERE e.company_id = ok.cid
    UNION ALL SELECT e.out_at, 'entry_out', e.name, concat_ws(' · ', e.entry_type, e.mobile), e.out_by FROM gate_entries e, ok WHERE e.company_id = ok.cid AND e.out_at IS NOT NULL
    UNION ALL SELECT t.gate_out_at, 'vehicle_out', t.trip_no, v.reg_no, NULL::uuid FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id, ok WHERE t.company_id = ok.cid AND t.gate_out_at IS NOT NULL
    UNION ALL SELECT t.gate_in_at, 'vehicle_in', t.trip_no, v.reg_no, NULL::uuid FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id, ok WHERE t.company_id = ok.cid AND t.gate_in_at IS NOT NULL
    UNION ALL SELECT m.scanned_at, 'material', m.pass_no, concat_ws(' · ', m.direction, m.party, m.items, m.vehicle_no), m.scanned_by FROM material_passes m, ok WHERE m.company_id = ok.cid AND m.scanned_at IS NOT NULL
    UNION ALL SELECT p.raised_at, 'problem', p.problem_type, p.note, p.raised_by FROM gate_problems p, ok WHERE p.company_id = ok.cid
    UNION ALL SELECT s.started_at, 'guard', u.full_name, 'shift start', s.handed_over_by FROM guard_shifts s JOIN user_profiles u ON u.id = s.guard_user_id, ok WHERE s.company_id = ok.cid
  )
  SELECT r.at, r.kind, r.title, r.detail, u.full_name FROM rws r LEFT JOIN user_profiles u ON u.id = r.who, ok
   WHERE ok.v AND r.at >= p_from AND r.at < p_to
     AND (p_kind IS NULL OR p_kind = '' OR r.kind = p_kind OR (p_kind='entry' AND r.kind LIKE 'entry_%') OR (p_kind='vehicle' AND r.kind LIKE 'vehicle_%'))
   ORDER BY r.at DESC LIMIT 500;
$$;

REVOKE ALL ON FUNCTION public.gate_find_person(text), public.gate_staff_list(), public.gate_entry_in(jsonb), public.gate_entry_out(uuid),
  public.gate_report_problem(text,text,text), public.gate_scan_lookup(text), public.gate_material_scan(text),
  public.gate_change_guard(text,text,text), public.gate_register(timestamptz,timestamptz,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gate_find_person(text), public.gate_staff_list(), public.gate_entry_in(jsonb), public.gate_entry_out(uuid),
  public.gate_report_problem(text,text,text), public.gate_scan_lookup(text), public.gate_material_scan(text),
  public.gate_change_guard(text,text,text), public.gate_register(timestamptz,timestamptz,text) TO authenticated;
