CREATE OR REPLACE FUNCTION public.gate_in(p_trip_id uuid, p_odometer numeric DEFAULT NULL::numeric, p_fuel_litres numeric DEFAULT NULL::numeric, p_fuel_amount numeric DEFAULT NULL::numeric)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_t public.trips;
begin
  if not public.has_perm('dispatch', 'view') then raise exception 'Not allowed'; end if;
  select * into v_t from public.trips where id = p_trip_id and company_id = public.my_company_id() for update;
  if v_t.id is null or v_t.status <> 'in_progress' then raise exception 'Trip is not out'; end if;
  if exists (select 1 from public.trip_stops where trip_id = p_trip_id and status = 'pending') then
    raise exception 'Some stops are still pending in the Delivery app';
  end if;
  -- Stock is no longer returned here: the loader counts the goods at unload (receive_returns),
  -- and only undelivered good packs go back to sellable stock. Damaged/refused stay out.
  update public.trips set status = 'returned', gate_in_at = now(), gate_in_by = auth.uid(),
         end_odometer = coalesce(p_odometer, end_odometer), fuel_litres = p_fuel_litres, fuel_amount = p_fuel_amount
   where id = p_trip_id;
end;
$function$;

ALTER TABLE public.trip_stops ADD COLUMN IF NOT EXISTS do_later_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_stop_later(p_stop_id uuid, p_later boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_trip uuid;
begin
  select trip_id into v_trip from public.trip_stops where id = p_stop_id;
  if v_trip is null or not public._is_my_trip(v_trip) then raise exception 'Not allowed'; end if;
  update public.trip_stops set do_later_at = case when p_later then now() else null end
   where id = p_stop_id and status = 'pending';
end $$;
REVOKE EXECUTE ON FUNCTION public.set_stop_later(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_stop_later(uuid, boolean) TO authenticated;