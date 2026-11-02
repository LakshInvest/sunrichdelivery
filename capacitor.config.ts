import { existsSync } from "node:fs";
import type { CapacitorConfig } from "@capacitor/cli";

// Live-site APK: the app loads the published website, so feature updates never need a rebuild.
const LIVE_URL = "https://delivery.sunrich.in";

// Push only turns on when Firebase config is bundled; otherwise the app skips registration
// instead of crashing. Re-run `npx cap sync android` after adding google-services.json.
const hasFirebase = existsSync("android/app/google-services.json");

const config: CapacitorConfig = {
  appId: "com.sunrich.delivery",
  appName: "Sunrich Delivery",
  webDir: "public",
  appendUserAgent: `SunrichDelivery/1 push=${hasFirebase ? "on" : "off"}`,
  server: {
    url: LIVE_URL,
    cleartext: false,
    androidScheme: "https",
    allowNavigation: [
      "delivery.sunrich.in",
      "sunrich-delivery.lovable.app",
      "nxlmiovntfdsunqydrqd.supabase.co",
      "*.supabase.co",
      "maps.google.com",
      "www.google.com",
      "*.google.com",
      "maps.googleapis.com",
      "*.googleapis.com",
      "maps.gstatic.com",
      "*.gstatic.com",
    ],
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: "#0D3278",
      showSpinner: false,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    LocalNotifications: {
      smallIcon: "ic_stat_sunrich",
      iconColor: "#E0A526",
    },
    Keyboard: {
      resize: "body",
    },
  },
};

export default config;
