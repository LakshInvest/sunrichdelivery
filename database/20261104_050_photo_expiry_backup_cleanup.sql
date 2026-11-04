ALTER TABLE public.delivery_settings
  ADD COLUMN IF NOT EXISTS photo_delete_after_download boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS photo_days_odometer integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS photo_days_delivery integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS photo_days_cheque integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS photo_days_upi integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS photo_days_visitor integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS photo_days_challan integer NOT NULL DEFAULT 180,
  ADD COLUMN IF NOT EXISTS photo_days_problem integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS photo_days_selfie integer NOT NULL DEFAULT 30;

CREATE TABLE IF NOT EXISTS public.photo_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  created_by uuid,
  zip_path text,
  photo_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.photo_backups TO authenticated;
GRANT ALL ON public.photo_backups TO service_role;
ALTER TABLE public.photo_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "photo_backups_read" ON public.photo_backups FOR SELECT TO authenticated
  USING (company_id = public.my_company_id() AND (public.has_perm('finance','view') OR public.has_perm('settings','view')));

CREATE TABLE IF NOT EXISTS public.photo_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  bucket text NOT NULL DEFAULT 'operations',
  path text NOT NULL UNIQUE,
  photo_type text NOT NULL,
  source_table text NOT NULL,
  source_id uuid,
  trip_id uuid,
  customer_id uuid,
  order_id uuid,
  amount numeric,
  taken_by uuid,
  taken_at timestamptz NOT NULL DEFAULT now(),
  expires_on date,
  notice_sent_at timestamptz,
  delete_due_at timestamptz,
  downloaded_at timestamptz,
  downloaded_by uuid,
  backup_id uuid REFERENCES public.photo_backups(id),
  file_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photo_files_expiry_idx ON public.photo_files (company_id, expires_on) WHERE file_deleted_at IS NULL;
GRANT SELECT ON public.photo_files TO authenticated;
GRANT ALL ON public.photo_files TO service_role;
ALTER TABLE public.photo_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "photo_files_read" ON public.photo_files FOR SELECT TO authenticated
  USING (company_id = public.my_company_id() AND (public.has_perm('finance','view') OR public.has_perm('settings','view')));

CREATE TABLE IF NOT EXISTS public.photo_cleanup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL DEFAULT 'plan',
  ran_at timestamptz NOT NULL DEFAULT now(),
  expired integer NOT NULL DEFAULT 0,
  due integer NOT NULL DEFAULT 0,
  kept_not_downloaded integer NOT NULL DEFAULT 0,
  deleted integer NOT NULL DEFAULT 0,
  notices integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);
GRANT SELECT ON public.photo_cleanup_runs TO authenticated;
GRANT ALL ON public.photo_cleanup_runs TO service_role;
ALTER TABLE public.photo_cleanup_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "photo_cleanup_runs_read" ON public.photo_cleanup_runs FOR SELECT TO authenticated
  USING (public.has_perm('settings','view'));

CREATE OR REPLACE FUNCTION public._photo_days(p_company uuid, p_type text) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT CASE p_type
      WHEN 'odometer' THEN s.photo_days_odometer WHEN 'delivery' THEN s.photo_days_delivery
      WHEN 'cheque' THEN s.photo_days_cheque WHEN 'upi' THEN s.photo_days_upi
      WHEN 'visitor' THEN s.photo_days_visitor WHEN 'challan' THEN s.photo_days_challan
      WHEN 'problem' THEN s.photo_days_problem WHEN 'selfie' THEN s.photo_days_selfie END
    FROM public.delivery_settings s WHERE s.company_id = p_company LIMIT 1),
    CASE WHEN p_type IN ('delivery','cheque','challan') THEN 180 ELSE 30 END)
$$;

CREATE OR REPLACE FUNCTION public._photo_register(p_company uuid, p_path text, p_type text, p_src text, p_src_id uuid,
  p_trip uuid, p_customer uuid, p_order uuid, p_amount numeric, p_by uuid, p_base timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_exp date;
BEGIN
  IF p_company IS NULL OR p_path IS NULL OR btrim(p_path) = '' OR p_path LIKE 'http%' OR p_path LIKE 'data:%' THEN RETURN; END IF;
  v_exp := CASE WHEN p_base IS NULL THEN NULL
                ELSE (p_base AT TIME ZONE 'Asia/Kolkata')::date + public._photo_days(p_company, p_type) END;
  INSERT INTO public.photo_files (company_id, path, photo_type, source_table, source_id, trip_id, customer_id, order_id, amount, taken_by, expires_on)
  VALUES (p_company, p_path, p_type, p_src, p_src_id, p_trip, p_customer, p_order, p_amount, p_by, v_exp)
  ON CONFLICT (path) DO UPDATE SET
    expires_on = CASE WHEN photo_files.file_deleted_at IS NULL THEN EXCLUDED.expires_on ELSE photo_files.expires_on END,
    trip_id = coalesce(photo_files.trip_id, EXCLUDED.trip_id),
    customer_id = coalesce(photo_files.customer_id, EXCLUDED.customer_id),
    order_id = coalesce(photo_files.order_id, EXCLUDED.order_id),
    amount = coalesce(EXCLUDED.amount, photo_files.amount),
    updated_at = now();
END $$;
REVOKE ALL ON FUNCTION public._photo_register(uuid,text,text,text,uuid,uuid,uuid,uuid,numeric,uuid,timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._photo_trg_trips() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._photo_register(NEW.company_id, NEW.start_odometer_photo_url, 'odometer', 'trips', NEW.id, NEW.id, NULL, NULL, NULL, NEW.driver_user_id, coalesce(NEW.driver_started_at, NEW.created_at));
  PERFORM public._photo_register(NEW.company_id, NEW.end_odometer_photo_url, 'odometer', 'trips', NEW.id, NEW.id, NULL, NULL, NULL, NEW.driver_user_id, coalesce(NEW.ended_at, now()));
  PERFORM public._photo_register(NEW.company_id, NEW.start_selfie_url, 'selfie', 'trips', NEW.id, NEW.id, NULL, NULL, NULL, NEW.driver_user_id, coalesce(NEW.driver_started_at, NEW.created_at));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._photo_trg_stops() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t record; v_cust uuid;
BEGIN
  IF NEW.photo_url IS NULL THEN RETURN NEW; END IF;
  SELECT company_id, driver_user_id INTO t FROM public.trips WHERE id = NEW.trip_id;
  SELECT customer_id INTO v_cust FROM public.orders WHERE id = NEW.order_id;
  PERFORM public._photo_register(t.company_id, NEW.photo_url, 'delivery', 'trip_stops', NEW.id, NEW.trip_id, v_cust, NEW.order_id, NULL, t.driver_user_id, coalesce(NEW.delivered_at, now()));
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._photo_trg_collections() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_company uuid;
BEGIN
  IF NEW.photo_url IS NULL THEN RETURN NEW; END IF;
  SELECT company_id INTO v_company FROM public.trips WHERE id = NEW.trip_id;
  PERFORM public._photo_register(v_company, NEW.photo_url, CASE WHEN NEW.mode = 'cheque' THEN 'cheque' ELSE 'upi' END,
    'trip_collections', NEW.id, NEW.trip_id, NEW.customer_id, NEW.order_id, NEW.amount, NEW.collected_by,
    CASE WHEN NEW.mode = 'cheque' THEN NEW.collected_at WHEN NEW.confirmed THEN now() END);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._photo_trg_proofs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._photo_register(NEW.company_id, NEW.screenshot_path, CASE WHEN NEW.method = 'cheque' THEN 'cheque' ELSE 'upi' END,
    'payment_proofs', NEW.id, NULL, NEW.customer_id, NEW.order_id, NEW.amount, coalesce(NEW.collected_by, NEW.submitted_by),
    CASE WHEN NEW.method = 'cheque' THEN NEW.created_at ELSE NEW.reviewed_at END);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._photo_trg_receipts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._photo_register(NEW.company_id, NEW.cheque_photo_url, 'cheque', 'receipts', NEW.id, NULL, NEW.customer_id, NULL, NEW.amount, coalesce(NEW.collected_by, NEW.created_by), NEW.created_at);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._photo_trg_gate_entries() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._photo_register(NEW.company_id, NEW.photo_path, 'visitor', 'gate_entries', NEW.id, NULL, NULL, NULL, NULL, NEW.in_by, NEW.in_at);
  PERFORM public._photo_register(NEW.company_id, NEW.challan_photo_path, 'challan', 'gate_entries', NEW.id, NULL, NULL, NULL, NULL, NEW.in_by, NEW.in_at);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._photo_trg_problems() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._photo_register(NEW.company_id, NEW.photo_path, 'problem', 'gate_problems', NEW.id, NULL, NULL, NULL, NULL, NEW.raised_by, NEW.resolved_at);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public._photo_trg_shifts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._photo_register(NEW.company_id, NEW.selfie_path, 'selfie', 'guard_shifts', NEW.id, NULL, NULL, NULL, NULL, NEW.guard_user_id, NEW.started_at);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS photo_files_reg ON public.trips;
CREATE TRIGGER photo_files_reg AFTER INSERT OR UPDATE OF start_odometer_photo_url, end_odometer_photo_url, start_selfie_url, ended_at ON public.trips FOR EACH ROW EXECUTE FUNCTION public._photo_trg_trips();
DROP TRIGGER IF EXISTS photo_files_reg ON public.trip_stops;
CREATE TRIGGER photo_files_reg AFTER INSERT OR UPDATE OF photo_url ON public.trip_stops FOR EACH ROW EXECUTE FUNCTION public._photo_trg_stops();
DROP TRIGGER IF EXISTS photo_files_reg ON public.trip_collections;
CREATE TRIGGER photo_files_reg AFTER INSERT OR UPDATE OF photo_url, confirmed ON public.trip_collections FOR EACH ROW EXECUTE FUNCTION public._photo_trg_collections();
DROP TRIGGER IF EXISTS photo_files_reg ON public.payment_proofs;
CREATE TRIGGER photo_files_reg AFTER INSERT OR UPDATE OF screenshot_path, reviewed_at ON public.payment_proofs FOR EACH ROW EXECUTE FUNCTION public._photo_trg_proofs();
DROP TRIGGER IF EXISTS photo_files_reg ON public.receipts;
CREATE TRIGGER photo_files_reg AFTER INSERT OR UPDATE OF cheque_photo_url ON public.receipts FOR EACH ROW EXECUTE FUNCTION public._photo_trg_receipts();
DROP TRIGGER IF EXISTS photo_files_reg ON public.gate_entries;
CREATE TRIGGER photo_files_reg AFTER INSERT OR UPDATE OF photo_path, challan_photo_path ON public.gate_entries FOR EACH ROW EXECUTE FUNCTION public._photo_trg_gate_entries();
DROP TRIGGER IF EXISTS photo_files_reg ON public.gate_problems;
CREATE TRIGGER photo_files_reg AFTER INSERT OR UPDATE OF photo_path, resolved_at ON public.gate_problems FOR EACH ROW EXECUTE FUNCTION public._photo_trg_problems();
DROP TRIGGER IF EXISTS photo_files_reg ON public.guard_shifts;
CREATE TRIGGER photo_files_reg AFTER INSERT OR UPDATE OF selfie_path ON public.guard_shifts FOR EACH ROW EXECUTE FUNCTION public._photo_trg_shifts();

-- Backfill existing photos (records only; nothing is deleted)
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM public.trips WHERE coalesce(start_odometer_photo_url, end_odometer_photo_url, start_selfie_url) IS NOT NULL LOOP
    PERFORM public._photo_register(r.company_id, r.start_odometer_photo_url, 'odometer', 'trips', r.id, r.id, NULL, NULL, NULL, r.driver_user_id, coalesce(r.driver_started_at, r.created_at));
    PERFORM public._photo_register(r.company_id, r.end_odometer_photo_url, 'odometer', 'trips', r.id, r.id, NULL, NULL, NULL, r.driver_user_id, coalesce(r.ended_at, r.updated_at));
    PERFORM public._photo_register(r.company_id, r.start_selfie_url, 'selfie', 'trips', r.id, r.id, NULL, NULL, NULL, r.driver_user_id, coalesce(r.driver_started_at, r.created_at));
  END LOOP;
  FOR r IN SELECT s.*, t.company_id, t.driver_user_id, o.customer_id FROM public.trip_stops s JOIN public.trips t ON t.id = s.trip_id LEFT JOIN public.orders o ON o.id = s.order_id WHERE s.photo_url IS NOT NULL LOOP
    PERFORM public._photo_register(r.company_id, r.photo_url, 'delivery', 'trip_stops', r.id, r.trip_id, r.customer_id, r.order_id, NULL, r.driver_user_id, coalesce(r.delivered_at, r.arrived_at, now()));
  END LOOP;
  FOR r IN SELECT c.*, t.company_id FROM public.trip_collections c JOIN public.trips t ON t.id = c.trip_id WHERE c.photo_url IS NOT NULL LOOP
    PERFORM public._photo_register(r.company_id, r.photo_url, CASE WHEN r.mode = 'cheque' THEN 'cheque' ELSE 'upi' END, 'trip_collections', r.id, r.trip_id, r.customer_id, r.order_id, r.amount, r.collected_by, CASE WHEN r.mode = 'cheque' OR r.confirmed THEN r.collected_at END);
  END LOOP;
  FOR r IN SELECT * FROM public.payment_proofs WHERE screenshot_path IS NOT NULL LOOP
    PERFORM public._photo_register(r.company_id, r.screenshot_path, CASE WHEN r.method = 'cheque' THEN 'cheque' ELSE 'upi' END, 'payment_proofs', r.id, NULL, r.customer_id, r.order_id, r.amount, coalesce(r.collected_by, r.submitted_by), CASE WHEN r.method = 'cheque' THEN r.created_at ELSE r.reviewed_at END);
  END LOOP;
  FOR r IN SELECT * FROM public.receipts WHERE cheque_photo_url IS NOT NULL LOOP
    PERFORM public._photo_register(r.company_id, r.cheque_photo_url, 'cheque', 'receipts', r.id, NULL, r.customer_id, NULL, r.amount, coalesce(r.collected_by, r.created_by), r.created_at);
  END LOOP;
  FOR r IN SELECT * FROM public.gate_entries WHERE coalesce(photo_path, challan_photo_path) IS NOT NULL LOOP
    PERFORM public._photo_register(r.company_id, r.photo_path, 'visitor', 'gate_entries', r.id, NULL, NULL, NULL, NULL, r.in_by, r.in_at);
    PERFORM public._photo_register(r.company_id, r.challan_photo_path, 'challan', 'gate_entries', r.id, NULL, NULL, NULL, NULL, r.in_by, r.in_at);
  END LOOP;
  FOR r IN SELECT * FROM public.gate_problems WHERE photo_path IS NOT NULL LOOP
    PERFORM public._photo_register(r.company_id, r.photo_path, 'problem', 'gate_problems', r.id, NULL, NULL, NULL, NULL, r.raised_by, r.resolved_at);
  END LOOP;
  FOR r IN SELECT * FROM public.guard_shifts WHERE selfie_path IS NOT NULL LOOP
    PERFORM public._photo_register(r.company_id, r.selfie_path, 'selfie', 'guard_shifts', r.id, NULL, NULL, NULL, NULL, r.guard_user_id, r.started_at);
  END LOOP;
END $$;

-- Command Center: photos expiring soon
CREATE OR REPLACE FUNCTION public.photos_expiring(p_days integer DEFAULT 7)
RETURNS TABLE (id uuid, photo_type text, expires_on date, taken_at timestamptz, trip_no text, customer_name text, order_no text, amount numeric, taken_by_name text, path text, downloaded_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_perm('finance','view') OR public.has_perm('settings','view')) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
  SELECT f.id, f.photo_type, f.expires_on, f.taken_at, t.trip_no, c.name::text, o.order_no::text, f.amount, up.full_name::text, f.path, f.downloaded_at
  FROM public.photo_files f
  LEFT JOIN public.trips t ON t.id = f.trip_id
  LEFT JOIN public.customers c ON c.id = f.customer_id
  LEFT JOIN public.orders o ON o.id = f.order_id
  LEFT JOIN public.user_profiles up ON up.id = f.taken_by
  WHERE f.company_id = public.my_company_id() AND f.file_deleted_at IS NULL AND f.expires_on IS NOT NULL
    AND f.expires_on <= (now() AT TIME ZONE 'Asia/Kolkata')::date + greatest(p_days, 0)
  ORDER BY f.expires_on, f.photo_type, f.taken_at;
END $$;
GRANT EXECUTE ON FUNCTION public.photos_expiring(integer) TO authenticated;

-- Rows for the ZIP index (checks permission; returns folder + file names)
CREATE OR REPLACE FUNCTION public.photo_backup_index(p_ids uuid[])
RETURNS TABLE (id uuid, path text, folder text, file_name text, taken_on date, photo_type text, trip_no text, customer_name text, order_no text, amount numeric, taken_by_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_perm('finance','view') OR public.has_perm('settings','view')) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  RETURN QUERY
  SELECT f.id, f.path,
    f.photo_type || '/' || to_char(f.taken_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') || '/' ||
      regexp_replace(coalesce(t.trip_no, c.name, 'other'), '[^A-Za-z0-9_-]+', '-', 'g'),
    regexp_replace(f.path, '^.*/', ''),
    (f.taken_at AT TIME ZONE 'Asia/Kolkata')::date, f.photo_type, t.trip_no, c.name::text, o.order_no::text, f.amount, up.full_name::text
  FROM public.photo_files f
  LEFT JOIN public.trips t ON t.id = f.trip_id
  LEFT JOIN public.customers c ON c.id = f.customer_id
  LEFT JOIN public.orders o ON o.id = f.order_id
  LEFT JOIN public.user_profiles up ON up.id = f.taken_by
  WHERE f.company_id = public.my_company_id() AND f.file_deleted_at IS NULL AND f.id = ANY(p_ids);
END $$;
GRANT EXECUTE ON FUNCTION public.photo_backup_index(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_photos_downloaded(p_ids uuid[], p_zip_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_n integer;
BEGIN
  IF NOT (public.has_perm('finance','view') OR public.has_perm('settings','view')) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  INSERT INTO public.photo_backups (company_id, created_by, zip_path) VALUES (public.my_company_id(), auth.uid(), p_zip_path) RETURNING id INTO v_id;
  UPDATE public.photo_files SET downloaded_at = now(), downloaded_by = auth.uid(), backup_id = v_id, updated_at = now()
   WHERE company_id = public.my_company_id() AND id = ANY(p_ids) AND file_deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.photo_backups SET photo_count = v_n WHERE id = v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.mark_photos_downloaded(uuid[], text) TO authenticated;

-- Files that may be deleted now (expired AND (setting off OR downloaded)); service only
CREATE OR REPLACE FUNCTION public.photo_cleanup_due(p_limit integer DEFAULT 500)
RETURNS TABLE (id uuid, bucket text, path text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT f.id, f.bucket, f.path FROM public.photo_files f
  LEFT JOIN public.delivery_settings s ON s.company_id = f.company_id
  WHERE f.file_deleted_at IS NULL AND f.expires_on IS NOT NULL
    AND f.expires_on < (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND (coalesce(s.photo_delete_after_download, true) = false OR f.downloaded_at IS NOT NULL)
  ORDER BY f.expires_on LIMIT greatest(p_limit, 0)
$$;
CREATE OR REPLACE FUNCTION public.photo_cleanup_done(p_ids uuid[], p_errors jsonb DEFAULT '[]'::jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.photo_files SET file_deleted_at = now(), updated_at = now() WHERE id = ANY(p_ids) AND file_deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO public.photo_cleanup_runs (kind, deleted, errors) VALUES ('delete', v_n, coalesce(p_errors, '[]'::jsonb));
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.photo_cleanup_due(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.photo_cleanup_done(uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_cleanup_due(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.photo_cleanup_done(uuid[], jsonb) TO service_role;

-- Daily plan: log, flag due files, 7-day notices to Admin/Accounts
CREATE OR REPLACE FUNCTION public.photo_cleanup_plan()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date; v_run uuid; v_exp int; v_due int; v_kept int; v_notices int := 0; v_n_tmp int; r record;
BEGIN
  SELECT count(*) INTO v_exp FROM public.photo_files WHERE file_deleted_at IS NULL AND expires_on < v_today;
  UPDATE public.photo_files f SET delete_due_at = now()
   WHERE f.delete_due_at IS NULL AND f.id IN (SELECT d.id FROM public.photo_cleanup_due(100000) d);
  SELECT count(*) INTO v_due FROM public.photo_cleanup_due(100000);
  v_kept := v_exp - v_due;
  FOR r IN
    SELECT f.company_id, count(*) AS n, min(f.expires_on) AS first_day
    FROM public.photo_files f
    WHERE f.file_deleted_at IS NULL AND f.notice_sent_at IS NULL AND f.downloaded_at IS NULL
      AND f.expires_on IS NOT NULL AND f.expires_on <= v_today + 7
    GROUP BY f.company_id
  LOOP
    INSERT INTO public.staff_notifications (company_id, user_id, kind, title, body)
    SELECT DISTINCT r.company_id, ur.user_id, 'photo_expiry',
      r.n || ' photos expire soon',
      r.n || ' photos expire from ' || to_char(r.first_day, 'DD Mon YYYY') || '. Download the backup in Command Center before they are deleted.'
    FROM public.user_roles ur JOIN public.roles ro ON ro.id = ur.role_id
    WHERE ro.company_id = r.company_id AND ro.code IN ('ADMIN','ACCOUNTS') AND coalesce(ro.is_active, true);
    GET DIAGNOSTICS v_n_tmp = ROW_COUNT;
    v_notices := v_notices + v_n_tmp;
    UPDATE public.photo_files SET notice_sent_at = now()
     WHERE company_id = r.company_id AND file_deleted_at IS NULL AND notice_sent_at IS NULL AND downloaded_at IS NULL
       AND expires_on IS NOT NULL AND expires_on <= v_today + 7;
  END LOOP;
  INSERT INTO public.photo_cleanup_runs (kind, expired, due, kept_not_downloaded, notices)
  VALUES ('plan', v_exp, v_due, v_kept, v_notices) RETURNING id INTO v_run;
  RETURN v_run;
END $$;
REVOKE ALL ON FUNCTION public.photo_cleanup_plan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.photo_cleanup_plan() TO service_role;

SELECT cron.schedule('sunrich_photo_cleanup_plan', '30 20 * * *', $$SELECT public.photo_cleanup_plan();$$);