CREATE OR REPLACE FUNCTION public.trip_crates_plan(p_trip_id uuid) RETURNS integer
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN t.crates_planned_manual THEN t.crates_planned ELSE
    (SELECT sum(ceil(l.planned_qty / p.packs_per_crate))::int FROM trip_loading l JOIN products p ON p.id = l.product_id
      WHERE l.trip_id = t.id AND coalesce(p.packs_per_crate,0) > 0) END
    FROM trips t WHERE t.id = p_trip_id AND t.company_id = my_company_id() AND public.has_perm('dispatch','view');
$$;