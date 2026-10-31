// Mobile + PIN login. Runs server-side: check_pin is not callable by anonymous
// clients, so PIN verification and the session-minting link happen here.
import { createServerFn } from "@tanstack/react-start";

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
        return { ok: false, code: "wrong_pin", attemptsLeft: Number.isFinite(left) ? left : undefined };
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

    // Fallback: phone-based link for accounts without an email.
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "sms",
      phone: mobile,
    });
    if (error || !link) {
      console.error("[staffLogin] generateLink(sms) failed", error?.message);
      return { ok: false, code: "login_failed" };
    }
    const token = link.properties?.email_otp ?? "";
    if (!token) return { ok: false, code: "login_failed" };
    return { ok: true, method: "sms", phone: mobile, token, staff };
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
