create or replace function public.stop_udhaar_check(p_stop_id uuid)
returns table(allowed boolean, available numeric, overdue numeric, blocked boolean, days int)
language plpgsql stable security definer set search_path = public as $$
declare v_trip uuid; v_cust uuid; v_firm uuid; v_cs record;
begin
  select s.trip_id, o.customer_id, o.firm_id into v_trip, v_cust, v_firm
    from public.trip_stops s join public.orders o on o.id = s.order_id where s.id = p_stop_id;
  if v_trip is null or not public._is_my_trip(v_trip) then raise exception 'Not allowed'; end if;
  select * into v_cs from public.credit_status(v_cust, v_firm);
  return query select (coalesce(v_cs.out_limit,0) > 0 and not coalesce(v_cs.out_blocked,false)),
    coalesce(v_cs.out_available,0), coalesce(v_cs.out_overdue,0), coalesce(v_cs.out_blocked,false), coalesce(v_cs.out_days,0);
end $$;

create or replace function public.stop_take_udhaar(p_stop_id uuid, p_amount numeric)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_order uuid; v_cust uuid; v_firm uuid; v_cs record;
begin
  select s.trip_id, o.id, o.customer_id, o.firm_id into v_trip, v_order, v_cust, v_firm
    from public.trip_stops s join public.orders o on o.id = s.order_id where s.id = p_stop_id;
  if v_trip is null or not public._is_my_trip(v_trip) then raise exception 'Not allowed'; end if;
  select * into v_cs from public.credit_status(v_cust, v_firm);
  if coalesce(v_cs.out_limit,0) <= 0 or coalesce(v_cs.out_blocked,false) then raise exception 'Customer has no credit'; end if;
  if coalesce(v_cs.out_overdue,0) > 0 or coalesce(p_amount,0) > coalesce(v_cs.out_available,0) then
    return false; -- caller must Ask office
  end if;
  update public.orders set payment_mode = 'credit',
         due_date = coalesce(due_date, current_date + coalesce(v_cs.out_days,0))
   where id = v_order;
  return true;
end $$;

revoke all on function public.stop_udhaar_check(uuid), public.stop_take_udhaar(uuid,numeric) from public, anon;
grant execute on function public.stop_udhaar_check(uuid), public.stop_take_udhaar(uuid,numeric) to authenticated;