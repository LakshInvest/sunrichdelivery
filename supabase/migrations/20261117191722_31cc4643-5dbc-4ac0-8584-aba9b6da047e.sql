DROP FUNCTION IF EXISTS public.gate_vehicles_out();
CREATE FUNCTION public.gate_vehicles_out()
 RETURNS TABLE(trip_id uuid, trip_no text, reg_no text, driver text, gate_out_at timestamptz, ended boolean, gate_out_missing boolean, started_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.id, t.trip_no, v.reg_no, coalesce(u.full_name, t.hired_driver_name), t.gate_out_at, t.ended_at IS NOT NULL,
         t.gate_out_at IS NULL, coalesce(t.gate_out_at, t.driver_started_at)
    FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN user_profiles u ON u.id = t.driver_user_id
   WHERE public.has_perm('gate','create') AND t.company_id = my_company_id()
     AND t.gate_in_at IS NULL AND t.status <> 'cancelled'
     AND (t.gate_out_at IS NOT NULL OR (t.status = 'in_progress' AND t.driver_started_at IS NOT NULL))
   ORDER BY coalesce(t.gate_out_at, t.driver_started_at);
$$;
REVOKE ALL ON FUNCTION public.gate_vehicles_out() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gate_vehicles_out() TO authenticated;

DROP FUNCTION IF EXISTS public.gate_in(uuid, numeric, numeric, numeric, boolean);
CREATE FUNCTION public.gate_in(p_trip_id uuid, p_odometer numeric DEFAULT NULL, p_fuel_litres numeric DEFAULT NULL, p_fuel_amount numeric DEFAULT NULL, p_manual boolean DEFAULT false, p_reason text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
declare v_t public.trips;
begin
  if not (public.has_perm('dispatch', 'view') or public.has_perm('gate','create')) then raise exception 'Not allowed'; end if;
  select * into v_t from public.trips where id = p_trip_id and company_id = public.my_company_id() for update;
  if v_t.id is null or v_t.status <> 'in_progress' or v_t.gate_in_at is not null then raise exception 'Trip is not out'; end if;
  -- Trips started before the gate rule have no gate-out record: allow gate-in, but a reason is required.
  if v_t.gate_out_at is null and nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Reason needed'; end if;
  update public.trips set status = case when ended_at is not null then 'returned'::trip_status else status end,
         gate_in_at = now(), gate_in_by = auth.uid(), gate_in_manual = coalesce(p_manual, false),
         gate_return_note = coalesce(nullif(btrim(p_reason), ''), gate_return_note),
         end_odometer = coalesce(p_odometer, end_odometer), fuel_litres = p_fuel_litres, fuel_amount = p_fuel_amount
   where id = p_trip_id;
end $$;
REVOKE ALL ON FUNCTION public.gate_in(uuid, numeric, numeric, numeric, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gate_in(uuid, numeric, numeric, numeric, boolean, text) TO authenticated;