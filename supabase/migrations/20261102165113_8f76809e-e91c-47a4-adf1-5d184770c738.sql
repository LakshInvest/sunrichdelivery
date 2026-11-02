CREATE TABLE public.gate_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.my_company_id(),
  mobile text NOT NULL,
  name text NOT NULL,
  person_type text NOT NULL DEFAULT 'visitor',
  staff_user_id uuid,
  purpose text,
  vehicle_no text,
  in_at timestamptz NOT NULL DEFAULT now(),
  out_at timestamptz,
  in_by uuid NOT NULL DEFAULT auth.uid(),
  out_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.gate_entries TO authenticated;
GRANT ALL ON public.gate_entries TO service_role;
ALTER TABLE public.gate_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read own company gate entries" ON public.gate_entries FOR SELECT TO authenticated
  USING (public.is_staff() AND company_id = public.my_company_id());

CREATE OR REPLACE FUNCTION public.gate_find_person(p_mobile text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE m text := '+91' || right(regexp_replace(coalesce(p_mobile,''), '\D', '', 'g'), 10); r record;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT id, full_name, user_type INTO r FROM user_profiles
   WHERE mobile = m AND company_id = my_company_id() AND is_active
   ORDER BY (user_type = 'staff') DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('mobile', m, 'found', false); END IF;
  RETURN jsonb_build_object('mobile', m, 'found', true, 'name', r.full_name,
    'is_staff', r.user_type = 'staff', 'user_id', r.id,
    'inside', EXISTS (SELECT 1 FROM gate_entries WHERE mobile = m AND out_at IS NULL AND company_id = my_company_id()));
END $$;

CREATE OR REPLACE FUNCTION public.gate_entry_in(p_mobile text, p_name text, p_purpose text DEFAULT NULL, p_vehicle text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m text := '+91' || right(regexp_replace(coalesce(p_mobile,''), '\D', '', 'g'), 10); sid uuid; nid uuid;
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF length(m) <> 13 THEN RAISE EXCEPTION 'bad_mobile'; END IF;
  IF coalesce(trim(p_name),'') = '' THEN RAISE EXCEPTION 'name_required'; END IF;
  IF EXISTS (SELECT 1 FROM gate_entries WHERE mobile = m AND out_at IS NULL AND company_id = my_company_id()) THEN
    RAISE EXCEPTION 'already_inside'; END IF;
  SELECT id INTO sid FROM user_profiles WHERE mobile = m AND user_type = 'staff' AND company_id = my_company_id() LIMIT 1;
  INSERT INTO gate_entries (mobile, name, person_type, staff_user_id, purpose, vehicle_no)
  VALUES (m, trim(p_name), CASE WHEN sid IS NULL THEN 'visitor' ELSE 'staff' END, sid, nullif(trim(p_purpose),''), nullif(upper(trim(p_vehicle)),''))
  RETURNING id INTO nid;
  RETURN nid;
END $$;

CREATE OR REPLACE FUNCTION public.gate_entry_out(p_entry_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff() THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE gate_entries SET out_at = now(), out_by = auth.uid(), updated_at = now()
   WHERE id = p_entry_id AND out_at IS NULL AND company_id = my_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_inside'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.gate_find_person(text), public.gate_entry_in(text,text,text,text), public.gate_entry_out(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gate_find_person(text), public.gate_entry_in(text,text,text,text), public.gate_entry_out(uuid) TO authenticated;