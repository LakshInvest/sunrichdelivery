CREATE OR REPLACE FUNCTION public.photos_expiring(p_days integer DEFAULT 7)
RETURNS TABLE (id uuid, photo_type text, expires_on date, taken_at timestamptz, trip_no text, customer_name text, order_no text, amount numeric, taken_by_name text, path text, downloaded_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_perm('finance','view') OR public.has_perm('settings','view')) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
  SELECT f.id, f.photo_type, f.expires_on, f.taken_at, t.trip_no::text, c.business_name::text, o.order_no::text, f.amount, up.full_name::text, f.path, f.downloaded_at
  FROM public.photo_files f
  LEFT JOIN public.trips t ON t.id = f.trip_id
  LEFT JOIN public.customers c ON c.id = f.customer_id
  LEFT JOIN public.orders o ON o.id = f.order_id
  LEFT JOIN public.user_profiles up ON up.id = f.taken_by
  WHERE f.company_id = public.my_company_id() AND f.file_deleted_at IS NULL AND f.expires_on IS NOT NULL
    AND f.expires_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date + greatest(p_days, 0)
  ORDER BY f.expires_on, f.photo_type, f.taken_at;
END $$;
CREATE OR REPLACE FUNCTION public.photo_backup_index(p_ids uuid[])
RETURNS TABLE (id uuid, path text, folder text, file_name text, taken_on date, photo_type text, trip_no text, customer_name text, order_no text, amount numeric, taken_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_perm('finance','view') OR public.has_perm('settings','view')) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
  SELECT f.id, f.path,
    f.photo_type || '/' || to_char(f.taken_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') || '/' ||
      regexp_replace(coalesce(t.trip_no::text, c.business_name::text, 'other'), '[^A-Za-z0-9_-]+', '-', 'g'),
    regexp_replace(f.path, '^.*/', ''),
    (f.taken_at AT TIME ZONE 'Asia/Kolkata')::date, f.photo_type, t.trip_no::text, c.business_name::text, o.order_no::text, f.amount, up.full_name::text
  FROM public.photo_files f
  LEFT JOIN public.trips t ON t.id = f.trip_id
  LEFT JOIN public.customers c ON c.id = f.customer_id
  LEFT JOIN public.orders o ON o.id = f.order_id
  LEFT JOIN public.user_profiles up ON up.id = f.taken_by
  WHERE f.company_id = public.my_company_id() AND f.file_deleted_at IS NULL AND f.id = ANY(p_ids);
END $$;
REVOKE ALL ON FUNCTION public.photos_expiring(integer), public.photo_backup_index(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.photos_expiring(integer), public.photo_backup_index(uuid[]) TO authenticated;