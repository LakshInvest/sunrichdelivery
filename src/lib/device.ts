// Stable per-device identifier used for PIN login device trust.
const KEY = "sunrich_device_id";
const LABEL_KEY = "sunrich_device_label";

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = randomId();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

/**
 * Sync the trusted-device id with durable storage (@capacitor/preferences on
 * the APK) so it survives restarts and WebView storage clears. Durable copy wins.
 */
export async function initDeviceId(): Promise<string> {
  if (typeof window === "undefined") return "server";
  const { prefs } = await import("@/lib/native");
  const durable = await prefs.get(KEY).catch(() => null);
  if (durable) {
    window.localStorage.setItem(KEY, durable);
    return durable;
  }
  const id = getDeviceId();
  await prefs.set(KEY, id).catch(() => {});
  return id;
}

export function getDeviceLabel(): string {
  if (typeof window === "undefined") return "Server";
  let label = window.localStorage.getItem(LABEL_KEY);
  if (!label) {
    const ua = navigator.userAgent;
    const os = /Android/i.test(ua)
      ? "Android"
      : /iPhone|iPad/i.test(ua)
        ? "iOS"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Device";
    const browser = /Edg\//i.test(ua)
      ? "Edge"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Firefox\//i.test(ua)
          ? "Firefox"
          : /Safari\//i.test(ua)
            ? "Safari"
            : "Browser";
    label = `${browser} · ${os}`;
    window.localStorage.setItem(LABEL_KEY, label);
  }
  return label;
}
