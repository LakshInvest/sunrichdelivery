# Build the Sunrich Team APK (Windows)

The APK is a "live-site" app: it opens https://sunrichteam.lovable.app, so new features
appear automatically. Rebuild only to change the version number.

## 1. Install once
- Git: https://git-scm.com/download/win
- Node.js 20 LTS or newer: https://nodejs.org
- Android Studio (latest): https://developer.android.com/studio — on first launch let it
  install the Android SDK. It also brings the Java (JDK 17+) it needs.

## 2. Get the code
Open **Command Prompt** and run:
```
cd %USERPROFILE%\Documents
git clone <your GitHub repo URL> sunrich-team
cd sunrich-team
npm install
```

## 3. Create the Android project (first time only)
```
npx cap add android
npm run android:patch
```
`android:patch` adds permissions with plain-language reasons, the "Trip in progress"
background location service, deep links, notification icon and the push guard.

## 4. Push notifications (optional)
1. In Firebase console, add an Android app with package name `com.sunrich.team`.
2. Download `google-services.json` and copy it to:
   `sunrich-team\android\app\google-services.json`

Without this file the app still builds and runs; it just skips push registration
(the console shows "push skipped").

## 4b. App icon + splash (first time only)
```
npx @capacitor/assets generate --android --iconBackgroundColor "#0D3278" --splashBackgroundColor "#0D3278" --iconBackgroundColorDark "#0D3278" --splashBackgroundColorDark "#0D3278"
```
This reads `resources/icon.png` and `resources/splash.png` (Sunrich brand files) and
writes every launcher icon density plus the adaptive icon (navy background).

## 5. Sync
```
npx cap sync android
npm run android:patch
```
Run both again any time you add/replace `google-services.json` or update packages.

## 6. Build the APK
```
npx cap open android
```
In Android Studio wait for "Gradle sync" to finish, then:
**Build → Build App Bundle(s) / APK(s) → Build APK(s)**.

The APK lands at:
`sunrich-team\android\app\build\outputs\apk\debug\app-debug.apk`
(Android Studio shows a "locate" link when done.)

For a Play Store / signed release: **Build → Generate Signed App Bundle / APK**, create a
keystore (keep it safe forever), choose *release*. Output:
`android\app\build\outputs\apk\release\app-release.apk` (or `bundle\release\*.aab`).

## 7. Install on a phone
- Copy the APK to the phone (USB, WhatsApp to self, Google Drive) and tap it.
- Allow "Install unknown apps" for the app you opened it from when asked.
- Or with USB debugging on: `adb install -r android\app\build\outputs\apk\debug\app-debug.apk`

On first use allow Camera, Location ("Allow all the time" for trips — used only during an
active trip) and Notifications.

## Version bump
Edit `android\app\build.gradle` → `versionCode` (+1) and `versionName`, then repeat step 6.

## Included native features
Push (FCM, saved with `save_my_push_token`, app `team`, tap opens the trip/screen), local
notifications (channels "Trips" and "Alerts"), GPS, background location during active trips
only, QR scanning (gate / pickup pass), camera, offline photo storage, keep screen on during
trips, splash screen, status bar, back button + deep links (`com.sunrich.team://driver/<id>`
and `https://sunrichteam.lovable.app/...`), in-app browser, share, network status,
preferences, keyboard and haptics. In a normal browser every feature falls back to web behaviour.
