// Mobile + PIN/OTP login. Runs server-side:
// - PIN sign-in is verified by check_pin (trusted device required unless the
//   profile allows skipping OTP).
// - OTP sign-in: the 6-digit code is generated, stored hashed and verified on
//   the server. A bare mobile number NEVER returns a session token; the token
//   is minted only after a correct PIN or a correct, unexpired OTP.
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

const OTP_TTL_MS = 5 * 60 * 1000; // codes live 5 minutes
const OTP_LOCK_MS = 15 * 60 * 1000; // 15-minute lock after 5 wrong tries
const OTP_MAX_ATTEMPTS = 5;
const OTP_SEND_WINDOW_MS = 15 * 60 * 1000; // rate-limit window
const OTP_MAX_SENDS = 3; // max codes per mobile per window

const sha256Hex = async (s: string): Promise<string> => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const sixDigitCode = (): string => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String((buf[0] ?? 0) % 1_000_000).padStart(6, "0");
};

/** Audit-log a login_without_otp sign-in (flag set from Command Center). */
const auditFlaggedLogin = (
  supabaseAdmin: { from: (t: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> } },
  profileId: string,
  mobile: string,
) => {
  return supabaseAdmin.from("audit_logs").insert({
    action: "login_without_otp",
    entity_type: "user_profiles",
    entity_id: profileId,
    new_data: { mobile },
  });
};

const adminClient = async () => (await import("@/integrations/supabase/client.server")).supabaseAdmin;

type AiSensySend = { ok: boolean; reason?: string };

/**
 * WhatsApp OTP delivery via AiSensy (the same sender the customer app uses).
 * Runs server-only: the code and the API key never reach the browser.
 * AiSensy returns success even when WhatsApp later rejects the message, so the
 * copy-code button parameter is ALWAYS sent with every call — no
 * retry-on-rejection path. The failure reason is logged without the OTP or key.
 */
const sendOtpWhatsapp = async (mobile10: string, otp: string, userName: string): Promise<AiSensySend> => {
  const apiKey = process.env["AISENSY_API_KEY"];
  const campaignName = process.env["AISENSY_OTP_CAMPAIGN"];
  if (!apiKey || !campaignName) return { ok: false, reason: "missing_aisensy_secret" };

  const payload = {
    apiKey,
    campaignName,
    destination: `91${mobile10}`,
    userName,
    templateParams: [otp],
    buttons: [{ type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: otp }] }],
  };

  try {
    const res = await fetch("https://backend.aisensy.com/campaign/t1/api/v2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body: unknown = await res.json().catch(() => null);
    const msg = typeof (body as { message?: unknown })?.message === "string" ? (body as { message: string }).message : "";
    const success = res.ok && (body as { success?: unknown })?.success !== false;
    if (!success) {
      console.error("[sendOtpWhatsapp] send failed", res.status, msg);
      return { ok: false, reason: `aisensy_${res.status || "error"}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[sendOtpWhatsapp] request failed", e instanceof Error ? e.message : "network_error");
    return { ok: false, reason: "aisensy_request_failed" };
  }
};

export const staffLogin = createServerFn({ method: "POST" })
  .inputValidator((input: LoginInput) => input)
  .handler(async ({ data }): Promise<StaffLoginResult> => {
    const supabaseAdmin = await adminClient();

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
      .select("id, full_name, mobile, email, preferred_language, user_type, unit_id, firm_id, is_active, login_without_otp")
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

    // Accounts flagged login_without_otp skip OTP by database configuration;
    // every such sign-in goes into the audit log.
    if (profile.login_without_otp) {
      const { error: auditErr } = await auditFlaggedLogin(supabaseAdmin, profile.id, mobile);
      if (auditErr) console.error("[staffLogin] audit insert failed", auditErr.message);
    }

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
    const supabaseAdmin = await adminClient();
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

/** Result of asking for an OTP. */
export type StaffOtpRequestResult =
  | { ok: true; auto: true; email: string; token: string; staff: StaffBrief }
  | { ok: true; auto?: false }
  | { ok: false; code: string };

/**
 * Step 1 of the OTP path. Generates a 6-digit code, stores only its hash
 * (5-minute validity, max 5 wrong tries then a 15-minute lock, single use) and
 * sends nothing sensitive back to the browser.
 *
 * Accounts with login_without_otp (or demo accounts) skip the code entirely:
 * they receive an auto-verifiable session token, audited in audit_logs.
 */
export const staffRequestOtp = createServerFn({ method: "POST" })
  .inputValidator((input: { mobile: string; deviceId?: string }) => input)
  .handler(async ({ data }): Promise<StaffOtpRequestResult> => {
    const supabaseAdmin = await adminClient();
    const digits = String(data.mobile || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    if (!/^\d{10}$/.test(digits) || !/^[6-9]/.test(digits)) {
      return { ok: false, code: "invalid_mobile" };
    }
    const mobile = `+91${digits}`;
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("id, full_name, mobile, email, preferred_language, unit_id, firm_id, is_active, login_without_otp, is_demo")
      .eq("mobile", mobile)
      .eq("user_type", "staff")
      .maybeSingle();
    if (!profile || profile.is_active === false) return { ok: false, code: "not_registered" };
    const staff: StaffBrief = {
      id: profile.id,
      fullName: profile.full_name ?? "",
      mobile: profile.mobile ?? mobile,
      email: profile.email ?? null,
      preferredLanguage: profile.preferred_language ?? "en",
      unitId: profile.unit_id ?? null,
      firmId: profile.firm_id ?? null,
    };

    // Flagged accounts: mint the session token directly (audited).
    if (profile.login_without_otp || profile.is_demo) {
      const email = String(profile.email ?? "").trim();
      if (!email) return { ok: false, code: "login_failed" };
      const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
      if (error || !link) {
        console.error("[staffRequestOtp] generateLink failed", error?.message);
        return { ok: false, code: "login_failed" };
      }
      const token = link.properties?.email_otp ?? "";
      if (!token) return { ok: false, code: "login_failed" };
      const { error: auditErr } = await auditFlaggedLogin(supabaseAdmin, profile.id, mobile);
      if (auditErr) console.error("[staffRequestOtp] audit insert failed", auditErr.message);
      return { ok: true, auto: true, email, token, staff };
    }

    // 15-minute lock after 5 wrong tries on the newest outstanding code.
    const { data: lastRow } = await supabaseAdmin
      .from("otp_requests")
      .select("locked_until, attempts, max_attempts, consumed_at")
      .eq("user_id", profile.id)
      .eq("destination", mobile)
      .eq("purpose", "staff_2fa")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      lastRow &&
      !lastRow.consumed_at &&
      (lastRow.locked_until ? new Date(lastRow.locked_until).getTime() > Date.now() : false)
    ) {
      return { ok: false, code: "locked" };
    }

    // Rate limit: max 3 codes per mobile per 15 minutes, counting every row
    // (sent, consumed or not) in the window.
    const { count: recentSends } = await supabaseAdmin
      .from("otp_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .eq("destination", mobile)
      .eq("purpose", "staff_2fa")
      .gte("created_at", new Date(Date.now() - OTP_SEND_WINDOW_MS).toISOString());
    if ((recentSends ?? 0) >= OTP_MAX_SENDS) {
      return { ok: false, code: "too_many_codes" };
    }

    // Single use: any earlier outstanding code is invalidated.
    await supabaseAdmin
      .from("otp_requests")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", profile.id)
      .eq("destination", mobile)
      .eq("purpose", "staff_2fa")
      .is("consumed_at", null);

    const code = sixDigitCode();
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("otp_requests")
      .insert({
        user_id: profile.id,
        channel: "whatsapp",
        purpose: "staff_2fa",
        destination: mobile,
        code_hash: await sha256Hex(`${code}:${profile.id}`),
        attempts: 0,
        max_attempts: OTP_MAX_ATTEMPTS,
        expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      })
      .select("id")
      .single();
    if (insertErr || !inserted) {
      console.error("[staffRequestOtp] insert failed", insertErr?.message);
      return { ok: false, code: "login_failed" };
    }

    // Delivery hook: AiSensy WhatsApp sender. The code is intentionally never
    // returned to the browser; only the pass/fail outcome is.
    const sent = await sendOtpWhatsapp(digits, code, profile.full_name?.trim() || "Sunrich");
    if (!sent.ok) {
      // Mark the stored code unusable so a failed send can never be verified.
      await supabaseAdmin.from("otp_requests").update({ consumed_at: new Date().toISOString() }).eq("id", inserted.id);
      return { ok: false, code: "otp_send_failed" };
    }
    return { ok: true };
  });

/** Result of checking a typed OTP. */
export type StaffOtpVerifyResult =
  | { ok: true; email: string; token: string; staff: StaffBrief }
  | { ok: false; code: "wrong_otp" | "locked" | "expired" | "invalid_mobile" | "not_registered" | "login_failed"; attemptsLeft?: number };

/**
 * Step 2 of the OTP path. Checks the typed code against the stored hash
 * (single use, 5-minute validity, 5 wrong tries lock for 15 minutes). Only a
 * correct code yields the one-time Supabase token the browser needs to open a
 * session — a bare mobile number never gets one.
 */
export const staffVerifyOtp = createServerFn({ method: "POST" })
  .inputValidator((input: { mobile: string; code: string }) => input)
  .handler(async ({ data }): Promise<StaffOtpVerifyResult> => {
    const supabaseAdmin = await adminClient();
    const digits = String(data.mobile || "").replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
    const code = String(data.code || "").replace(/\D/g, "");
    if (!/^\d{10}$/.test(digits) || !/^[6-9]/.test(digits) || !/^\d{6}$/.test(code)) {
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

    const { data: row } = await supabaseAdmin
      .from("otp_requests")
      .select("id, code_hash, attempts, max_attempts, expires_at, locked_until")
      .eq("user_id", profile.id)
      .eq("destination", mobile)
      .eq("purpose", "staff_2fa")
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!row) return { ok: false, code: "expired" };
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      return { ok: false, code: "locked" };
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, code: "expired" };
    }
    if (row.attempts >= row.max_attempts) {
      await supabaseAdmin
        .from("otp_requests")
        .update({ locked_until: new Date(Date.now() + OTP_LOCK_MS).toISOString() })
        .eq("id", row.id);
      return { ok: false, code: "locked" };
    }

    if ((await sha256Hex(`${code}:${profile.id}`)) !== row.code_hash) {
      const attempts = row.attempts + 1;
      const locked = attempts >= row.max_attempts;
      await supabaseAdmin
        .from("otp_requests")
        .update({
          attempts,
          ...(locked ? { locked_until: new Date(Date.now() + OTP_LOCK_MS).toISOString() } : {}),
        })
        .eq("id", row.id);
      return locked
        ? { ok: false, code: "locked" }
        : { ok: false, code: "wrong_otp", attemptsLeft: row.max_attempts - attempts };
    }

    // Correct code: consume it (single use) and mint the session token.
    await supabaseAdmin.from("otp_requests").update({ consumed_at: new Date().toISOString() }).eq("id", row.id);
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
    if (error || !link) {
      console.error("[staffVerifyOtp] generateLink failed", error?.message);
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
    const supabaseAdmin = await adminClient();
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
