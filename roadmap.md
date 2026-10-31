# Roadmap — Sunrich Team branding + new login + design overhaul (Prompt-2.txt)

Source brief: user-uploads Prompt-2.txt. Brand: navy #0D3278, aqua #0AAAED, bg #F4F7FB.
Fonts: Plus Jakarta Sans (headings), Inter (body). QA: 9999900013 / 9999900014, PIN 1234.

## Stage A — Brand (Part 1)
- [x] Compute oklch tokens for navy/aqua/light-blue-grey; rewrite src/styles.css
- [x] Favicon from sunrich-favicon-512.png in public/ (rm favicon.ico)
- [x] PWA manifest + icons (192/512), apple-touch-icon
- [x] Logos via lovable-assets pointers (navy + white), used in login/home
- [x] App icon + splash real files for Capacitor (resources/), config + docs updated
- [x] Fonts Plus Jakarta Sans + Inter via <link> in __root; tabular numbers

## Stage B — New login (Part 2)
- [x] Server fn checkDeviceStatus (registered / hasPin / trusted / skipOtp)
- [x] Login: navy full-screen, waves + bubbles, white logo, tagline from public_app_info() in chosen language
- [x] White bottom-sheet card (28px top corners), language pills EN · हिं · मरा
- [x] Mobile step: +91 fixed, auto-format "98765 43210", WhatsApp-icon button at 10 digits, "🔒 Secure login"
- [x] PIN step for trusted device + PIN set ("Welcome back, name 👋"), 4 water-fill boxes, auto-continue, shake on wrong
- [x] OTP step for new device / no PIN / forgot PIN / 5 wrong PINs: 6 water-fill boxes, auto-advance, paste, clipboard offer, resend ring
- [x] Bottle-filling loader, slide transitions with progress line, light motion 150-400ms
- [x] Device id kept on logout; last mobile remembered

## Stage C — Every screen (Part 3)
- [x] Shared ui.tsx: new tokens, sticky bottom action bar (min 56px), steppers (−/+), big numbers, haptic feedback, offline badge
- [x] Home: big role tiles + role switcher + profile corner
- [x] Driver: trips list, start trip, stop list, stop screen (deliver lines, proof, collection cash/UPI/cheque, empties), failed delivery, extras, SOS, end trip, handover summary
- [x] Loader: loading list, counts with steppers, photo, loading done / finalize
- [x] Security: big "Scan gate pass" button, gate out/in, pickup handover, gate log
- [x] Profile / language / logout

## Stage D — Google Maps (Part 4)
- [x] Server fn exposes GOOGLE_MAPS_API_KEY to the browser (no VITE_ var)
- [x] Stop map component (numbered stops coloured by status, current position, route line)
- [x] Navigate button opens Google Maps navigation for next stop
- [x] Map shown on driver trip screen

## Stage E — Verification + report
- [x] Self-audit of every screen per role (before screenshots)
- [x] Responsive + language sweep 360/390/768 × EN/HI/MR per role
- [x] Final report: audit, what changed per screen, Pass/Fixed/Fail, SQL needed

## Notes
- No SQL migration needed so far (all client-side + existing RPCs; check_pin/user_devices/public_app_info already in DB).
- public_app_info() is SECURITY DEFINER granted to anon — call it from the browser client.
- QA staff are login_without_otp=true → OTP step only appears for real accounts / no PIN / locked.
- OTP "delivery" stays as today: magic-link OTP minted server-side and auto-verified (no WhatsApp send exists in this backend).
