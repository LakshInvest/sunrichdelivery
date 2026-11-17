UPDATE public.trips SET crates_loaded = 3, crates_planned = 3 WHERE id = '5ef5a8ec-842d-4f2e-8ed7-07a47f963741' AND trip_no LIKE 'QA-TEST/%';
INSERT INTO public.trip_loading (trip_id, product_id, planned_qty, loaded_qty, loaded_at)
SELECT '5ef5a8ec-842d-4f2e-8ed7-07a47f963741', p.id, 10, 10, now() - interval '4 hours'
  FROM (SELECT id FROM public.products WHERE company_id = 'ebd6f904-55a0-46f1-b4c9-2324c5b61aea' ORDER BY created_at LIMIT 2) p
ON CONFLICT DO NOTHING;