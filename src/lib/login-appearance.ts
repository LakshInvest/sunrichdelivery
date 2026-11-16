import { useEffect, useState } from "react";
import { publicLoginAppearance } from "@/lib/login-appearance.functions";
import defaultPhoto from "@/assets/sunrich-launch-default.webp.asset.json";
import currentPhoto from "@/assets/sunrich-login-photo.webp.asset.json";
import whiteLogo from "@/assets/sunrich-logo-white.png.asset.json";
import type { Lang } from "@/lib/l10n";

const SETTINGS_KEY = "sunrich_login_appearance_v1";
const IMAGE_CACHE = "sunrich-login-images-v1";
export const DEFAULT_LOGIN_PHOTO_URL = "https://user.sunrich.in/launch-default.webp";
const currentSource = "https://nxlmiovntfdsunqydrqd.supabase.co/storage/v1/object/public/catalogue/app/f1f6eed4-d1fe-49f3-9252-3ad5d9dd1278.webp";
type Appearance = { photo: string; logo: string; showLogo: boolean };
const initial: Appearance = { photo: currentPhoto.url, logo: whiteLogo.url, showLogo: true };

export function phoneLoginLanguage(languages: readonly string[]): Lang {
  for (const language of languages) {
    const base = language.toLowerCase().split(/[-_]/)[0];
    if (base === "en" || base === "hi" || base === "mr") return base;
  }
  return "hi";
}

export function useLoginAppearance() {
  const [appearance, setAppearance] = useState(initial);
  useEffect(() => {
    let active = true;
    const objects: string[] = [];
    const display = async (value: Appearance) => {
      if (!active) return;
      setAppearance(value);
      try {
        const cache = await caches.open(IMAGE_CACHE);
        for (const key of ["photo", "logo"] as const) {
          const url = new URL(value[key], window.location.origin).href;
          let response = await cache.match(url);
          if (!response) {
            response = await fetch(url);
            if (!response.ok) continue;
            await cache.put(url, response.clone());
          }
          const local = URL.createObjectURL(await response.blob());
          objects.push(local);
          if (active) setAppearance((current) => current[key] === value[key] ? { ...current, [key]: local } : current);
        }
      } catch { /* Ordinary HTTP caching still works when Cache Storage is unavailable. */ }
    };
    try {
      const cached: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
      if (cached && typeof cached === "object" && "photo" in cached && "logo" in cached && "showLogo" in cached && typeof cached.photo === "string" && typeof cached.logo === "string" && typeof cached.showLogo === "boolean") {
        void display({ photo: cached.photo, logo: cached.logo, showLogo: cached.showLogo });
      } else void display(initial);
    } catch { void display(initial); }
    void publicLoginAppearance().then((data) => {
      if (!data || !active) return;
      const source = data.login_image_url?.trim();
      const value: Appearance = {
        photo: !source || source === DEFAULT_LOGIN_PHOTO_URL ? defaultPhoto.url : source === currentSource ? currentPhoto.url : source,
        logo: data.app_logo_url?.trim() || whiteLogo.url,
        showLogo: data.login_show_logo !== false,
      };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch { /* Optional cache. */ }
      void display(value);
    }).catch(() => { /* Cached branding remains available during a network failure. */ });
    return () => { active = false; objects.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);
  return { ...appearance, fallbackPhoto: defaultPhoto.url, fallbackLogo: whiteLogo.url };
}