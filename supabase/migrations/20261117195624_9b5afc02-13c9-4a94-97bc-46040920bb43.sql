create or replace function public._is_qa_trip(p_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from trips where id=p_id and trip_no like 'QA-TEST%') $$;

create or replace function public._skip_qa_stock() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.ref_type='trip' and public._is_qa_trip(new.ref_id) then return null; end if;
  return new;
end $$;
drop trigger if exists trg_skip_qa_stock on public.stock_movements;
create trigger trg_skip_qa_stock before insert on public.stock_movements for each row execute function public._skip_qa_stock();

delete from public.stock_movements s where s.ref_type='trip' and public._is_qa_trip(s.ref_id);

update public.trips set ended_at=coalesce(ended_at, now()), status='settled'
 where trip_no='QA-TEST/261117/PROMPT20-TIMING';