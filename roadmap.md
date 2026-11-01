# Roadmap — Sunrich Delivery (Prompt-3.txt)

Source brief: user-uploads Prompt-3.txt. All stages complete.

## Stage 1 — Rename Sunrich Team → Sunrich Delivery
- [x] capacitor.config.ts: appId com.sunrich.delivery, name, live URL, allowNavigation, UA branding
- [x] scripts/patch-android.mjs: app text, package, deep-link host
- [x] docs/APK.md: new package, folder, Firebase file copy target (android/app/google-services.json)
- [x] public/manifest.webmanifest + route head metadata across all routes
- [x] l10n: EN/HI/MR app names (सनरिच डिलीवरी / सनरिच डिलिव्हरी), labels, मरा chip
- [x] native.ts: push agent detect, deep-link scheme, p_app "delivery" (no DB constraint exists), navy status bar

## Stage 2 — Customer-app-style login
- [x] 55–60% navy hero, soft bubbles, centered logo + tagline, top-right EN/हिं/मरा pill
- [x] White rounded sheet, consistent mobile/PIN/OTP presentation, progress line
- [x] Fixed 100dvh frame; keyboard-safe layout

## Stage 3 — Phone fit
- [x] Screen shell: 100dvh, internal scrolling content, safe-area padding
- [x] styles.css: no page scroll/bounce; auth home 100dvh fallback
- [x] Sweep 360/390/412 × EN/HI/MR per role: 78 geometry checks, 0 fails

## Fixed during QA
- [x] Language choice never saved: `void supabase.rpc(...)` is a no-op in supabase-js v2
      (builders only execute when awaited/then'd). Fixed in __root.tsx (update_my_profile)
      and native.ts (save_my_push_token). Verified: DB keeps the chosen language and
      authenticated screens render in it after reload.

## Known, out of scope
- staffOtpLogin (mobile-only magic-link mint) still exists server-side — security follow-up
  outside Prompt-3's visual/rename scope.
- vehicle_check_items come from the DB in English; translating them is a data/localization
  decision, not part of this brief.
