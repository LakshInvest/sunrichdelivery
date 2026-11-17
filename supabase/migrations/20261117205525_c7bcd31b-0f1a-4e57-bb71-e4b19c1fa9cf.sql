insert into public.user_profiles (id, company_id, user_type, full_name, mobile, email, is_active, login_without_otp, preferred_language, created_by)
values ('130c6cf5-ddeb-460b-af61-edfba33e7506','ebd6f904-55a0-46f1-b4c9-2324c5b61aea','staff','QA Driver 2','+919999900015','qa.driver2@sunrich.local',true,true,'hi','83f82c80-bf5d-4724-af93-099ec2075632')
on conflict (id) do nothing;
insert into public.user_roles (user_id, role_id) values ('130c6cf5-ddeb-460b-af61-edfba33e7506','53c142d4-45d9-4968-a24e-36aac76beccd') on conflict do nothing;
insert into public.user_pins (user_id, pin_hash) values ('130c6cf5-ddeb-460b-af61-edfba33e7506', extensions.crypt('1234', extensions.gen_salt('bf',10))) on conflict (user_id) do update set pin_hash=excluded.pin_hash, failed_attempts=0;

update public.trips set status='settled', settled_at=now(), settle_note='QA-TEST closed for Prompt-41' where id='f2000000-0000-4000-8000-000000000003' and trip_no like 'QA-TEST%';

insert into public.orders (id, company_id, order_no, order_group_id, customer_id, firm_id, source, order_type, status, customer_name, business_name, customer_mobile, delivery_address_line1, delivery_city, delivery_mode, delivery_otp, items_total, taxable_value, tax_total, grand_total, payment_mode, payment_method, payment_status, notes)
values
('f4100000-0000-4000-8000-000000000001','ebd6f904-55a0-46f1-b4c9-2324c5b61aea','QA-TEST-PROMPT41-DELIVERY',gen_random_uuid(),'4acc284b-f57b-418d-bcc1-5c93caa7cfd7','b0ee7348-8f8a-4380-aea2-80284a7cd2b2','office','regular','approved','QA Retailer','QA Retailer','+919999900001','QA test street','Latur','sunrich','1234',160,152.38,7.62,160,'cod','cash','unpaid','QA-TEST Prompt41 scan test'),
('f4100000-0000-4000-8000-000000000002','ebd6f904-55a0-46f1-b4c9-2324c5b61aea','QA-TEST-PROMPT41-PICKUP',gen_random_uuid(),'4acc284b-f57b-418d-bcc1-5c93caa7cfd7','b0ee7348-8f8a-4380-aea2-80284a7cd2b2','office','regular','approved','QA Retailer','QA Retailer','+919999900001','QA test street','Latur','pickup','1234',160,152.38,7.62,160,'cod','cash','unpaid','QA-TEST Prompt41 pickup scan');
insert into public.order_lines (order_id, product_id, product_code, product_name, pack_label, hsn_code, gst_rate, qty, unit_price, taxable_value, tax_amount, line_total, sort_order)
select o, '6f3fd37c-9554-4bf0-a258-26c05d8ef2b2','SR-200ML','200 ml','48 × 200 ml','22011010',5,1,160,152.38,7.62,160,1
from unnest(array['f4100000-0000-4000-8000-000000000001','f4100000-0000-4000-8000-000000000002']::uuid[]) o;
update public.orders set pickup_vehicle_no='QA-PICKUP-01' where id='f4100000-0000-4000-8000-000000000002';

insert into public.trips (id, company_id, trip_no, unit_id, vehicle_id, driver_user_id, trip_date, status, loaded_at, trip_type)
values ('f4100000-0000-4000-8000-000000000010','ebd6f904-55a0-46f1-b4c9-2324c5b61aea','QA-TEST/261117/PROMPT41','d447a17f-266c-43ad-bc38-693a9ee7d5ed','42ad7bb8-c424-4c2c-b6d9-479722b9bbbd','130c6cf5-ddeb-460b-af61-edfba33e7506',current_date,'loaded',now(),'delivery');
insert into public.trip_stops (trip_id, order_id, seq, status) values ('f4100000-0000-4000-8000-000000000010','f4100000-0000-4000-8000-000000000001',1,'pending');
insert into public.gate_passes (trip_id, pass_no, qr_token, issued_at) values ('f4100000-0000-4000-8000-000000000010','QA-TEST-GP-PROMPT41','qa41gp'||substr(md5(random()::text),1,20),now());

insert into public.material_passes (company_id, pass_no, qr_token, direction, party, vehicle_no, items, is_returnable, quantity, reason, valid_till, approved_by_name)
values ('ebd6f904-55a0-46f1-b4c9-2324c5b61aea','MP-QA41-OK','qa41mp'||substr(md5(random()::text),1,18),'out','QA Scrap','MH24QA41','QA-TEST Prompt41 drums',false,2,'scrap',current_date+1,'QA');