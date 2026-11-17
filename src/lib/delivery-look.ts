import { useEffect, useState } from "react";
import { publicLoginAppearance } from "@/lib/login-appearance.functions";

/** Delivery "App ka look" from Command Center (app_appearance, app = delivery), cached for before sign-in and offline. */
export type DeliveryLook = Partial<Record<(typeof LOOK_TEXT_KEYS)[number], string>> & Partial<Record<(typeof LOOK_FLAG_KEYS)[number], boolean>>;
export const LOOK_TEXT_KEYS = [
  "login_image_url", "launch_image_url", "logo_url",
  "login_tagline", "login_tagline_hi", "login_tagline_mr",
  "launch_text", "launch_text_hi", "launch_text_mr",
  "pin_title", "pin_title_hi", "pin_title_mr",
  "otp_title", "otp_title_hi", "otp_title_mr",
] as const;
export const LOOK_FLAG_KEYS = ["launch_show_logo", "launch_show_tagline", "login_show_logo", "login_show_tagline"] as const;
export const LOOK_KEY = "sunrich_delivery_look_v1";

/** Keep only known public branding fields with the right types. */
export function cleanLook(raw: unknown): DeliveryLook {
  const out: Record<string, string | boolean> = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  for (const k of LOOK_TEXT_KEYS) { const v = r[k]; if (typeof v === "string" && v.trim()) out[k] = v.trim(); }
  for (const k of LOOK_FLAG_KEYS) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  return out as DeliveryLook;
}

/** Text in the chosen language, falling back to the base (English) value, then the app default. */
export function lookText(look: DeliveryLook, base: "login_tagline" | "launch_text" | "pin_title" | "otp_title", lang: string, fallback: string): string {
  const k = (lang === "hi" || lang === "mr" ? `${base}_${lang}` : base) as keyof DeliveryLook;
  return (look[k] as string | undefined) || (look[base] as string | undefined) || fallback;
}

export function readCachedLook(): DeliveryLook {
  try { return cleanLook(JSON.parse(localStorage.getItem(LOOK_KEY) ?? "null")); } catch { return {}; }
}

let inflight: Promise<DeliveryLook | null> | null = null;
export function useDeliveryLook(): DeliveryLook {
  const [look, setLook] = useState<DeliveryLook>({});
  useEffect(() => {
    let active = true;
    setLook(readCachedLook());
    inflight ??= publicLoginAppearance().then((d) => d ? cleanLook(d.look) : null).catch(() => null);
    void inflight.then((v) => {
      if (!v) return;
      try { localStorage.setItem(LOOK_KEY, JSON.stringify(v)); } catch { /* optional */ }
      if (active) setLook(v);
    });
    return () => { active = false; };
  }, []);
  return look;
}
