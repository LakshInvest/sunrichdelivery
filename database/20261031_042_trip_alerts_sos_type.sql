-- SOS alerts: allow alert_type 'sos' alongside breakdown/accident/other.
-- Applied 2026-10-31 (raise_trip_alert sends p_type 'sos').
ALTER TABLE public.trip_alerts DROP CONSTRAINT IF EXISTS trip_alerts_alert_type_check;
ALTER TABLE public.trip_alerts ADD CONSTRAINT trip_alerts_alert_type_check
  CHECK (alert_type = ANY (ARRAY['breakdown'::text, 'accident'::text, 'other'::text, 'sos'::text]));
