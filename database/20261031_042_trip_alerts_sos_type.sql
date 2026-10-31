-- SOS alerts: allow alert_type 'sos' alongside breakdown/accident/other.
-- Applied 2026-10-31 (raise_trip_alert sends p_type 'sos').
ALTER TABLE public.trip_alerts DROP CONSTRAINT IF EXISTS ta_type;
ALTER TABLE public.trip_alerts ADD CONSTRAINT ta_type
  CHECK (alert_type = ANY (ARRAY['breakdown'::text, 'accident'::text, 'other'::text, 'sos'::text]));
