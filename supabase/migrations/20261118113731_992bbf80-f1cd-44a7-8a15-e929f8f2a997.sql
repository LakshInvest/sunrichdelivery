REVOKE ALL ON FUNCTION public.collect_delivery_payment(uuid,text,numeric,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.collect_delivery_payment(uuid,text,numeric,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.delivery_end_payment_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.delivery_handover_guard() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE def text; BEGIN SELECT pg_get_functiondef(oid) INTO def FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='delivery_end_payment_guard'; EXECUTE replace(def,'NOT(s.payment_resolution=''partial'' AND nullif(btrim(s.payment_reason),'''') IS NOT NULL)','NOT(coalesce(s.payment_resolution=''partial'',false) AND nullif(btrim(s.payment_reason),'''') IS NOT NULL)'); END $$;