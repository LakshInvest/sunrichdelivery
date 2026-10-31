// Mobile + PIN login. Runs server-side: check_pin is not callable by anonymous
// clients, so PIN verification and the session-minting link happen here.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type LoginInput = { mobile: string; pin: string; deviceId: string; deviceLabel?: string };

export type StaffLoginResult =
  | { ok: true; method: "email" | "sms"; email?: string; phone?: string; token: string; staff: StaffBrief }
  | { ok: false; code: string; attemptsLeft?: number };

export type StaffBrief = {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  preferredLanguage: string;
  unitId: string | null;
  firmId: string | null;
};

const PIN_RESULT_CODES: Record<string, string> = {
  not_registered: "not_registered",
  wrong_pin: "wrong_pin",
  locked: "locked",
  device_not_trusted: "device_not_trusted",
};

export const staffLogin = createServerFn({ method: "POST" })
  .inputValidator((input: LoginInput) => input)
  .handler(async ({ data }): Promise<StaffLoginResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Accept 10-digit national numbers or +91-prefixed ones; store as +91XXXXXXXXXX.
    const digits = String(data.mobile || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^\d{10}$/.test(digits) || !/^[6-9]/.test(digits)) {
      return { ok: false, code: "invalid_mobile" };
    }
    const mobile = `+91${digits}`;
    const pin = String(data.pin || "").trim();
    const deviceId = String(data.deviceId || "").slice(0, 64) || "unknown-device";

    const { data: pinRows, error: pinError } = await supabaseAdmin.rpc("check_pin", {
      p_mobile: mobile,
      p_device_id: deviceId,
      p_pin: pin,
      p_user_type: "staff",
    });
    const row = Array.isArray(pinRows) ? pinRows[0] : undefined;
    if (pinError) {
      console.error("[staffLogin] check_pin failed", pinError.message);
      return { ok: false, code: "login_failed" };
    }
    if (!row?.out_user_id) {
      const raw = String(row?.out_result ?? "not_registered");
      if (raw.startsWith("wrong_pin")) {
        const left = Number(raw.split(":")[1]);
        if (Number.isFinite(left)) return { ok: false, code: "wrong_pin", attemptsLeft: left };
        return { ok: false, code: "wrong_pin" };
      }
      return { ok: false, code: PIN_RESULT_CODES[raw] ?? raw };
    }

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, mobile, email, preferred_language, user_type, unit_id, firm_id, is_active")
      .eq("id", String(row.out_user_id))
      .single();
    if (profileError || !profile) {
      console.error("[staffLogin] profile read failed", profileError?.message);
      return { ok: false, code: "login_failed" };
    }
    if (profile.is_active === false) {
      return { ok: false, code: "inactive" };
    }

    const staff: StaffBrief = {
      id: profile.id,
      fullName: profile.full_name ?? "",
      mobile: profile.mobile ?? mobile,
      email: profile.email ?? null,
      preferredLanguage: profile.preferred_language ?? "en",
      unitId: profile.unit_id ?? null,
      firmId: profile.firm_id ?? null,
    };

    // Mint a Supabase session for this staff member. Auth users carry a
    // confirmed synthetic email, so the magic-link OTP is returned here for the
    // app to verify immediately (no real mailbox involved).
    const email = staff.email?.trim() || null;
    if (email) {
      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      if (error || !link) {
        console.error("[staffLogin] generateLink failed", error?.message);
        return { ok: false, code: "login_failed" };
      }
      const token = link.properties?.email_otp ?? "";
      if (!token) return { ok: false, code: "login_failed" };
      return { ok: true, method: "email", email, token, staff };
    }

    // All staff accounts carry a confirmed synthetic email (created at setup),
    // so the email magic-link path above always applies. Phone-only fallback is
    // intentionally not supported by the admin link API.
    return { ok: false, code: "login_failed" };
  });

/**
 * What the login screen should show for this mobile + device: the PIN step
 * (trusted device / PIN-exempt staff) or the OTP step (new device, no PIN set).
 * Read-only; reveals only the first name.
 */
export type DeviceStatus = {
  registered: boolean;
  firstName: string | null;
  hasPin: boolean;
  trusted: boolean;
  skipOtp: boolean;
};

export const checkDeviceStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { mobile: string; deviceId: string }) => input)
  .handler(async ({ data }): Promise<DeviceStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const digits = String(data.mobile || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^\d{10}$/.test(digits) || !/^[6-9]/.test(digits)) {
      return { registered: false, firstName: null, hasPin: false, trusted: false, skipOtp: false };
    }
    const mobile = `+91${digits}`;
    const { data: p } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, is_active, login_without_otp, is_demo")
      .eq("mobile", mobile)
      .eq("user_type", "staff")
      .maybeSingle();
    if (!p || p.is_active === false) {
      return { registered: false, firstName: null, hasPin: false, trusted: false, skipOtp: false };
    }
    const [pinRes, devRes] = await Promise.all([
      supabaseAdmin.from("user_pins").select("user_id").eq("user_id", String(p.id)).maybeSingle(),
      supabaseAdmin
        .from("user_devices")
        .select("id")
        .eq("user_id", String(p.id))
        .eq("device_id", String(data.deviceId || "").slice(0, 64))
        .is("revoked_at", null)
        .maybeSingle(),
    ]);
    return {
      registered: true,
      firstName: String(p.full_name ?? "").split(" ")[0] || null,
      hasPin: !!pinRes.data,
      trusted: !!devRes.data,
      skipOtp: !!(p.login_without_otp || p.is_demo),
    };
  });

/**
 * OTP-path sign-in: mints the magic-link OTP for the staff member after the
 * mobile is confirmed registered. Used when the device is new, no PIN is set,
 * the PIN was forgotten, or five wrong PINs locked the device.
 */
export type StaffOtpResult =
  | { ok: true; email: string; token: string; staff: StaffBrief }
  | { ok: false; code: string };

export const staffOtpLogin = createServerFn({ method: "POST" })
  .inputValidator((input: { mobile: string }) => input)
  .handler(async ({ data }): Promise<StaffOtpResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const digits = String(data.mobile || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^\d{10}$/.test(digits) || !/^[6-9]/.test(digits)) {
      return { ok: false, code: "invalid_mobile" };
    }
    const mobile = `+91${digits}`;
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, mobile, email, preferred_language, unit_id, firm_id, is_active")
      .eq("mobile", mobile)
      .eq("user_type", "staff")
      .maybeSingle();
    if (!profile || profile.is_active === false) return { ok: false, code: "not_registered" };
    const email = String(profile.email ?? "").trim();
    if (!email) return { ok: false, code: "login_failed" };
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (error || !link) {
      console.error("[staffOtpLogin] generateLink failed", error?.message);
      return { ok: false, code: "login_failed" };
    }
    const token = link.properties?.email_otp ?? "";
    if (!token) return { ok: false, code: "login_failed" };
    return {
      ok: true,
      email,
      token,
      staff: {
        id: profile.id,
        fullName: profile.full_name ?? "",
        mobile: profile.mobile ?? mobile,
        email,
        preferredLanguage: profile.preferred_language ?? "en",
        unitId: profile.unit_id ?? null,
        firmId: profile.firm_id ?? null,
      },
    };
  });

/**
 * Role codes for the signed-in staff member. Roles live in user_roles/roles
 * whose codes are not readable by the user's own token, so this resolves them
 * with the service client after verifying the caller's session.
 */
export const myRoleCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<string[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("user_roles")
      .select("roles(code)")
      .eq("user_id", context.userId);
    if (error) {
      console.error("[myRoleCodes] failed", error.message);
      return [];
    }
    return (data ?? [])
      .map((r) => (r as { roles?: { code: string } | null }).roles?.code)
      .filter((c): c is string => Boolean(c));
  });
