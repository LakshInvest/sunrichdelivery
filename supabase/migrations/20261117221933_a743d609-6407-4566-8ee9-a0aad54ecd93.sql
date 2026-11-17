CREATE TABLE public.courier_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courier_companies TO authenticated;
GRANT ALL ON public.courier_companies TO service_role;
ALTER TABLE public.courier_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read couriers" ON public.courier_companies FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY "admins manage couriers" ON public.courier_companies FOR ALL TO authenticated
  USING (public.is_super_admin() OR public.has_perm('gate','edit'))
  WITH CHECK (public.is_super_admin() OR public.has_perm('gate','edit'));
CREATE OR REPLACE FUNCTION public.courier_companies_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER courier_companies_updated BEFORE UPDATE ON public.courier_companies FOR EACH ROW EXECUTE FUNCTION public.courier_companies_touch();
INSERT INTO public.courier_companies(name, sort_order) VALUES
 ('Blue Dart',10),('Delhivery',20),('DTDC',30),('India Post',40),('Amazon',50),('Flipkart (Ekart)',60),('XpressBees',70),('Shadowfax',80);