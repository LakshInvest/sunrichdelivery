DO $$
DECLARE o public.orders; l public.order_lines; t public.trips;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id='f5000000-0000-4000-8000-000000000001';
 IF o.id IS NULL THEN RAISE EXCEPTION 'QA source order missing'; END IF;
 o.id:='f5300000-0000-4000-8000-000000000001'; o.order_no:='QA-TEST-PROMPT53'; o.order_group_id:=gen_random_uuid(); o.status:='approved'; o.amount_paid:=0; o.payment_status:='unpaid'; o.notes:='QA-TEST Prompt53 mixed paid/FREE verification'; o.created_at:=now(); o.updated_at:=now(); o.delivery_latitude:=NULL; o.delivery_longitude:=NULL;
 INSERT INTO public.orders SELECT o.*;
 SELECT * INTO l FROM public.order_lines WHERE id='f5000000-0000-4000-8000-000000000002';
 l.id:='f5300000-0000-4000-8000-000000000002';l.order_id:=o.id;l.is_free:=false;l.scheme_info:='[]';
 INSERT INTO public.order_lines SELECT l.*;
 l.id:='f5300000-0000-4000-8000-000000000004';l.qty:=1;l.line_total:=0;l.taxable_value:=0;l.tax_amount:=0;l.deposit_total:=0;l.is_free:=true;l.sort_order:=2;l.scheme_info:='[{"name":"QA scheme","free_qty":1}]';l.discount_amount:=160;l.gross_total:=160;
 INSERT INTO public.order_lines SELECT l.*;
 INSERT INTO public.trips(id,company_id,trip_no,unit_id,vehicle_id,driver_user_id,trip_date,status,crates_planned,crates_planned_manual)
 VALUES('f5300000-0000-4000-8000-000000000010',o.company_id,'QA-TEST/261118/PROMPT53','d447a17f-266c-43ad-bc38-693a9ee7d5ed','f5000000-0000-4000-8000-000000000020','130c6cf5-ddeb-460b-af61-edfba33e7506',CURRENT_DATE,'planned',0,true);
 INSERT INTO public.trip_stops(id,trip_id,order_id,seq) VALUES('f5300000-0000-4000-8000-000000000003','f5300000-0000-4000-8000-000000000010',o.id,1);
 INSERT INTO public.trip_loading(trip_id,product_id,planned_qty) VALUES('f5300000-0000-4000-8000-000000000010',l.product_id,4);
END $$;