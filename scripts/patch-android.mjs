// Run after `npx cap add android` (and safe to re-run): adds permissions, plain-language
// permission texts, deep links, notification icon/channels and the Firebase guard.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const root = "android/app";
const manifestPath = `${root}/src/main/AndroidManifest.xml`;
if (!existsSync(manifestPath)) {
  console.error("android/ not found. Run `npx cap add android` first.");
  process.exit(1);
}

let m = readFileSync(manifestPath, "utf8");

const perms = [
  ["android.permission.INTERNET", "Needed to load the Sunrich Delivery app and sync your work."],
  ["android.permission.ACCESS_NETWORK_STATE", "Lets the app know when you are offline so work can be saved and sent later."],
  ["android.permission.CAMERA", "Take photos of deliveries, bills, odometer and scan gate pass QR codes."],
  ["android.permission.READ_MEDIA_IMAGES", "Attach a photo you already took."],
  ["android.permission.READ_EXTERNAL_STORAGE\" android:maxSdkVersion=\"32", "Attach a photo you already took (older phones)."],
  ["android.permission.ACCESS_FINE_LOCATION", "Record where each delivery and stop happens."],
  ["android.permission.ACCESS_COARSE_LOCATION", "Record your approximate location at each stop."],
  ["android.permission.ACCESS_BACKGROUND_LOCATION", "Location is shared only during an active trip, even if the screen is off."],
  ["android.permission.FOREGROUND_SERVICE", "Shows a \"Trip in progress\" notification while your trip is active."],
  ["android.permission.FOREGROUND_SERVICE_LOCATION", "Tracks location only during an active trip."],
  ["android.permission.POST_NOTIFICATIONS", "Trip updates, alerts and SOS messages."],
  ["android.permission.WAKE_LOCK", "Keeps the screen on during an active trip."],
  ["android.permission.VIBRATE", "Short vibrations to confirm actions."],
];

for (const [name, why] of perms) {
  const bare = name.split('"')[0];
  if (m.includes(`"${bare}"`)) continue;
  m = m.replace(
    /<\/manifest>\s*$/,
    `    <!-- ${why} -->\n    <uses-permission android:name="${name}" />\n</manifest>\n`,
  );
}

if (!m.includes('android:name="android.hardware.camera"')) {
  m = m.replace(/<\/manifest>\s*$/, `    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>\n`);
}

// Deep links: com.sunrich.delivery://... and https://sunrich-delivery.lovable.app/...
if (!m.includes('android:scheme="com.sunrich.delivery"')) {
  m = m.replace(
    /(<activity[\s\S]*?MainActivity[\s\S]*?>)/,
    `$1
            <intent-filter android:autoVerify="true">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="https" android:host="sunrich-delivery.lovable.app" />
            </intent-filter>
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="com.sunrich.delivery" />
            </intent-filter>`,
  );
}

// Push defaults: notification icon + default channel.
if (!m.includes("default_notification_icon")) {
  m = m.replace(
    /(<application[^>]*>)/,
    `$1
        <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_sunrich" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="alerts" />`,
  );
}

// Background location foreground service type (Android 14+).
if (!m.includes("foregroundServiceType")) {
  m = m.replace(
    /(<\/application>)/,
    `    <service android:name="com.equimaps.capacitor_background_geolocation.BackgroundGeolocationService" android:enabled="true" android:exported="false" android:foregroundServiceType="location" />\n    $1`,
  );
}
writeFileSync(manifestPath, m);

// Notification icon (white, simple vector).
const drawable = `${root}/src/main/res/drawable`;
mkdirSync(drawable, { recursive: true });
writeFileSync(
  `${drawable}/ic_stat_sunrich.xml`,
  `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,7a5,5 0,1 0,0 10a5,5 0,1 0,0 -10zM11,1h2v3h-2zM11,20h2v3h-2zM1,11h3v2H1zM20,11h3v2h-3zM4.2,5.6l1.4,-1.4 2.1,2.1 -1.4,1.4zM16.3,17.7l1.4,-1.4 2.1,2.1 -1.4,1.4zM4.2,18.4l2.1,-2.1 1.4,1.4 -2.1,2.1zM16.3,6.3l2.1,-2.1 1.4,1.4 -2.1,2.1z"/>
</vector>
`,
);

// Firebase guard: apply google-services only when the file exists (build never fails without it).
const gradlePath = `${root}/build.gradle`;
if (existsSync(gradlePath)) {
  let g = readFileSync(gradlePath, "utf8");
  if (!g.includes("google-services.json") && !g.includes("com.google.gms.google-services")) {
    g += `\n// Push needs google-services.json; skip the plugin when it is missing.\nif (file('google-services.json').exists()) { apply plugin: 'com.google.gms.google-services' }\n`;
    writeFileSync(gradlePath, g);
  }
}

console.log("Android project patched for Sunrich Delivery.");
