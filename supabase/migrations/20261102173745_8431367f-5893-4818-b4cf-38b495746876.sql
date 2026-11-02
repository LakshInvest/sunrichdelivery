CREATE OR REPLACE FUNCTION public._pickup_pass_code()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.delivery_mode = 'pickup' AND NEW.delivery_otp IS NULL AND NEW.status::text IN ('approved','processing') THEN
    NEW.delivery_otp := lpad((floor(random() * 10000))::int::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pickup_pass_code ON public.orders;
CREATE TRIGGER trg_pickup_pass_code BEFORE INSERT OR UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public._pickup_pass_code();
UPDATE public.orders SET delivery_otp = lpad((floor(random() * 10000))::int::text, 4, '0')
 WHERE delivery_mode = 'pickup' AND delivery_otp IS NULL AND status::text IN ('approved','processing');