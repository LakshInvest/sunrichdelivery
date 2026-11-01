// Native (Capacitor) bridge for the Android "live-site" APK.
// Every function is safe in a normal browser: it no-ops or falls back to web APIs.
// Plugins are loaded with dynamic imports so SSR never evaluates them.
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/device";

type CapGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };

export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapGlobal }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** Set at `npx cap sync` time by capacitor.config.ts when google-services.json exists. */
export function pushConfigured(): boolean {
  return typeof navigator !== "undefined" && /SunrichTeam\/\S+ push=on/.test(navigator.userAgent);
}

let initialised = false;
let navigateFn: ((path: string) => void) | null = null;

function routeFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // com.sunrich.delivery://driver/abc  → host "driver", path "/abc"
    if (u.protocol === "com.sunrich.delivery:") return `/${u.host}${u.pathname}`.replace(/\/+$/, "") || "/";
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return null;
  }
}

function go(path: string | null | undefined) {
  if (!path || !path.startsWith("/")) return;
  if (navigateFn) navigateFn(path);
  else window.location.assign(path);
}

/** One-time native setup: status bar, splash, back button, deep links, keyboard, notification channels. */
export async function initNative(navigate: (path: string) => void) {
  navigateFn = navigate;
  if (!isNative() || initialised) return;
  initialised = true;
  try {
    const [{ StatusBar, Style }, { SplashScreen }, { App }, { Keyboard }, { LocalNotifications }] = await Promise.all([
      import("@capacitor/status-bar"),
      import("@capacitor/splash-screen"),
      import("@capacitor/app"),
      import("@capacitor/keyboard"),
      import("@capacitor/local-notifications"),
    ]);
    void StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    void StatusBar.setBackgroundColor({ color: "#0D3278" }).catch(() => {});
    void SplashScreen.hide().catch(() => {});
    void Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});

    void App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void App.minimizeApp();
    });
    void App.addListener("appUrlOpen", ({ url }) => go(routeFromUrl(url)));

    await LocalNotifications.createChannel({ id: "trips", name: "Trips", importance: 4, visibility: 1 }).catch(() => {});
    await LocalNotifications.createChannel({ id: "alerts", name: "Alerts", importance: 5, visibility: 1, vibration: true }).catch(() => {});
    void LocalNotifications.addListener("localNotificationActionPerformed", (e) =>
      go((e.notification.extra as { route?: string } | undefined)?.route),
    );
  } catch (e) {
    console.warn("[native] init failed", e);
  }
}

let pushRegistered = false;

/** Register for FCM and save the token. Skipped (with a log) when google-services.json was not bundled. */
export async function registerPush(language: string) {
  if (!isNative() || pushRegistered) return;
  if (!pushConfigured()) {
    console.info("[native] push skipped: google-services.json not bundled in this build");
    return;
  }
  pushRegistered = true;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") perm = await PushNotifications.requestPermissions();
    if (perm.receive !== "granted") return;
    await PushNotifications.addListener("registration", ({ value }) => {
      void supabase
        .rpc("save_my_push_token", {
          p_token: value,
          p_device_id: getDeviceId(),
          p_platform: "android",
          p_app: "delivery",
          p_language: language,
        })
        .then(({ error }) => {
          if (error) console.warn("[native] save push token failed", error.message);
        });
    });
    await PushNotifications.addListener("registrationError", (err) => console.warn("[native] push registration error", err));
    await PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
      const d = (a.notification.data ?? {}) as { route?: string; trip_id?: string };
      go(d.route ?? (d.trip_id ? `/driver/${d.trip_id}` : "/"));
    });
    await PushNotifications.register();
  } catch (e) {
    pushRegistered = false;
    console.warn("[native] push setup failed", e);
  }
}

type BgGeo = {
  addWatcher: (
    opts: { backgroundMessage?: string; backgroundTitle?: string; requestPermissions?: boolean; stale?: boolean; distanceFilter?: number },
    cb: (loc?: { latitude: number; longitude: number }, err?: { code?: string }) => void,
  ) => Promise<string>;
  removeWatcher: (o: { id: string }) => Promise<void>;
};

/**
 * Active-trip mode: keeps the screen on and tracks location in the background with a
 * "Trip in progress" foreground notification. Returns a stop function, or null in a browser
 * (caller then uses its own foreground timer).
 */
export async function startTripMode(
  intervalMs: number,
  onLocation: (c: { latitude: number; longitude: number }) => void,
): Promise<(() => void) | null> {
  if (!isNative()) return null;
  try {
    const [{ registerPlugin }, { KeepAwake }] = await Promise.all([
      import("@capacitor/core"),
      import("@capacitor-community/keep-awake"),
    ]);
    void KeepAwake.keepAwake().catch(() => {});
    const Bg = registerPlugin<BgGeo>("BackgroundGeolocation");
    let last = 0;
    const id = await Bg.addWatcher(
      {
        backgroundTitle: "Trip in progress",
        backgroundMessage: "Sunrich Delivery is sharing your location for this trip only.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      (loc) => {
        if (!loc) return;
        const now = Date.now();
        if (now - last < intervalMs - 2000) return;
        last = now;
        onLocation({ latitude: loc.latitude, longitude: loc.longitude });
      },
    );
    return () => {
      void Bg.removeWatcher({ id }).catch(() => {});
      void KeepAwake.allowSleep().catch(() => {});
    };
  } catch (e) {
    console.warn("[native] trip mode failed", e);
    return null;
  }
}

/** Current position: native GPS plugin in the APK, browser geolocation elsewhere. */
export async function nativeCoords(): Promise<{ latitude: number; longitude: number } | null> {
  if (!isNative()) return null;
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const p = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    return { latitude: p.coords.latitude, longitude: p.coords.longitude };
  } catch {
    return null;
  }
}

/** Scan a QR code (gate pass / pickup pass). Returns null in a browser or when cancelled. */
export async function scanQr(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { BarcodeScanner, BarcodeFormat } = await import("@capacitor-mlkit/barcode-scanning");
    const perm = await BarcodeScanner.requestPermissions();
    if (perm.camera !== "granted" && perm.camera !== "limited") return null;
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    return barcodes[0]?.rawValue ?? null;
  } catch (e) {
    console.warn("[native] scan failed", e);
    return null;
  }
}

export async function haptic(kind: "light" | "success" | "error" = "light") {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    if (kind === "light") await Haptics.impact({ style: ImpactStyle.Light });
    else await Haptics.notification({ type: kind === "success" ? NotificationType.Success : NotificationType.Error });
  } catch {
    // ignore
  }
}

/** Open an external link (maps, docs) in the in-app browser, or a new tab on web. */
export async function openExternal(url: string) {
  if (isNative()) {
    try {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url });
      return;
    } catch {
      // fall through
    }
  }
  window.open(url, "_blank", "noopener");
}

export async function shareText(title: string, text: string, url?: string) {
  if (isNative()) {
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title, text, ...(url ? { url } : {}) });
      return true;
    } catch {
      return false;
    }
  }
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title, text, ...(url ? { url } : {}) });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Notify on network changes (native Network plugin, or browser online/offline events). */
export async function onNetworkChange(cb: (online: boolean) => void): Promise<() => void> {
  if (isNative()) {
    try {
      const { Network } = await import("@capacitor/network");
      const h = await Network.addListener("networkStatusChange", (s) => cb(s.connected));
      return () => void h.remove();
    } catch {
      // fall through
    }
  }
  const on = () => cb(true);
  const off = () => cb(false);
  window.addEventListener("online", on);
  window.addEventListener("offline", off);
  return () => {
    window.removeEventListener("online", on);
    window.removeEventListener("offline", off);
  };
}

/** Durable key/value (survives WebView storage clears on Android); localStorage on web. */
export const prefs = {
  async get(key: string): Promise<string | null> {
    if (isNative()) {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        return (await Preferences.get({ key })).value;
      } catch {
        // fall through
      }
    }
    return window.localStorage.getItem(key);
  },
  async set(key: string, value: string) {
    if (isNative()) {
      try {
        const { Preferences } = await import("@capacitor/preferences");
        await Preferences.set({ key, value });
        return;
      } catch {
        // fall through
      }
    }
    window.localStorage.setItem(key, value);
  },
};

/** Save a photo to app storage so it survives offline until upload; returns the file uri or null. */
export async function saveOfflinePhoto(name: string, dataUrl: string): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    const res = await Filesystem.writeFile({
      path: `offline-photos/${name}`,
      data: dataUrl.split(",")[1] ?? dataUrl,
      directory: Directory.Data,
      recursive: true,
    });
    return res.uri;
  } catch {
    return null;
  }
}

export async function deleteOfflinePhoto(name: string) {
  if (!isNative()) return;
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.deleteFile({ path: `offline-photos/${name}`, directory: Directory.Data });
  } catch {
    // ignore
  }
}

/** Take a photo with the native camera; returns a File, or null in a browser (use <input capture>). */
export async function takeNativePhoto(): Promise<File | null> {
  if (!isNative()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const p = await Camera.getPhoto({ resultType: CameraResultType.DataUrl, source: CameraSource.Camera, quality: 70, width: 1600 });
    if (!p.dataUrl) return null;
    const blob = await (await fetch(p.dataUrl)).blob();
    return new File([blob], `photo-${Date.now()}.${p.format || "jpg"}`, { type: blob.type || "image/jpeg" });
  } catch {
    return null;
  }
}

/** Show a local notification on the "alerts" or "trips" channel. */
export async function localNotify(title: string, body: string, opts: { channel?: "trips" | "alerts"; route?: string } = {}) {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== "granted") return;
    await LocalNotifications.schedule({
      notifications: [
        {
          id: Math.floor(Date.now() % 2_000_000_000),
          title,
          body,
          channelId: opts.channel ?? "alerts",
          smallIcon: "ic_stat_sunrich",
          extra: { route: opts.route },
        },
      ],
    });
  } catch {
    // ignore
  }
}
