alter table public.cash_handovers drop constraint ch_amount;
alter table public.cash_handovers add constraint ch_amount check (amount > 0 or (amount = 0 and trip_id is not null));
