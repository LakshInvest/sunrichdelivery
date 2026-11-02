alter table public.credit_debit_notes
  add column if not exists order_id uuid references public.orders(id) on delete restrict,
  add column if not exists trip_id uuid references public.trips(id) on delete restrict,
  add column if not exists stop_id uuid references public.trip_stops(id) on delete restrict,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz;
create unique index if not exists credit_debit_notes_stop_rate_uq on public.credit_debit_notes(stop_id, gst_rate) where stop_id is not null;

alter table public.orders
  add column if not exists redeliver_reason text,
  add column if not exists redeliver_at timestamptz;

-- Pending credit note for whatever the customer did not keep (short/refused/damaged).
create or replace function public._stop_credit_note(p_stop_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_s public.trip_stops; v_i public.invoices; r record; v_reason text;
begin
  select * into v_s from public.trip_stops where id = p_stop_id;
  select * into v_i from public.invoices where order_id = v_s.order_id and status <> 'cancelled' order by created_at desc limit 1;
  if v_i.id is null then return; end if;
  select string_agg(distinct k, ' / ') into v_reason from (
    select 'short' k from public.delivery_lines where stop_id = p_stop_id and short_qty > 0
    union select 'refused' from public.delivery_lines where stop_id = p_stop_id and refused_qty > 0
    union select 'damaged' from public.delivery_lines where stop_id = p_stop_id and damaged_qty > 0) x;
  for r in
    select ol.gst_rate,
           round(sum(ol.taxable_value * (ol.qty - dl.delivered_qty)::numeric / nullif(ol.qty, 0)), 2) taxable,
           round(sum((ol.line_total + coalesce(ol.deposit_total, 0)) * (ol.qty - dl.delivered_qty)::numeric / nullif(ol.qty, 0)), 2) total
      from public.delivery_lines dl join public.order_lines ol on ol.id = dl.order_line_id
     where dl.stop_id = p_stop_id and dl.delivered_qty < ol.qty
     group by ol.gst_rate
  loop
    if coalesce(r.total, 0) <= 0 then continue; end if;
    insert into public.credit_debit_notes (company_id, firm_id, note_type, note_no, invoice_id, customer_id, reason,
      taxable_value, gst_rate, tax_amount, total, status, order_id, trip_id, stop_id)
    values (v_i.company_id, v_i.firm_id, 'credit',
      public._doc_no(v_i.firm_id, 'credit_note'::public.doc_series_type, null),
      v_i.id, v_i.customer_id, 'Not kept at delivery: ' || coalesce(v_reason, 'short'),
      r.taxable, r.gst_rate, r.total - r.taxable, r.total, 'pending', v_s.order_id, v_s.trip_id, p_stop_id)
    on conflict do nothing;
  end loop;
end $$;
revoke all on function public._stop_credit_note(uuid) from public, anon, authenticated;

create or replace function public._stop_after_delivery()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.status = 'pending' and new.status in ('partial', 'failed') then
    perform public._stop_credit_note(new.id);
  end if;
  if old.status = 'pending' and new.status = 'failed' then
    update public.orders set redeliver_reason = new.fail_reason, redeliver_at = now() where id = new.order_id;
    perform public._set_order_status(new.order_id, 'approved', 'Re-deliver: ' || coalesce(new.fail_reason, 'could not deliver'));
  end if;
  if new.status = 'delivered' or new.status = 'partial' then
    update public.orders set redeliver_reason = null, redeliver_at = null where id = new.order_id and redeliver_at is not null;
  end if;
  return new;
end $$;
drop trigger if exists trip_stops_after_delivery on public.trip_stops;
create trigger trip_stops_after_delivery after update of status on public.trip_stops
  for each row execute function public._stop_after_delivery();

-- Accounts approves (issues) or rejects a pending credit note.
create or replace function public.decide_credit_note(p_note_id uuid, p_approve boolean)
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_st text;
begin
  if not (public.has_perm('finance', 'create') or public.has_perm('orders', 'approve')) then raise exception 'Not allowed'; end if;
  update public.credit_debit_notes
     set status = case when p_approve then 'issued' else 'rejected' end, approved_by = auth.uid(), approved_at = now()
   where id = p_note_id and company_id = public.my_company_id() and status = 'pending'
  returning status into v_st;
  if v_st is null then raise exception 'Note not found or already decided'; end if;
  return v_st;
end $$;
revoke all on function public.decide_credit_note(uuid, boolean) from public, anon;
grant execute on function public.decide_credit_note(uuid, boolean) to authenticated;