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
  if (!data) return null;
  return { login_image_url: data.login_image_url, app_logo_url: data.app_logo_url, login_show_logo: data.login_show_logo };
});