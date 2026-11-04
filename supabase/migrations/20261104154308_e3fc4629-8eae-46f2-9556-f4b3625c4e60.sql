alter table public.delivery_settings alter column require_start_selfie set default false;
alter table public.delivery_settings alter column vehicle_check_enabled set default false;
update public.delivery_settings set require_start_selfie = false where require_start_selfie = true;