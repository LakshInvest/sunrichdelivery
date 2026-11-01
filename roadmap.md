# Roadmap — Sunrich Delivery

Prompt-3 (rename + login redesign + phone fit): complete.
Prompt-4 (login security + vehicle-check languages): complete.

## Prompt-4 Stage 1 — Login security
- [x] Removed the mobile-only token path (staffOtpLogin returned a magic-link
      token for a bare mobile number). Replaced by staffRequestOtp + staffVerifyOtp:
      6-digit code stored hashed (sha256), 5-minute validity, single use,
      5 wrong tries → 15-minute lock (otp_requests.locked_until), no code/token
      ever returned before verification.
- [x] PIN path unchanged: check_pin enforces trusted device + 5 wrong tries → OTP.
- [x] login_without_otp honored from the DB flag and audited (audit_logs,
      action login_without_otp) on both the PIN and OTP paths.
- [x] Tests run (browser + DB): bare mobile → no token; wrong OTP ×4 → countdown;
      5th → locked 15 min (locked_until verified); correct OTP → signed in;
      wrong PIN ×5 → locked; correct PIN on trusted phone → signed in. Test rows cleaned up.
- [ ] OTP delivery: no WhatsApp gateway exists in this backend — the code is
      generated and verified but cannot reach the phone yet. Integration point:
      staffRequestOtp in src/lib/staff-login.functions.ts (marked "Delivery hook").

## Prompt-4 Stage 2 — Vehicle-check names in EN/HI/MR
- [x] SQL prepared, NOT run (user runs it): database/20261101_043_vehicle_check_item_names.sql
      (vehicle_check_item_names: en unique, name_hi, name_mr, seeded with the six
      current items; read-only for authenticated).
- [x] App reads the table and falls back to English when a translation is empty
      or the table is missing (useVehicleCheckNames in driver-parts.tsx).
