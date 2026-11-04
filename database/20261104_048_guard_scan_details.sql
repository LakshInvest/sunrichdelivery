CREATE OR REPLACE FUNCTION public.gate_scan_lookup(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE t record; mp record; tok text := trim(coalesce(p_token,'')); v_driver text; v_packs numeric;
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT tr.id, tr.trip_no, tr.gate_out_at, tr.gate_in_at, tr.status, tr.driver_user_id, tr.hired_driver_name, v.reg_no INTO t
    FROM gate_passes g JOIN trips tr ON tr.id = g.trip_id LEFT JOIN vehicles v ON v.id = tr.vehicle_id
   WHERE g.qr_token = tok AND tr.company_id = my_company_id();
  IF FOUND THEN
    SELECT full_name INTO v_driver FROM user_profiles WHERE id = t.driver_user_id;
    SELECT coalesce(sum(coalesce(loaded_qty, planned_qty)), 0) INTO v_packs FROM trip_loading WHERE trip_id = t.id;
    RETURN jsonb_build_object('kind', CASE WHEN t.gate_out_at IS NULL THEN 'trip_out' WHEN t.gate_in_at IS NULL THEN 'trip_in' ELSE 'trip_done' END,
      'trip_id', t.id, 'trip_no', t.trip_no, 'reg_no', t.reg_no, 'status', t.status,
      'driver', coalesce(v_driver, t.hired_driver_name), 'packs', v_packs);
  END IF;
  SELECT * INTO mp FROM material_passes WHERE qr_token = tok AND company_id = my_company_id();
  IF FOUND THEN
    RETURN jsonb_build_object('kind', CASE WHEN mp.scanned_at IS NOT NULL THEN 'material_done'
                                           WHEN mp.valid_till IS NOT NULL AND mp.valid_till < now() THEN 'material_expired'
                                           ELSE 'material' END,
      'id', mp.id, 'pass_no', mp.pass_no, 'direction', mp.direction, 'party', mp.party, 'vehicle_no', mp.vehicle_no, 'items', mp.items, 'scanned_at', mp.scanned_at);
  END IF;
  RETURN jsonb_build_object('kind', 'unknown');
END $function$;

ALTER TABLE public.delivery_settings ALTER COLUMN visitor_photo SET DEFAULT 'off';