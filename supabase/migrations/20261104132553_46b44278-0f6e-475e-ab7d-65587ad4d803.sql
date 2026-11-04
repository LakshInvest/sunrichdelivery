CREATE OR REPLACE FUNCTION public.record_collection(p_stop_id uuid, p_mode text, p_amount numeric, p_reference text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_s public.trip_stops; v_o public.orders; v_id uuid;
begin
  select * into v_s from public.trip_stops where id = p_stop_id;
  if v_s.id is null or not public._is_my_trip(v_s.trip_id) then raise exception 'Not allowed'; end if;
  if p_mode = 'cheque' and p_photo_url is null then raise exception 'Add a photo of the cheque'; end if;
  -- UPI reference is optional; Accounts verify UPI in Command Center.
  select * into v_o from public.orders where id = v_s.order_id;
  insert into public.trip_collections (trip_id, stop_id, order_id, customer_id, mode, amount, reference, photo_url, collected_by)
  values (v_s.trip_id, p_stop_id, v_o.id, v_o.customer_id, p_mode, p_amount, nullif(trim(coalesce(p_reference, '')), ''), p_photo_url, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;