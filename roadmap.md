# Roadmap — Sunrich Delivery

## Prompt-20 follow-ups
- [x] Follow-up sweep: read driver/loader/guard/cashier/list subscriptions, role counts, offline replay, payment/receipt/settlement/proof functions and photo job. All subscribed tables published; role counts now use realtime with their original 30-second fallback. 108 phone/desktop light/dark page checks, no runtime/subscription errors; completed payment stops correctly show done, not a second save. External office/customer UI and physical APK not exercised. 34 tests passed; no records/settings/permissions changed in sweep.
- [x] QA Loader has Dispatch/Loader/Security; missing Dispatch/Security restored and verified.
- [x] Previous delay was fallback: trip_expenses missing from publication rejected the combined subscription. Enabled it; two-browser gate-to-driver update 0.513s, event source realtime; fallback unchanged at 15s.
- [x] Cheque ₹160/photo/number, Bank ₹160/reference, guard mobile/PIN/selfie, and start selfie/six vehicle checks/photo saved through screens and read back. Bank tc_mode constraint widened to include bank. Selfie/check switches restored OFF; temporary QA Driver Security role removed.
- [x] Short results table prepared; no publishing performed.
- QA cleanup: payment trip f2000000-0000-4000-8000-000000000003 ended, gate-in and returns recorded (cashier settlement pending); empty timing trip 5ef5a8ec-842d-4f2e-8ed7-07a47f963741 gate-out recorded, not started. QA Loader is the latest guard after handover. Real trip untouched.

## Nov 17 one-task screens
- [x] Driver: separate routed home, gate pass, start, next stop, goods/counts, proof/photo/signature, payment modes/office, done, stops, end, handover and enabled extras.
- [x] Loader: separate loading/counts and returns/counts; Guard: separate scan/result, entry, exit and menu tasks.
- [x] Scoped realtime updates, immediate action refresh, foreground/network recovery and 15-second fallback; native foreground dispatches focus.
- [x] Hindi 360×780 full two-stop trip, credit skip, cash handover/settlement; extra trip split payment, office approval, expense/SOS/pickup/spot saves; QA trips settled and real trip untouched. 31 tests passed.
- [x] Guard-to-driver timing corrected in Prompt-20: 0.513s via realtime in two browsers at Hindi 360×780; previous delay was fallback recovery.
- [x] UPI QR rendered in split-payment QA; ₹60 cash + ₹100 UPI saved. Temporary QA Loader Security membership removed after gate tests; visitor/parcel exit and problem save passed.
- [ ] Physical native scanning/device checks require Android hardware. Cheque/bank and optional selfie/check saves passed browser QA in Prompt-20.

## Customer-style login (Nov 16, no SQL)
- [x] Photo and appearance settings with cached images; white content-height card for every login step. Anonymous app_settings returns no rows; narrow publicLoginAppearance exposes only the three branding fields, no SQL.
- [x] Phone-language login, no language switch; transparent native status bar code on login.
- [x] Mobile/PIN/OTP at 360×640, 390×844, 412×915 passed Android Chromium emulation; keyboard-height simulation, real QA PIN sign-in, settings/image cache and 11 tests passed. Publishing requested.
- [ ] Physical APK status bar and keyboard check — requires an Android device; browser emulation cannot verify native chrome.

## Nov 16 fix round (no SQL)
- [x] Separate OTP/PIN errors and recover expired OTP locks with server-side code replacement; no SQL.
- [x] Replace web icons, including safe-zone maskable and in-app icon. Existing public icons overwritten; no offline HTML page or app-shell service worker exists. Historic CDN wordmarks retained for previous deployments; native APK artwork unchanged.
- [x] Nine regression tests; real QA PIN sign-in and controlled PIN/OTP lock + 30-second resend UI checks passed. Publishing requested after final checks.
- [ ] Real WhatsApp locked-code recovery confirmation — requires the staff member to receive and enter the replacement code; not exercised against live OTP rows.

Prompt-3 (rename + login redesign + phone fit): complete.
Prompt-4 (login security + vehicle-check languages): complete.
Prompt-5 (WhatsApp OTP delivery via AiSensy): code complete, tested; awaiting user's receive-and-verify confirmation.

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
## Prompt-5 — WhatsApp OTP delivery via AiSensy
- [x] sendOtpWhatsapp wired at the former "Delivery hook" in
      src/lib/staff-login.functions.ts: reads AISENSY_API_KEY +
      AISENSY_OTP_CAMPAIGN (badiyouserlogin) project secrets (never hard-coded),
      POSTs to backend.aisensy.com/campaign/t1/api/v2, templateParams [otp],
      copy-code button parameter sent with EVERY call (AiSensy reports success
      even when WhatsApp later rejects a Url button without parameters, so the
      old retry-on-rejection path was removed).
- [x] Rate limit: max 3 sends per mobile per 15 min → err.too_many_codes,
      checked before any send.
- [x] Send failure consumes the stored code and shows err.otp_send_failed
      ("Could not send the code. Try again.", EN/HI/MR); failure reason logged
      server-side without the code or key.
- [x] Tests (browser + DB): planted-code verify → signed in as Owner;
      real send to 8698340766 accepted (row stored unconsumed, no error shown);
      3 planted rows → 4th request refused with the too-many message, no new
      row. Test rows cleaned up.
- [ ] User confirmation pending: read the code on WhatsApp and type it in the
      preview (Resend issues a fresh code; the 08:19 UTC code expires at 08:24).
- Note: profile +918698340766 was flipped from customer to staff (was
      user_type 'customer', full_name was '8698340766') so the team app can
      deliver to it; it has no team roles yet.

## Prompt-4 Stage 2 — Vehicle-check names in EN/HI/MR
- [x] SQL prepared, NOT run (user runs it): database/20261101_043_vehicle_check_item_names.sql
      (vehicle_check_item_names: en unique, name_hi, name_mr, seeded with the six
      current items; read-only for authenticated).
- [x] App reads the table and falls back to English when a translation is empty
      or the table is missing (useVehicleCheckNames in driver-parts.tsx).

## Delivery v2 (Prompt-5) — one part per run
- [x] 1. Login, PIN and profile
- [x] 2. Trip chain: Do later, Full/Part/None + Ask office (wait + no-reply rule), loader count-difference reason flagged, unload/returns with stock back + difference flag. Tested end to end on QA trip TRP/261102/0019. Office answers via pending_ask_office + answer_ask_office (permission ask_office:answer); Command Center screen still to build.
- [ ] 3. Security extras (entry/exit/parcels/problem/register/change guard/material pass)
- [ ] 4. Offline queue + final full test

## QA clean-up list (all labelled QA-TEST)
- Orders MFO/26-27/00001, 00002 (approved, cannot be cancelled), 00003–00009
- Trips TRP/261102/0019, TRP/261102/0020; vehicle QA-MH24-0001
- Credit note MFCN/26-27/00001 (pending, QA)

## Open
- [x] App icon swap — icons copied into assets
- [x] Part 3 Security extras — home redesign, Entry (types, parcels), Exit, Problem, Register, Change guard, Material pass scan done

## Part 3 — Security extras
- [x] 1. Entry + Inside-now exit list (+91 search, STAFF tag) — tested as QA Loader
- [x] 2. Parcels + Problem
- [x] 3. Register with filters + Change guard (PIN + selfie)
- [x] 4. Material pass scan (needs one QA test pass)

## Prompt-6 — v3 simple rework (driver, loader, guard, photos)
- [ ] Part 1 Driver incl. Payment — done: Hindi default, one-tap goods, big amount + mode buttons, order mode pre-picked, old dues + Add, UPI ref optional, Split (cash+UPI), 4-box OTP, auto-open next stop after payment. Left: Udhaar, Map/Call card (needs customer phone), challan PDF, stop-removed alert
- [x] Part 2 Loader (All loaded / All received, change count + reason, stop-removed alert) — chain tapped on TRP/261104/0027, settled ₹340
- [x] Part 3 Guard (SCAN, Entry, Exit, Vehicles out, menu Problem/Change guard; remove register screen) — tapped with QA Loader, 72-screen sweep clean
- [x] Part 4 Photos compression + expiry, 2 am IST clean-up job, backup list/ZIP, 7-day notice, offline chip
- [ ] Full QA tap test at 360/390/412 × HI/MR/EN, one Pass/Fixed/Fail table

## Nov 16 Home and Profile cleanup (no SQL)
- [x] Unified role cards and live existing-data counts; per-user last-role selection and explicit chooser from Profile.
- [x] Single profile card, full role list, language segments, app info and confirmed sign-out.
- [x] Real QA Driver sign-in opens /driver directly; Profile/chooser at 360/390/412, saved-role return, sign-out cancel/confirm passed; 24 tests passed and compilation clean. Publishing requested after checks. Multi-role live account not exercised; selection policy covered by tests.
