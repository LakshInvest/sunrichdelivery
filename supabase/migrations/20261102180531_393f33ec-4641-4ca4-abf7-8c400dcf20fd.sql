ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS gate_in_manual boolean NOT NULL DEFAULT false;
ALTER TABLE public.delivery_settings ADD COLUMN IF NOT EXISTS gate_pass_print boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.gate_in(uuid, numeric, numeric, numeric);
CREATE FUNCTION public.gate_in(p_trip_id uuid, p_odometer numeric DEFAULT NULL, p_fuel_litres numeric DEFAULT NULL, p_fuel_amount numeric DEFAULT NULL, p_manual boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_t public.trips;
begin
  if not (public.has_perm('dispatch', 'view') or public.has_perm('gate','create')) then raise exception 'Not allowed'; end if;
  select * into v_t from public.trips where id = p_trip_id and company_id = public.my_company_id() for update;
  if v_t.id is null or v_t.status <> 'in_progress' or v_t.gate_in_at is not null then raise exception 'Trip is not out'; end if;
  -- Vehicle is back: record gate-in now. The trip becomes "returned" only once the driver has ended it
  -- (odometer + photo); if not yet ended, the driver app forces End trip and end_trip moves it on.
  update public.trips set status = case when ended_at is not null then 'returned'::trip_status else status end,
         gate_in_at = now(), gate_in_by = auth.uid(), gate_in_manual = coalesce(p_manual, false),
         end_odometer = coalesce(p_odometer, end_odometer), fuel_litres = p_fuel_litres, fuel_amount = p_fuel_amount
   where id = p_trip_id;
end $$;
GRANT EXECUTE ON FUNCTION public.gate_in(uuid, numeric, numeric, numeric, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.end_trip(p_trip_id uuid, p_odometer numeric, p_odometer_photo_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_s public.delivery_settings; v_start numeric;
begin
  if not public._is_my_trip(p_trip_id) then raise exception 'Not allowed'; end if;
  select * into v_s from public.delivery_settings where company_id = public.my_company_id();
  if v_s.require_end_odometer and p_odometer is null then raise exception 'Enter the odometer reading'; end if;
  if v_s.require_end_odometer_photo and p_odometer_photo_url is null then raise exception 'Take a photo of the odometer'; end if;
  select start_odometer into v_start from public.trips where id = p_trip_id;
  if p_odometer is not null and v_start is not null and p_odometer < v_start then
    raise exception 'End reading is less than start reading (%)', v_start;
  end if;
  if exists (select 1 from public.trip_stops where trip_id = p_trip_id and status = 'pending') then
    raise exception 'Finish or mark all stops first';
  end if;
  update public.trips set end_odometer = p_odometer, end_odometer_photo_url = p_odometer_photo_url, ended_at = now(),
         status = case when gate_in_at is not null then 'returned'::trip_status else status end
   where id = p_trip_id and status = 'in_progress';
end $$;

CREATE OR REPLACE FUNCTION public.gate_vehicles_out()
RETURNS TABLE(trip_id uuid, trip_no text, reg_no text, driver text, gate_out_at timestamptz, ended boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT t.id, t.trip_no, v.reg_no, coalesce(u.full_name, t.hired_driver_name), t.gate_out_at, t.ended_at IS NOT NULL
    FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN user_profiles u ON u.id = t.driver_user_id
   WHERE public.has_perm('gate','create') AND t.company_id = my_company_id()
     AND t.gate_out_at IS NOT NULL AND t.gate_in_at IS NULL AND t.status <> 'cancelled'
   ORDER BY t.gate_out_at;
$$;
GRANT EXECUTE ON FUNCTION public.gate_vehicles_out() TO authenticated;

CREATE OR REPLACE FUNCTION public.gate_register(p_from timestamp with time zone, p_to timestamp with time zone, p_kind text DEFAULT NULL::text)
 RETURNS TABLE(at timestamp with time zone, kind text, title text, detail text, by_name text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH ok AS (SELECT public.has_perm('gate','create') AS v, my_company_id() AS cid),
  rws AS (
    SELECT e.in_at AS at, 'entry_in'::text AS kind, e.name AS title,
      concat_ws(' · ', e.entry_type, e.mobile, e.from_place, e.purpose, e.vehicle_no, CASE WHEN e.people_count > 1 THEN e.people_count || ' people' END,
        CASE WHEN e.entry_type='parcel' THEN coalesce(e.courier_name,'') || coalesce(' ' || e.parcel_count || ' parcel(s)','') END) AS detail, e.in_by AS who
      FROM gate_entries e, ok WHERE e.company_id = ok.cid
    UNION ALL SELECT e.out_at, 'entry_out', e.name, concat_ws(' · ', e.entry_type, e.mobile), e.out_by FROM gate_entries e, ok WHERE e.company_id = ok.cid AND e.out_at IS NOT NULL
    UNION ALL SELECT t.gate_out_at, 'vehicle_out', t.trip_no, v.reg_no, t.gate_out_by FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id, ok WHERE t.company_id = ok.cid AND t.gate_out_at IS NOT NULL
    UNION ALL SELECT t.gate_in_at, 'vehicle_in', t.trip_no, concat_ws(' · ', v.reg_no, CASE WHEN t.gate_in_manual THEN 'manual' END), t.gate_in_by FROM trips t LEFT JOIN vehicles v ON v.id=t.vehicle_id, ok WHERE t.company_id = ok.cid AND t.gate_in_at IS NOT NULL
    UNION ALL SELECT m.scanned_at, 'material', m.pass_no, concat_ws(' · ', m.direction, m.party, m.items, m.vehicle_no), m.scanned_by FROM material_passes m, ok WHERE m.company_id = ok.cid AND m.scanned_at IS NOT NULL
    UNION ALL SELECT p.raised_at, 'problem', p.problem_type, p.note, p.raised_by FROM gate_problems p, ok WHERE p.company_id = ok.cid
    UNION ALL SELECT s.started_at, 'guard', u.full_name, 'shift start', s.handed_over_by FROM guard_shifts s JOIN user_profiles u ON u.id = s.guard_user_id, ok WHERE s.company_id = ok.cid
  )
  SELECT r.at, r.kind, r.title, r.detail, u.full_name FROM rws r LEFT JOIN user_profiles u ON u.id = r.who, ok
   WHERE ok.v AND r.at >= p_from AND r.at < p_to
     AND (p_kind IS NULL OR p_kind = '' OR r.kind = p_kind OR (p_kind='entry' AND r.kind LIKE 'entry_%') OR (p_kind='vehicle' AND r.kind LIKE 'vehicle_%'))
   ORDER BY r.at DESC LIMIT 500;
$function$;

-- Cashiers = staff whose role can settle cash (finance:create).
CREATE OR REPLACE FUNCTION public.cashier_list()
RETURNS TABLE(id uuid, full_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT u.id, u.full_name FROM user_profiles u
    JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id AND r.is_active
    JOIN role_permissions rp ON rp.role_id = r.id AND rp.module = 'finance' AND rp.action = 'create'
   WHERE public.is_staff() AND u.company_id = my_company_id() AND u.is_active IS NOT FALSE
   ORDER BY u.full_name;
$$;
GRANT EXECUTE ON FUNCTION public.cashier_list() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_cash_to_confirm()
RETURNS TABLE(id uuid, amount numeric, note text, created_at timestamptz, from_name text, trip_no text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT h.id, h.amount, h.note, h.created_at, u.full_name, t.trip_no FROM cash_handovers h
    LEFT JOIN user_profiles u ON u.id = h.from_user_id LEFT JOIN trips t ON t.id = h.trip_id
   WHERE h.to_user_id = auth.uid() AND h.confirmed_at IS NULL ORDER BY h.created_at;
$$;
GRANT EXECUTE ON FUNCTION public.my_cash_to_confirm() TO authenticated;

CREATE OR REPLACE FUNCTION public.record_cash_handover(p_to_user_id uuid, p_amount numeric, p_trip_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v_id uuid;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if p_trip_id is not null then
    if not public._is_my_trip(p_trip_id) then raise exception 'Not allowed'; end if;
    if exists (select 1 from cash_handovers where trip_id = p_trip_id and confirmed_at is null) then
      raise exception 'Cash hand-over already waiting for the cashier';
    end if;
  end if;
  insert into public.cash_handovers (company_id, from_user_id, to_user_id, amount, trip_id, note, created_by)
  values (public.my_company_id(), auth.uid(), p_to_user_id, p_amount, p_trip_id, p_note, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- Cashier confirming a trip hand-over settles the trip with that amount.
CREATE OR REPLACE FUNCTION public.confirm_cash_handover(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare h public.cash_handovers;
begin
  update public.cash_handovers set confirmed_at = now()
   where id = p_id and to_user_id = auth.uid() and confirmed_at is null returning * into h;
  if h.id is null then raise exception 'Only the receiver can confirm'; end if;
  if h.trip_id is not null and exists (select 1 from trips where id = h.trip_id and status = 'returned') then
    perform public.settle_trip(h.trip_id, h.amount, h.note);
  end if;
end $$;

DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.run_op'::regproc);
  d := replace(d, '''ask_office'',''settle_trip'')', '''ask_office'',''settle_trip'',''record_cash_handover'',''confirm_cash_handover'')');
  EXECUTE d;
END $$;