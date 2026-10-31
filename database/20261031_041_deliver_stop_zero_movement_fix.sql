-- deliver_stop fix: no zero-quantity container movement when nothing moved (failed delivery, no empties back).
-- Applied 2026-10-31 10:25 UTC.

-- Fix 1: deliver_stop must not insert a zero-quantity container movement (e.g. failed
-- delivery with no empties back). Condition now checks the computed quantities.
CREATE OR REPLACE FUNCTION public.deliver_stop(p_stop_id uuid, p_lines jsonb, p_proof jsonb, p_fail_reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_s      public.trip_stops;
  v_o      public.orders;
  v_l      jsonb;
  v_ol     public.order_lines;
  v_total_del int := 0; v_total_ord int := 0;
  v_status text;
  v_otp_ok boolean;
  v_qty_out int;
  v_qty_in int;
begin
  select * into v_s from public.trip_stops where id = p_stop_id for update;
  if v_s.id is null or not public._is_my_trip(v_s.trip_id) then raise exception 'Not allowed'; end if;
  if v_s.status <> 'pending' then raise exception 'This stop is already done'; end if;
  if (select status from public.trips where id = v_s.trip_id) <> 'in_progress' then raise exception 'Trip has not left the gate'; end if;
  select * into v_o from public.orders where id = v_s.order_id;

  v_otp_ok := (p_proof ->> 'otp') is not null and (p_proof ->> 'otp') = v_o.delivery_otp;
  if (p_proof ->> 'otp') is not null and not v_otp_ok then raise exception 'Wrong delivery OTP'; end if;

  for v_l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    select * into v_ol from public.order_lines where id = (v_l ->> 'order_line_id')::uuid and order_id = v_o.id;
    if v_ol.id is null then raise exception 'Line does not belong to this order'; end if;
    if coalesce((v_l ->> 'delivered')::int, 0) + coalesce((v_l ->> 'short')::int, 0) + coalesce((v_l ->> 'damaged')::int, 0)
       + coalesce((v_l ->> 'refused')::int, 0) <> v_ol.qty then
      raise exception 'Quantities for % must add up to %', v_ol.product_name, v_ol.qty;
    end if;
    insert into public.delivery_lines (stop_id, order_line_id, delivered_qty, short_qty, damaged_qty, refused_qty, empties_returned)
    values (p_stop_id, v_ol.id, coalesce((v_l ->> 'delivered')::int, 0), coalesce((v_l ->> 'short')::int, 0),
            coalesce((v_l ->> 'damaged')::int, 0), coalesce((v_l ->> 'refused')::int, 0), coalesce((v_l ->> 'empties')::int, 0));

    v_qty_out := least(v_ol.new_containers, coalesce((v_l ->> 'delivered')::int, 0));
    v_qty_in := coalesce((v_l ->> 'empties')::int, 0);
    if v_qty_out > 0 or v_qty_in > 0 then
      insert into public.container_movements (company_id, customer_id, product_id, qty_out, qty_in, ref_type, ref_id, created_by)
      values (v_o.company_id, v_o.customer_id, v_ol.product_id,
              v_qty_out, v_qty_in, 'trip_stop', p_stop_id, auth.uid());
    end if;
    v_total_del := v_total_del + coalesce((v_l ->> 'delivered')::int, 0);
    v_total_ord := v_total_ord + v_ol.qty;
  end loop;

  v_status := case when v_total_del = 0 then 'failed' when v_total_del < v_total_ord then 'partial' else 'delivered' end;
  if v_status = 'failed' and nullif(trim(coalesce(p_fail_reason, '')), '') is null then raise exception 'Reason is required'; end if;

  update public.trip_stops set
    status = v_status, fail_reason = p_fail_reason, delivered_at = now(), otp_verified = coalesce(v_otp_ok, false),
    signed_copy_received = coalesce((p_proof ->> 'signed_copy')::boolean, false),
    signature_url = p_proof ->> 'signature_url', photo_url = p_proof ->> 'photo_url',
    latitude = (p_proof ->> 'latitude')::numeric, longitude = (p_proof ->> 'longitude')::numeric
  where id = p_stop_id;

  if v_status in ('delivered', 'partial') then
    perform public._set_order_status(v_o.id, 'delivered',
      case when v_status = 'partial' then 'Partly delivered' else 'Delivered' end || case when v_otp_ok then ' (OTP verified)' else '' end);
  else
    insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
    values (v_o.id, v_o.status, v_o.status, 'Delivery failed: ' || p_fail_reason, auth.uid());
  end if;
  return v_status;
end;
$function$;

-- Fix 2: allow 'sos' alert type alongside breakdown/accident/other
ALTER TABLE public.trip_alerts DROP CONSTRAINT ta_type;
ALTER TABLE public.trip_alerts ADD CONSTRAINT ta_type CHECK (alert_type = ANY (ARRAY['breakdown'::text, 'accident'::text, 'other'::text, 'sos'::text]));