import { createServerFn } from "@tanstack/react-start";

/** Public login branding only. Never select or return other app_settings fields. */
export const publicLoginAppearance = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("app_settings")
    .select("login_image_url, app_logo_url, login_show_logo").limit(1).maybeSingle();
  if (error) {
    console.error("[publicLoginAppearance] appearance read failed", error.message);
    return null;
  }
  // Delivery "App ka look" from Command Center; only whitelisted public branding fields leave the server.
  const { cleanLook } = await import("@/lib/delivery-look");
  const look = await supabaseAdmin.from("app_appearance").select("settings").eq("app", "delivery").limit(1).maybeSingle();
  if (look.error) console.error("[publicLoginAppearance] delivery look read failed", look.error.message);
  const cleaned = cleanLook(look.data?.settings);
  if (!data) return { login_image_url: null, app_logo_url: null, login_show_logo: true, look: cleaned };
  return { login_image_url: data.login_image_url, app_logo_url: data.app_logo_url, login_show_logo: data.login_show_logo, look: cleaned };
});