# Sunrich Team app — build roadmap

QA accounts: driver +919999900013, loader/security +919999900014, PIN 1234 (PINs verified).
Languages: en, hi, mr (delivery_settings.default_language = mr).

- [x] Stage 0 — backend reconnaissance (RPC signatures, tables, QA data, roles, buckets)
- [x] Stage 1 — login (mobile + PIN), i18n (en/hi/mr), role home screens — tested
- [x] Stage 2 — loader screens (record loading, finalize → gate pass) + security gate (gate out, gate in, gate log, pending-stops guard) — tested
- [x] Stage 3 — driver screens (start+vehicle check, deliver+OTP, collection, end trip) — E2E tested loader→security→driver→security
- [x] Stage 4 — offline queue replay test (loader finalize offline → replayed), Android build notes (docs/android-setup.md)
- [x] Phase 2 feature set — short delivery with damaged/refused/empties, signature + photo proof, failed delivery with reason, UPI/cheque/old-dues collections, spot sale, empties pickup, trip expense with bill photo, SOS, live location pings + stop arrivals, extra load, loader finalize gating (dispatch:approve removed from LOADER), customer pickup at gate (gate_pickup_handover) — all verified in /tmp/browser/qa/qa_phase2.py (RESULTS all true; three intentional rejections verified)
- [x] Phase 2 fixes — deliver_stop no longer writes zero-quantity container movements (failed delivery with no empties); ta_type CHECK now allows 'sos'; security pickup tab embed fixed (orders_customer_id_fkey, business_name/contact_name); partial stops show the collection panel; failed stops record delivered 0 / short = qty
- [x] Responsive/language sweep — 360/390/768 × en/hi/mr across driver trip, loader and security screens: clean, no overflow, no page errors
- [ ] Final — report delivered in chat; office cash settlement (settle_trip) not yet browser-tested
