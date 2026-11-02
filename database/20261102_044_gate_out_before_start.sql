alter table public.trips add column if not exists driver_started_at timestamptz;

CREATE OR REPLACE FUNCTION public.gate_out(p_qr_token text, p_odometer numeric DEFAULT NULL::numeric)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_t public.trips; v_s record;
begin
  if not public.has_perm('dispatch', 'view') then raise exception 'Not allowed'; end if;
  select t.* into v_t from public.trips t join public.gate_passes g on g.trip_id = t.id where g.qr_token = p_qr_token for update;
  if v_t.id is null then raise exception 'Gate pass not found'; end if;
  if v_t.gate_out_at is not null then raise exception 'Already gated out'; end if;
  if v_t.status in ('planned', 'loading') then raise exception 'Loading not finished yet'; end if;
  if v_t.status not in ('loaded', 'in_progress') then raise exception 'Trip cannot leave the gate'; end if;

  insert into public.stock_movements (company_id, unit_id, product_id, qty, movement_type, ref_type, ref_id, created_by)
  select v_t.company_id, v_t.unit_id, l.product_id, -l.loaded_qty, 'dispatch', 'trip', v_t.id, auth.uid()
    from public.trip_loading l where l.trip_id = v_t.id and l.loaded_qty > 0;

  for v_s in select order_id from public.trip_stops where trip_id = v_t.id loop
    perform public._set_order_status(v_s.order_id, 'dispatched', 'Out for delivery');
  end loop;

  update public.trips set status = 'in_progress', gate_out_at = now(), gate_out_by = auth.uid(),
         start_odometer = coalesce(start_odometer, p_odometer) where id = v_t.id;
  return v_t.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_trip(p_trip_id uuid, p_odometer numeric, p_odometer_photo_url text, p_selfie_url text, p_vehicle_check jsonb DEFAULT NULL::jsonb, p_check_photo_url text DEFAULT NULL::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_s public.delivery_settings; v_ok boolean; v_t public.trips;
begin
  if not public._is_my_trip(p_trip_id) then raise exception 'Not allowed'; end if;
  select * into v_t from public.trips where id = p_trip_id;
  if v_t.gate_out_at is null then raise exception 'Gate out not done yet'; end if;
  if v_t.driver_started_at is not null then raise exception 'Trip already started'; end if;
  select * into v_s from public.delivery_settings where company_id = public.my_company_id();
  if v_s.require_start_odometer and p_odometer is null then raise exception 'Enter the odometer reading'; end if;
  if v_s.require_start_odometer_photo and p_odometer_photo_url is null then raise exception 'Take a photo of the odometer'; end if;
  if v_s.require_start_selfie and p_selfie_url is null then raise exception 'Take a selfie to start'; end if;
  if v_s.vehicle_check_enabled then
    if p_vehicle_check is null or jsonb_array_length(p_vehicle_check) = 0 then raise exception 'Complete the vehicle check'; end if;
    select bool_and((x ->> 'ok')::boolean) into v_ok from jsonb_array_elements(p_vehicle_check) x;
    insert into public.trip_vehicle_checks (trip_id, items, all_ok, photo_url, checked_by)
    values (p_trip_id, p_vehicle_check, coalesce(v_ok, false), p_check_photo_url, auth.uid());
  end if;
  update public.trips
     set start_odometer = coalesce(p_odometer, start_odometer),
         start_odometer_photo_url = coalesce(p_odometer_photo_url, start_odometer_photo_url),
         start_selfie_url = coalesce(p_selfie_url, start_selfie_url),
         driver_started_at = now()
   where id = p_trip_id and status = 'in_progress';
  if not found then raise exception 'Trip is not ready to start'; end if;
end;
$function$;

update public.trips set driver_started_at = coalesce(gate_out_at, now())
 where status in ('in_progress','returned','settled') and driver_started_at is null and gate_out_at is not null and start_odometer is not null;