# Sunrich Team app — build roadmap

QA accounts: driver +919999900013, loader/security +919999900014, PIN 1234 (PINs verified).
Languages: en, hi, mr (delivery_settings.default_language = mr).

- [x] Stage 0 — backend reconnaissance (RPC signatures, tables, QA data, roles, buckets)
- [x] Stage 1 — login (mobile + PIN), i18n (en/hi/mr), role home screens — tested
- [x] Stage 2 — loader screens (record loading, finalize → gate pass) + security gate (gate out, gate in, gate log, pending-stops guard) — tested
- [x] Stage 3 — driver screens (start+vehicle check, deliver+OTP, collection, end trip) — E2E tested loader→security→driver→security
- [x] Stage 4 — offline queue replay test (loader finalize offline → replayed), Android build notes (docs/android-setup.md)
- [ ] Final — report delivered in chat; office cash settlement (settle_trip) not yet browser-tested
