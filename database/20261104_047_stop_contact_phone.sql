-- Phone for the driver's Call button: order phone, else delivery address contact, else customer mobile.
create or replace function public.stop_contact_phone(p_stop_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare v_trip uuid; v_phone text;
begin
  select s.trip_id,
         coalesce(nullif(trim(o.customer_mobile),''), nullif(trim(a.contact_mobile),''), nullif(trim(c.mobile),''))
    into v_trip, v_phone
    from public.trip_stops s
    join public.orders o on o.id = s.order_id
    left join public.customer_addresses a on a.id = o.delivery_address_id
    left join public.customers c on c.id = o.customer_id
   where s.id = p_stop_id;
  if v_trip is null or not public._is_my_trip(v_trip) then raise exception 'Not allowed'; end if;
  return v_phone;
end $$;

revoke all on function public.stop_contact_phone(uuid) from public, anon;
grant execute on function public.stop_contact_phone(uuid) to authenticated;
