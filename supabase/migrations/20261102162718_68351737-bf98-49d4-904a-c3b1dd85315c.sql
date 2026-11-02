create or replace function public._stop_after_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- Credit note only for part deliveries; a failed stop keeps its invoice for the re-delivery.
  if old.status = 'pending' and new.status = 'partial' then
    perform public._stop_credit_note(new.id);
  end if;
  if old.status = 'pending' and new.status = 'failed' then
    update public.orders set redeliver_reason = new.fail_reason, redeliver_at = now() where id = new.order_id;
    perform public._set_order_status(new.order_id, 'approved', 'Re-deliver: ' || coalesce(new.fail_reason, 'could not deliver'));
  end if;
  if new.status in ('delivered', 'partial') then
    update public.orders set redeliver_reason = null, redeliver_at = null where id = new.order_id and redeliver_at is not null;
  end if;
  return new;
end $$;
revoke all on function public._stop_after_delivery() from public, anon, authenticated;
delete from public.credit_debit_notes where note_no = 'MFCN/26-27/00002' and status = 'pending' and reason = 'Not kept at delivery: short';