ALTER TABLE public.trip_stops ADD COLUMN IF NOT EXISTS payment_resolution text, ADD COLUMN IF NOT EXISTS payment_reason text;
CREATE OR REPLACE FUNCTION public.collect_delivery_payment(p_stop_id uuid,p_mode text,p_amount numeric,p_reason text DEFAULT NULL,p_reference text DEFAULT NULL,p_photo_url text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s public.trip_stops; o public.orders; total numeric; paid numeric; v uuid;
BEGIN
 SELECT * INTO s FROM trip_stops WHERE id=p_stop_id FOR UPDATE; IF s.id IS NULL OR NOT _is_my_trip(s.trip_id) THEN RAISE EXCEPTION 'Not allowed'; END IF;
 SELECT * INTO o FROM orders WHERE id=s.order_id;
 SELECT coalesce(sum(CASE WHEN ol.is_free THEN 0 ELSE ol.line_total*coalesce(dl.delivered_qty,ol.qty)/nullif(ol.qty,0) END),0) INTO total FROM order_lines ol LEFT JOIN delivery_lines dl ON dl.order_line_id=ol.id AND dl.stop_id=s.id WHERE ol.order_id=o.id;
 SELECT greatest(o.amount_paid,coalesce(sum(amount),0)) INTO paid FROM trip_collections WHERE order_id=o.id AND NOT against_old_dues;
 IF p_amount<greatest(0,total-paid) AND nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Partial payment reason required'; END IF;
 v:=collect_stop_payment(p_stop_id,p_mode,p_amount,p_reference,p_photo_url);
 UPDATE trip_stops SET payment_resolution=CASE WHEN p_amount<greatest(0,total-paid) THEN 'partial' ELSE 'paid' END,payment_reason=nullif(btrim(p_reason),'') WHERE id=s.id;
 RETURN v;
END $$;
GRANT EXECUTE ON FUNCTION public.collect_delivery_payment(uuid,text,numeric,text,text,text) TO authenticated;
DO $$ DECLARE def text; BEGIN SELECT pg_get_functiondef(oid) INTO def FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='run_op'; IF position('''collect_delivery_payment''' in def)=0 THEN EXECUTE replace(def,'''collect_stop_payment'')','''collect_stop_payment'',''collect_delivery_payment'')'); END IF; END $$;
CREATE OR REPLACE FUNCTION public.delivery_end_payment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL AND EXISTS(
 SELECT 1 FROM trip_stops s JOIN orders o ON o.id=s.order_id WHERE s.trip_id=NEW.id AND s.status IN ('delivered','partial') AND o.payment_mode NOT IN ('credit','prepaid') AND NOT(s.payment_resolution='partial' AND nullif(btrim(s.payment_reason),'') IS NOT NULL) AND
 coalesce((SELECT sum(CASE WHEN ol.is_free THEN 0 ELSE ol.line_total*coalesce(dl.delivered_qty,ol.qty)/nullif(ol.qty,0) END) FROM order_lines ol LEFT JOIN delivery_lines dl ON dl.order_line_id=ol.id AND dl.stop_id=s.id WHERE ol.order_id=o.id),0)>greatest(o.amount_paid,coalesce((SELECT sum(amount) FROM trip_collections WHERE order_id=o.id AND NOT against_old_dues),0))) THEN RAISE EXCEPTION 'Complete the payment step first'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivery_end_payment_guard BEFORE UPDATE OF ended_at ON public.trips FOR EACH ROW EXECUTE FUNCTION public.delivery_end_payment_guard();
CREATE OR REPLACE FUNCTION public.delivery_handover_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE expected numeric;
BEGIN
 IF NEW.trip_id IS NULL THEN RETURN NEW; END IF;
 SELECT greatest(0,coalesce((SELECT sum(amount) FROM trip_collections WHERE trip_id=NEW.trip_id AND mode='cash'),0)-coalesce((SELECT sum(amount) FROM trip_expenses WHERE trip_id=NEW.trip_id AND paid_from_cash AND approved IS DISTINCT FROM false),0)) INTO expected;
 IF NEW.amount<>expected AND nullif(btrim(NEW.note),'') IS NULL THEN RAISE EXCEPTION 'Cash hand-over difference reason required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER delivery_handover_guard BEFORE INSERT ON public.cash_handovers FOR EACH ROW EXECUTE FUNCTION public.delivery_handover_guard();