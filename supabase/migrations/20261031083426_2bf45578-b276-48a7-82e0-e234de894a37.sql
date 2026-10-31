CREATE OR REPLACE FUNCTION public.gate_pickup_handover(p_order_no text, p_otp text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
declare
  v_o public.orders;
begin
  if not public.has_perm('dispatch', 'view') then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_otp, '')), '') is null then raise exception 'Enter the pass code'; end if;
  select * into v_o from public.orders
   where company_id = public.my_company_id() and order_no = trim(p_order_no);
  if v_o.id is null or v_o.delivery_mode <> 'pickup' then raise exception 'Pickup order not found'; end if;
  if v_o.status::text not in ('approved', 'processing') then raise exception 'Order is not ready for pickup'; end if;
  if v_o.delivery_otp is null or v_o.delivery_otp <> trim(p_otp) then raise exception 'Wrong pass code'; end if;
  perform public._set_order_status(v_o.id, 'delivered', 'Picked up at gate (pass verified)');
  insert into public.audit_logs (company_id, actor_user_id, action, entity_type, entity_id, details)
  values (v_o.company_id, auth.uid(), 'gate_pickup_handover', 'orders', v_o.id::text,
          jsonb_build_object('order_no', v_o.order_no));
  return v_o.order_no;
end;
$function$;

REVOKE EXECUTE ON FUNCTION public.gate_pickup_handover(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.gate_pickup_handover(text, text) TO authenticated;