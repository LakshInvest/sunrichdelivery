# Android setup (Sunrich Team)

The app is a PWA-style React app. To ship it on Android, wrap it with Capacitor:

1. `npm i @capacitor/core @capacitor/cli @capacitor/android`
2. `npx cap init "Sunrich Team" com.sunrich.team --web-dir=dist`
3. Point the app at the published URL (keep the backend and auth the same):
   - In `capacitor.config.ts` set `server: { url: "https://sunrichteam.lovable.app", cleartext: false }`.
4. `npx cap add android` then `npx cap sync`
5. Icons/splash: replace `android/app/src/main/res/*` icons (512×512 logo).
6. Build: `npx cap open android` → build an APK/AAB in Android Studio
   (or `cd android && ./gradlew assembleRelease`).
7. Play Store: needs a signing key, privacy policy, and the camera + location
   permissions declared in `AndroidManifest.xml` (the app already requests them
   in the browser via standard Web APIs).

Supabase dashboard: add `https://sunrichteam.lovable.app` and any deep-link
scheme you use under Authentication → URL Configuration → Redirect URLs.

Notes:
- Photos use `<input type=file capture>` — works in the Android WebView.
- Location uses `navigator.geolocation` — fine on Android; Play Store reviews
  background-location use strictly, so keep location tracking foreground-only.
- The offline queue stores queued RPCs in localStorage and replays them on
  reconnect (tested in QA).
