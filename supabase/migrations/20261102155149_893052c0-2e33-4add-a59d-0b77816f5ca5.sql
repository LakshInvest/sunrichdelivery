CREATE OR REPLACE FUNCTION public._create_orders(p_customer_id uuid, p_lines jsonb, p_source text, p_delivery jsonb, p_notes text, p_office boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_c       public.customers;
  v_type    public.customer_types;
  v_priced  jsonb;
  v_group   uuid := gen_random_uuid();
  v_key     record;
  v_order   uuid;
  v_no      text;
  v_items   numeric; v_taxable numeric; v_tax numeric; v_dep numeric; v_grand numeric;
  v_cs      record;
  v_used    jsonb := '{}'::jsonb;
  v_status  public.order_status;
  v_hold    text;
  v_mode    text;
  v_method  text;
  v_bulk    boolean;
  v_result  jsonb := '[]'::jsonb;
  v_city    uuid; v_zone uuid;
begin
  select * into v_c from public.customers c where c.id = p_customer_id;
  if v_c.id is null then raise exception 'Customer not found'; end if;
  if v_c.status <> 'active' then raise exception 'Customer account is not active'; end if;
  select * into v_type from public.customer_types t where t.id = v_c.customer_type_id;
  select l.city_id, l.zone_id into v_city, v_zone from public.customer_location(p_customer_id) l;

  v_priced := public._price_lines(p_customer_id, p_lines, p_office);

  for v_key in
    select distinct (x ->> 'firm_id')::uuid as firm_id, nullif(x ->> 'fulfiller_customer_id', '')::uuid as fulfiller
    from jsonb_array_elements(v_priced) x
  loop
    select coalesce(sum((x ->> 'line_total')::numeric), 0),
           coalesce(sum((x ->> 'taxable_value')::numeric), 0),
           coalesce(sum((x ->> 'tax_amount')::numeric), 0),
           coalesce(sum((x ->> 'deposit_total')::numeric), 0),
           bool_or((x ->> 'is_bulk')::boolean)
      into v_items, v_taxable, v_tax, v_dep, v_bulk
      from jsonb_array_elements(v_priced) x
     where (x ->> 'firm_id')::uuid = v_key.firm_id
       and nullif(x ->> 'fulfiller_customer_id', '')::uuid is not distinct from v_key.fulfiller;

    v_grand := round(v_items + v_dep);

    select * into v_cs from public.credit_status(p_customer_id, v_key.firm_id);
    -- The payment method chosen on the order wins (cash/upi/bank/cheque/credit are open to every
    -- customer). Credit checks apply only when the method is credit. No choice -> old default.
    v_method := lower(nullif(trim(coalesce(p_delivery ->> 'payment_method', '')), ''));
    if v_method is not null and v_method not in ('credit','cash','upi','bank','cheque') then
      raise exception 'Unknown payment method %', v_method;
    end if;
    v_mode := case when v_method is not null then case when v_method = 'credit' then 'credit' else 'cod' end
                   when v_cs.out_limit > 0 then 'credit' else 'cod' end;
    v_hold := null;

    if v_mode = 'credit' and v_cs.out_blocked then
      v_hold := 'Account on credit block' || coalesce(': ' || v_cs.out_block_reason, '');
    elsif v_mode = 'credit' and v_cs.out_overdue > 0 and v_cs.out_oldest_overdue_days > v_c.overdue_grace_days then
      v_hold := 'Overdue bills: ₹' || v_cs.out_overdue;
    elsif v_mode = 'credit'
          and v_grand > v_cs.out_available - coalesce((v_used ->> v_key.firm_id::text)::numeric, 0) then
      v_hold := 'Over credit limit (available ₹' || greatest(v_cs.out_available - coalesce((v_used ->> v_key.firm_id::text)::numeric, 0), 0) || ')';
    end if;

    if v_hold is not null then
      v_status := 'credit_hold';
    elsif v_bulk then
      v_status := 'placed'; v_hold := 'Bulk order — confirm rate and stock';
    elsif v_type.auto_approve_orders then
      v_status := 'approved';
    else
      v_status := 'placed';
    end if;

    if v_mode = 'credit' then
      v_used := jsonb_set(v_used, array[v_key.firm_id::text],
                          to_jsonb(coalesce((v_used ->> v_key.firm_id::text)::numeric, 0) + v_grand));
    end if;

    v_no := public._next_order_no(v_key.firm_id);

    insert into public.orders (
      company_id, order_no, order_group_id, customer_id, firm_id, fulfiller_customer_id,
      distributor_status, distributor_assigned_at,
      source, order_type, status, hold_reason,
      customer_name, business_name, customer_mobile, customer_type_code, price_plan_id,
      area_id, zone_id, route_id,
      delivery_address_line1, delivery_address_line2, delivery_landmark, delivery_city, delivery_pincode,
      delivery_latitude, delivery_longitude, delivery_date, delivery_slot, notes,
      items_total, taxable_value, tax_total, deposit_total, round_off, grand_total,
      payment_mode, payment_method, due_date, credit_limit_snapshot, outstanding_snapshot,
      placed_by, approved_by, approved_at)
    values (
      v_c.company_id, v_no, v_group, v_c.id, v_key.firm_id, v_key.fulfiller,
      case when v_key.fulfiller is not null and v_status = 'approved' then 'pending' end,
      case when v_key.fulfiller is not null and v_status = 'approved' then now() end,
      coalesce(p_source, 'app'), case when v_bulk then 'bulk' else 'regular' end, v_status, v_hold,
      v_c.contact_name, v_c.business_name, v_c.mobile, v_type.code, public.price_plan_for_customer(v_c.id),
      v_c.area_id, v_zone, v_c.route_id,
      coalesce(p_delivery ->> 'address_line1', v_c.address_line1),
      coalesce(p_delivery ->> 'address_line2', v_c.address_line2),
      coalesce(p_delivery ->> 'landmark', v_c.landmark),
      coalesce(p_delivery ->> 'city', v_c.city),
      coalesce(p_delivery ->> 'pincode', v_c.pincode),
      coalesce((p_delivery ->> 'latitude')::numeric, v_c.latitude),
      coalesce((p_delivery ->> 'longitude')::numeric, v_c.longitude),
      coalesce((p_delivery ->> 'delivery_date')::date, current_date),
      p_delivery ->> 'delivery_slot',
      nullif(trim(coalesce(p_notes, '')), ''),
      v_items, v_taxable, v_tax, v_dep, v_grand - (v_items + v_dep), v_grand,
      v_mode, coalesce(v_method, case when v_mode = 'credit' then 'credit' end), case when v_mode = 'credit' then current_date + v_cs.out_days end,
      v_cs.out_limit, v_cs.out_outstanding,
      auth.uid(),
      case when v_status = 'approved' then auth.uid() end,
      case when v_status = 'approved' then now() end)
    returning id into v_order;

    insert into public.order_lines (
      order_id, product_id, product_code, product_name, pack_label, hsn_code, gst_rate, qty, unit_price, mrp,
      line_total, taxable_value, tax_amount, new_containers, deposit_per_unit, deposit_total, sort_order)
    select v_order, (x ->> 'product_id')::uuid, x ->> 'product_code', x ->> 'product_name', x ->> 'pack_label',
           x ->> 'hsn_code', (x ->> 'gst_rate')::numeric, (x ->> 'qty')::int, (x ->> 'unit_price')::numeric,
           nullif(x ->> 'mrp', '')::numeric, (x ->> 'line_total')::numeric, (x ->> 'taxable_value')::numeric,
           (x ->> 'tax_amount')::numeric, (x ->> 'new_containers')::int, (x ->> 'deposit_per_unit')::numeric,
           (x ->> 'deposit_total')::numeric, (x ->> 'sort_order')::int
      from jsonb_array_elements(v_priced) x
     where (x ->> 'firm_id')::uuid = v_key.firm_id
       and nullif(x ->> 'fulfiller_customer_id', '')::uuid is not distinct from v_key.fulfiller;

    insert into public.order_status_history (order_id, from_status, to_status, note, changed_by)
    values (v_order, null, v_status, v_hold, auth.uid());

    v_result := v_result || jsonb_build_object(
      'order_id', v_order, 'order_no', v_no, 'status', v_status, 'hold_reason', v_hold,
      'grand_total', v_grand, 'payment_mode', v_mode, 'payment_method', v_method,
      'fulfilled_by', case when v_key.fulfiller is null then 'sunrich' else 'distributor' end);
  end loop;

  return v_result;
end;
$function$;

ALTER TABLE public.role_permissions DROP CONSTRAINT IF EXISTS rp_action;
ALTER TABLE public.role_permissions ADD CONSTRAINT rp_action CHECK (action = ANY (ARRAY['view','create','edit','delete','approve','export','answer']));
INSERT INTO public.role_permissions (role_id, module, action)
SELECT id, 'ask_office', 'answer' FROM public.roles WHERE code IN ('ACCOUNTS','DISPATCH','ADMIN')
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.answer_ask_office(p_alert_id uuid, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if not public.has_perm('ask_office', 'answer') then raise exception 'Not allowed'; end if;
  update public.trip_alerts a set resolution = case when p_approve then 'approved' else 'rejected' end,
         resolved_at = now(), resolved_by = auth.uid(), note = coalesce(a.note, '') || coalesce(' | office: ' || p_note, '')
   where a.id = p_alert_id and a.alert_type = 'ask_office' and a.resolution is null
     and exists (select 1 from public.trips t where t.id = a.trip_id and t.company_id = public.my_company_id());
  if not found then raise exception 'Request not found or already answered'; end if;
end $$;
REVOKE EXECUTE ON FUNCTION public.answer_ask_office(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_ask_office(uuid, boolean, text) TO authenticated;