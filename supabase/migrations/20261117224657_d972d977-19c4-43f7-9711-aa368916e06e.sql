CREATE TABLE public.staff_photo_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  old_photo_path text,
  new_photo_path text NOT NULL,
  changed_by uuid NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX staff_photo_history_user_idx ON public.staff_photo_history(user_id, changed_at DESC);
GRANT SELECT ON public.staff_photo_history TO authenticated;
GRANT ALL ON public.staff_photo_history TO service_role;
ALTER TABLE public.staff_photo_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own photo history or user admins" ON public.staff_photo_history FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (company_id = public.my_company_id() AND public.has_perm('users','view')));

CREATE OR REPLACE FUNCTION public.set_my_photo(p_path text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old text; v_cid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_signed_in'; END IF;
  IF p_path IS NULL OR p_path !~ ('^team/' || auth.uid()::text || '/profile-') THEN RAISE EXCEPTION 'bad_photo_path'; END IF;
  SELECT photo_url, company_id INTO v_old, v_cid FROM user_profiles WHERE id = auth.uid() AND is_active AND user_type='staff' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_staff'; END IF;
  INSERT INTO staff_photo_history(company_id, user_id, old_photo_path, new_photo_path, changed_by) VALUES (v_cid, auth.uid(), v_old, p_path, auth.uid());
  UPDATE user_profiles SET photo_url = p_path, updated_at = now() WHERE id = auth.uid();
  RETURN p_path;
END $$;
REVOKE EXECUTE ON FUNCTION public.set_my_photo(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_my_photo(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.gate_register_timeline(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS TABLE(at timestamp with time zone, kind text, title text, detail text, by_name text, entry_id uuid, entry_type text, vehicle_no text, photo_path text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH ok AS (SELECT public.has_perm('gate','create') AS v, my_company_id() AS cid),
  rws AS (
    SELECT e.in_at AS at, 'entry_in'::text AS kind, e.name AS title, concat_ws(' · ', e.mobile, e.from_place, e.purpose) AS detail, e.in_by AS who, e.id AS eid, e.entry_type AS et, e.vehicle_no AS vno, coalesce(e.photo_path, sp.photo_url) AS ph
      FROM gate_entries e LEFT JOIN user_profiles sp ON sp.id = e.staff_user_id, ok WHERE e.company_id = ok.cid
    UNION ALL SELECT e.out_at, 'entry_out', e.name, e.mobile, e.out_by, e.id, e.entry_type, e.vehicle_no, coalesce(e.out_photo_path, e.photo_path, sp.photo_url) FROM gate_entries e LEFT JOIN user_profiles sp ON sp.id = e.staff_user_id, ok WHERE e.company_id = ok.cid AND e.out_at IS NOT NULL
    UNION ALL SELECT t.gate_out_at, 'vehicle_out', t.trip_no, coalesce(d.full_name, t.hired_driver_name), t.gate_out_by, NULL::uuid, 'trip', v.reg_no, d.photo_url FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN user_profiles d ON d.id=t.driver_user_id, ok WHERE t.company_id = ok.cid AND t.gate_out_at IS NOT NULL
    UNION ALL SELECT t.gate_in_at, 'vehicle_in', t.trip_no, concat_ws(' · ', coalesce(d.full_name, t.hired_driver_name), CASE WHEN t.gate_in_manual THEN 'manual' END), t.gate_in_by, NULL::uuid, 'trip', v.reg_no, d.photo_url FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN user_profiles d ON d.id=t.driver_user_id, ok WHERE t.company_id = ok.cid AND t.gate_in_at IS NOT NULL
  )
  SELECT r.at, r.kind, r.title, r.detail, u.full_name, r.eid, r.et, r.vno, r.ph FROM rws r LEFT JOIN user_profiles u ON u.id = r.who, ok
   WHERE ok.v AND r.at >= p_from AND r.at < p_to
   ORDER BY r.at DESC LIMIT 500;
$function$;