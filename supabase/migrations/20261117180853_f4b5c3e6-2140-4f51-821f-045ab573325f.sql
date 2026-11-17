CREATE OR REPLACE FUNCTION public.gate_register_timeline(p_from timestamptz, p_to timestamptz)
 RETURNS TABLE(at timestamptz, kind text, title text, detail text, by_name text, entry_id uuid, entry_type text, vehicle_no text, photo_path text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH ok AS (SELECT public.has_perm('gate','create') AS v, my_company_id() AS cid),
  rws AS (
    SELECT e.in_at AS at, 'entry_in'::text AS kind, e.name AS title, concat_ws(' · ', e.mobile, e.from_place, e.purpose) AS detail, e.in_by AS who, e.id AS eid, e.entry_type AS et, e.vehicle_no AS vno, e.photo_path AS ph
      FROM gate_entries e, ok WHERE e.company_id = ok.cid
    UNION ALL SELECT e.out_at, 'entry_out', e.name, e.mobile, e.out_by, e.id, e.entry_type, e.vehicle_no, coalesce(e.out_photo_path, e.photo_path) FROM gate_entries e, ok WHERE e.company_id = ok.cid AND e.out_at IS NOT NULL
    UNION ALL SELECT t.gate_out_at, 'vehicle_out', t.trip_no, coalesce(d.full_name, t.hired_driver_name), t.gate_out_by, NULL::uuid, 'trip', v.reg_no, NULL::text FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN user_profiles d ON d.id=t.driver_user_id, ok WHERE t.company_id = ok.cid AND t.gate_out_at IS NOT NULL
    UNION ALL SELECT t.gate_in_at, 'vehicle_in', t.trip_no, concat_ws(' · ', coalesce(d.full_name, t.hired_driver_name), CASE WHEN t.gate_in_manual THEN 'manual' END), t.gate_in_by, NULL::uuid, 'trip', v.reg_no, NULL::text FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id LEFT JOIN user_profiles d ON d.id=t.driver_user_id, ok WHERE t.company_id = ok.cid AND t.gate_in_at IS NOT NULL
  )
  SELECT r.at, r.kind, r.title, r.detail, u.full_name, r.eid, r.et, r.vno, r.ph FROM rws r LEFT JOIN user_profiles u ON u.id = r.who, ok
   WHERE ok.v AND r.at >= p_from AND r.at < p_to
   ORDER BY r.at DESC LIMIT 500;
$function$;
REVOKE ALL ON FUNCTION public.gate_register_timeline(timestamptz, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gate_register_timeline(timestamptz, timestamptz) TO authenticated, service_role;