import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { staffLogin, myRoleCodes } from "@/lib/staff-login.functions";
import { getDeviceId, getDeviceLabel } from "@/lib/device";
import { installReplayListeners } from "@/lib/offline";
import type { Lang } from "@/lib/l10n";

export type Staff = {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  roles: string[];
  permissions: string[]; // "module:action"
  lang: Lang;
  unitId: string | null;
  firmId: string | null;
};

export type SignInResult = { ok: true } | { ok: false; code: string; attemptsLeft?: number };

type AuthCtx = {
  ready: boolean;
  staff: Staff | null;
  signIn: (mobile: string, pin: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  ready: false,
  staff: null,
  signIn: async () => ({ ok: false, code: "login_failed" }),
  signOut: async () => {},
  refresh: async () => {},
});

const LANGS = new Set(["en", "hi", "mr"]);

export function TeamAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [staff, setStaff] = useState<Staff | null>(null);

  const loadStaff = useCallback(async (userId: string): Promise<Staff | null> => {
    const [profileRes, permRes, roleCodes] = await Promise.all([
      supabase
        .from("user_profiles")
        .select("id, full_name, mobile, email, preferred_language, unit_id, firm_id")
        .eq("id", userId)
        .single(),
      supabase.rpc("my_permissions"),
      myRoleCodes(),
    ]);
    const p = profileRes.data;
    if (!p) return null;
    const roles = roleCodes;
    const permissions = ((permRes.data ?? []) as { module: string; action: string }[]).map(
      (x) => `${x.module}:${x.action}`,
    );
    const lang = LANGS.has(String(p.preferred_language)) ? (p.preferred_language as Lang) : "en";
    return {
      id: p.id,
      fullName: p.full_name ?? "",
      mobile: p.mobile ?? "",
      email: p.email ?? null,
      roles,
      permissions,
      lang,
      unitId: p.unit_id ?? null,
      firmId: p.firm_id ?? null,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (uid && !cancelled) {
        const s = await loadStaff(uid);
        if (s && !cancelled) setStaff(s);
        if (data.session) {
          // Record the session before anything gated on has_perm/my_session_is_valid runs.
          const { error: loginErr } = await supabase.rpc("record_login", {
            p_login_method: "pin",
            p_user_agent: navigator.userAgent,
          });
          if (loginErr) console.warn("[auth] record_login failed", loginErr.message);
        }
      }
      if (!cancelled) setReady(true);
    };
    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "SIGNED_OUT") setStaff(null);
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        void supabase.auth.getSession().then(({ data: d }: { data: { session: { user?: { id: string } } | null } }) => {
          const uid = d.session?.user?.id;
          if (uid) void loadStaff(uid).then((s) => s && setStaff(s));
        });
      }
    });

    const stopReplay = installReplayListeners();
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      stopReplay();
    };
  }, [loadStaff]);

  const signIn = useCallback(
    async (mobile: string, pin: string): Promise<SignInResult> => {
      const res = await staffLogin({ data: { mobile, pin, deviceId: getDeviceId(), deviceLabel: getDeviceLabel() } });
      if (!res.ok) {
        const out: SignInResult = { ok: false, code: res.code };
        if (typeof res.attemptsLeft === "number") out.attemptsLeft = res.attemptsLeft;
        return out;
      }
      const verify =
        res.method === "sms"
          ? await supabase.auth.verifyOtp({ phone: res.phone!, token: res.token, type: "sms" })
          : await supabase.auth.verifyOtp({ email: res.email!, token: res.token, type: "magiclink" });
      if (verify.error) {
        console.warn("[auth] verifyOtp failed", verify.error.message);
        return { ok: false, code: "verify_failed" };
      }
      const s = await loadStaff(res.staff.id);
      if (!s) return { ok: false, code: "verify_failed" };
      setStaff(s);
      const { error: loginErr } = await supabase.rpc("record_login", { p_login_method: "pin", p_user_agent: navigator.userAgent });
      if (loginErr) console.warn("[auth] record_login failed", loginErr.message);
      return { ok: true };
    },
    [loadStaff],
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.rpc("record_logout");
    } catch {
      // best effort — sign out regardless
    }
    await supabase.auth.signOut();
    setStaff(null);
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) return;
    const s = await loadStaff(uid);
    if (s) setStaff(s);
  }, [loadStaff]);

  const value = useMemo<AuthCtx>(() => ({ ready, staff, signIn, signOut, refresh }), [ready, staff, signIn, signOut, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTeamAuth() {
  return useContext(Ctx);
}
