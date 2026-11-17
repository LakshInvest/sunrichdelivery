ALTER TABLE public.gate_entries ADD COLUMN IF NOT EXISTS out_photo_path text;

CREATE OR REPLACE FUNCTION public._photo_days(p_company uuid, p_type text)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT CASE p_type
      WHEN 'odometer' THEN s.photo_days_odometer WHEN 'delivery' THEN s.photo_days_delivery
      WHEN 'cheque' THEN s.photo_days_cheque WHEN 'upi' THEN s.photo_days_upi
      WHEN 'visitor' THEN s.photo_days_visitor WHEN 'challan' THEN s.photo_days_challan
      WHEN 'problem' THEN s.photo_days_problem WHEN 'selfie' THEN s.photo_days_selfie END
    FROM public.delivery_settings s WHERE s.company_id = p_company LIMIT 1),
    CASE WHEN p_type IN ('delivery','cheque','challan') THEN 180 ELSE 30 END)
$function$;

CREATE OR REPLACE FUNCTION public._photo_trg_gate_entries()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._photo_register(NEW.company_id, NEW.photo_path, 'visitor', 'gate_entries', NEW.id, NULL, NULL, NULL, NULL, NEW.in_by, NEW.in_at);
  PERFORM public._photo_register(NEW.company_id, NEW.challan_photo_path, 'challan', 'gate_entries', NEW.id, NULL, NULL, NULL, NULL, NEW.in_by, NEW.in_at);
  PERFORM public._photo_register(NEW.company_id, NEW.out_photo_path, 'gate_out_goods', 'gate_entries', NEW.id, NULL, NULL, NULL, NULL, NEW.out_by, NEW.out_at);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS photo_files_reg ON public.gate_entries;
CREATE TRIGGER photo_files_reg AFTER INSERT OR UPDATE OF photo_path, challan_photo_path, out_photo_path ON public.gate_entries
 FOR EACH ROW EXECUTE FUNCTION public._photo_trg_gate_entries();

DROP FUNCTION IF EXISTS public.gate_entry_out(uuid);
CREATE FUNCTION public.gate_entry_out(p_entry_id uuid, p_out_photo text DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_perm('gate','create') THEN RAISE EXCEPTION 'not_allowed'; END IF;
  UPDATE gate_entries SET out_at = now(), out_by = auth.uid(), updated_at = now(),
         out_photo_path = nullif(btrim(coalesce(p_out_photo,'')),'')
   WHERE id = p_entry_id AND out_at IS NULL AND company_id = my_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'not_inside'; END IF;
END $function$;
REVOKE ALL ON FUNCTION public.gate_entry_out(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.gate_entry_out(uuid, text) TO authenticated, service_role;