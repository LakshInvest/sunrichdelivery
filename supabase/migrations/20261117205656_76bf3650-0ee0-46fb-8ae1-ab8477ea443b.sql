CREATE OR REPLACE FUNCTION public.gate_scan_lookup(p_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; mp record; tok text := trim(coalesce(p_token,'')); v_driver text; v_packs numeric; v_tok text; s record; v_digits text;
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  -- own vehicle QR: the vehicle number -> its open trip's gate pass
  IF tok <> '' THEN
    SELECT g.qr_token INTO v_tok FROM vehicles v JOIN trips tr ON tr.vehicle_id=v.id JOIN gate_passes g ON g.trip_id=tr.id
     WHERE v.company_id=my_company_id() AND upper(regexp_replace(v.reg_no,'[^A-Za-z0-9]','','g'))=upper(regexp_replace(tok,'[^A-Za-z0-9]','','g'))
       AND tr.status NOT IN ('settled','cancelled') AND tr.gate_in_at IS NULL
     ORDER BY tr.created_at DESC LIMIT 1;
    IF v_tok IS NOT NULL THEN tok := v_tok; END IF;
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
  -- staff QR: staff id or mobile number
  v_digits := right(regexp_replace(tok,'\D','','g'),10);
  SELECT p.id, p.full_name, p.is_active INTO s FROM user_profiles p
   WHERE p.company_id=my_company_id() AND p.user_type='staff'
     AND (p.id::text = lower(regexp_replace(tok,'^staff[:=]','','i')) OR (length(v_digits)=10 AND p.mobile='+91'||v_digits))
   ORDER BY p.is_active DESC, p.created_at LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('kind', CASE WHEN s.is_active THEN 'staff' ELSE 'staff_inactive' END, 'driver', s.full_name,
      'role', (SELECT string_agg(r.code, ', ') FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=s.id));
  END IF;
  RETURN jsonb_build_object('kind', 'unknown');
END $function$;