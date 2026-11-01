-- Prompt-4 job 2: vehicle-check item names in Hindi and Marathi.
-- Run this in the Supabase SQL editor (or apply via a migration). The app
-- reads en/name_hi/name_mr and falls back to English when a translation
-- is empty or the table is missing.

create table if not exists public.vehicle_check_item_names (
  id uuid primary key default gen_random_uuid(),
  en text not null unique,
  name_hi text,
  name_mr text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Current items (matching delivery_settings.vehicle_check_items).
insert into public.vehicle_check_item_names (en, name_hi, name_mr) values
  ('Tyres', 'टायर', 'टायर'),
  ('Brakes', 'ब्रेक', 'ब्रेक'),
  ('Lights', 'लाइट', 'दिवे'),
  ('Horn', 'हॉर्न', 'हॉर्न'),
  ('Crates on board', 'गाड़ी में क्रेट', 'गाडीत पेट्या'),
  ('Documents in vehicle', 'गाड़ी में कागज़ात', 'गाडीत कागजपत्रे')
on conflict (en) do update
  set name_hi = excluded.name_hi, name_mr = excluded.name_mr, updated_at = now();

grant select on public.vehicle_check_item_names to authenticated;
grant all on public.vehicle_check_item_names to service_role;

alter table public.vehicle_check_item_names enable row level security;

create policy "Authenticated staff can read vehicle check names"
  on public.vehicle_check_item_names
  for select
  to authenticated
  using (true);

create or replace function public.update_vehicle_check_names_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vehicle_check_item_names_updated_at on public.vehicle_check_item_names;
create trigger vehicle_check_item_names_updated_at
  before update on public.vehicle_check_item_names
  for each row execute function public.update_vehicle_check_names_updated_at();
