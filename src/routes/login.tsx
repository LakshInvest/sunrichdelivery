import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Lock, ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTeamAuth } from "@/lib/team-auth";
import { LANGS, useLang, type Lang } from "@/lib/l10n";
import { getDeviceId, getDeviceLabel } from "@/lib/device";
import { checkDeviceStatus, staffLogin, staffOtpLogin } from "@/lib/staff-login.functions";
import { haptic } from "@/lib/native";
import { WaterLoader, BrandLogo } from "@/components/team/ui";
import logoWhiteAsset from "@/assets/sunrich-logo-white.png.asset.json";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in · Sunrich Team" },
      { name: "description", content: "Sign in to the Sunrich Team app with your mobile number and PIN." },
      { property: "og:title", content: "Sign in · Sunrich Team" },
      { property: "og:description", content: "Sign in to the Sunrich Team app with your mobile number and PIN." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    // Only meaningful client-side; the session lives in browser storage.
    if (typeof window !== "undefined") {
      const { data } = await supabase.auth.getSession();
      if (data.session) throw redirect({ to: "/" });
    }
  },
  component: Login,
});

type Step = "mobile" | "pin" | "otp";

const LAST_MOBILE_KEY = "sunrich_last_mobile";

/** Full-screen navy water scene: slow waves + rising bubbles behind the login sheet. */
function WaterScene() {
  const waves = [
    { cls: "bg-gradient-to-br from-aqua/40 to-aqua/10", style: { width: "150%", height: "70%", bottom: "-32%", left: "-20%", animationDuration: "19s" } },
    { cls: "bg-gradient-to-tl from-aqua/25 to-white/10", style: { width: "140%", height: "55%", bottom: "-22%", right: "-30%", animationDuration: "25s", animationDelay: "-6s" } },
    { cls: "bg-white/10", style: { width: "120%", height: "42%", bottom: "-12%", left: "-10%", animationDuration: "31s", animationDelay: "-12s" } },
  ];
  const bubbles = [
    { left: "8%", size: 14, dur: 13, delay: 0 },
    { left: "22%", size: 8, dur: 17, delay: 4 },
    { left: "38%", size: 18, dur: 11, delay: 2 },
    { left: "55%", size: 10, dur: 15, delay: 7 },
    { left: "68%", size: 14, dur: 12, delay: 1 },
    { left: "82%", size: 9, dur: 18, delay: 5 },
    { left: "92%", size: 16, dur: 14, delay: 9 },
  ];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-t-[28px]">
      {waves.map((w, i) => (
        <div key={i} className={`wave-blob ${w.cls}`} style={w.style} />
      ))}
      {bubbles.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={{ left: b.left, width: b.size, height: b.size, animationDuration: `${b.dur}s`, animationDelay: `-${b.delay}s` }}
        />
      ))}
    </div>
  );
}

/** Code boxes that fill with water from the bottom as digits are entered. */
function CodeBoxes({
  count,
  code,
  state,
}: {
  count: number;
  code: string;
  state: "idle" | "error" | "success";
}) {
  return (
    <div className={`flex justify-center gap-2 ${state === "error" ? "shake" : ""}`}>
      {Array.from({ length: count }).map((_, i) => {
        const ch = code[i] ?? "";
        const filled = Boolean(ch) || state === "success";
        return (
          <div
            key={i}
            className={`relative h-16 w-11 overflow-hidden rounded-md border-2 bg-card transition-colors duration-300 ${
              state === "success"
                ? "border-emerald-500"
                : state === "error"
                  ? "border-destructive/60"
                  : ch
                    ? "border-aqua"
                    : "border-input"
            }`}
          >
            <span
              aria-hidden
              className={`absolute inset-0 transition-transform duration-300 ease-out ${
                state === "success"
                  ? "bg-emerald-500"
                  : "bg-gradient-to-t from-aqua to-[#5fc3f4]"
              }`}
              style={{ transform: filled ? "translateY(0)" : "translateY(101%)" }}
            />
            {state === "success" ? (
              <Check className="absolute inset-0 m-auto h-6 w-6 text-white" strokeWidth={3} />
            ) : (
              <span
                className={`absolute inset-0 grid place-items-center text-2xl font-bold ${
                  filled ? "text-white" : "text-foreground"
                }`}
              >
                {ch}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Small ring timer around the resend action. */
function ResendRing({ seconds, onResend, label }: { seconds: number; onResend: () => void; label: string }) {
  const total = 30;
  const r = 9;
  const c = 2 * Math.PI * r;
  const done = seconds <= 0;
  return (
    <button
      type="button"
      onClick={onResend}
      disabled={!done}
      className="inline-flex items-center gap-2 text-xs font-semibold text-white/80 disabled:opacity-70"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke="#0AAAED"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={done ? 0 : c * (1 - (total - seconds) / total)}
          style={{ transition: "stroke-dashoffset 1s linear" }}
        />
      </svg>
      {label}
    </button>
  );
}

function Login() {
  const { t, lang, setLang } = useLang();
  const { signIn } = useTeamAuth();
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinState, setPinState] = useState<"idle" | "error" | "success">("idle");
  const [otpState, setOtpState] = useState<"idle" | "error" | "success">("idle");
  const [otpEmail, setOtpEmail] = useState<string | null>(null);
  const otpToken = useRef<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [clipboardCode, setClipboardCode] = useState<string | null>(null);
  const [tagline, setTagline] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const otpInput = useRef<HTMLInputElement>(null);

  // Brand tagline from public_app_info() so Command Center edits apply here too.
  useEffect(() => {
    let alive = true;
    void supabase
      .rpc("public_app_info")
      .then(({ data }: { data: Record<string, unknown> | null }) => {
        if (!alive || !data) return;
        const key = lang === "hi" ? "login_tagline_hi" : lang === "mr" ? "login_tagline_mr" : "login_tagline";
        setTagline((data[key] as string) || (data.login_tagline as string) || null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lang]);

  // Remember the last number on this device (device id itself is never regenerated).
  useEffect(() => {
    const last = window.localStorage.getItem(LAST_MOBILE_KEY);
    if (last) setMobile(last);
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (data.session) void window.location.assign("/");
    });
  }, []);

  // Offer a 6-digit code found on the clipboard when the app regains focus
  // (WhatsApp "Copy code" button).
  useEffect(() => {
    if (step !== "otp") return;
    const check = async () => {
      try {
        const text = await navigator.clipboard.readText();
        const m = text.match(/\b(\d{6})\b/);
        if (m && m[1] !== code) setClipboardCode(m[1]);
        else setClipboardCode(null);
      } catch {
        setClipboardCode(null);
      }
    };
    void check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const finish = () => {
    void haptic("success");
    window.location.assign("/");
  };

  const recordLogin = async () => {
    const { error: loginErr } = await supabase.rpc("record_login", {
      p_login_method: "otp",
      p_user_agent: navigator.userAgent,
    });
    if (loginErr) console.warn("[login] record_login failed", loginErr.message);
  };

  const goOtp = useCallback(async () => {
    setStep("otp");
    setOtpState("idle");
    setCode("");
    setError(null);
    setResendIn(30);
    if (resendTimer) clearInterval(resendTimer);
    const timer = setInterval(() => setResendIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    setResendTimer(timer);
    const res = await staffOtpLogin({ data: { mobile: `+91${mobile}` } });
    if (!res.ok) {
      setError(t(`err.${res.code}`) === `err.${res.code}` ? t("err.login_failed") : t(`err.${res.code}`));
      return;
    }
    setOtpEmail(res.email);
    otpToken.current = res.token;
    setTimeout(() => otpInput.current?.focus(), 250);
  }, [mobile, resendTimer, t]);

  const verifyCode = async (candidate: string) => {
    if (!otpEmail || busy) return;
    setBusy(true);
    setError(null);
    const { error: vErr } = await supabase.auth.verifyOtp({ email: otpEmail, token: candidate, type: "magiclink" });
    if (vErr) {
      setBusy(false);
      void haptic("error");
      setOtpState("error");
      setError(t("err.otp_mismatch"));
      setTimeout(() => {
        setOtpState("idle");
        setCode("");
      }, 500);
      return;
    }
    setOtpState("success");
    await recordLogin();
    setBusy(false);
    setTimeout(finish, 450);
  };

  const autoVerify = async () => {
    // Minted code verified on the server: fill the boxes together, then confirm.
    const token = otpToken.current;
    if (!token || busy) return;
    setBusy(true);
    setCode(token);
    await new Promise((r) => setTimeout(r, 350));
    setBusy(false);
    await verifyCode(token);
  };

  const onOtpChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setError(null);
    setOtpState("idle");
    if (digits.length === 6) void verifyCode(digits);
  };

  const checkMobile = async () => {
    if (busy) return;
    const digits = mobile.replace(/\D/g, "");
    if (digits.length !== 10) {
      setError(t("err.invalid_mobile"));
      return;
    }
    setBusy(true);
    setError(null);
    const status = await checkDeviceStatus({ data: { mobile: `+91${digits}`, deviceId: getDeviceId() } });
    setBusy(false);
    if (!status.registered) {
      setError(t("err.not_registered"));
      return;
    }
    window.localStorage.setItem(LAST_MOBILE_KEY, digits);
    setName(status.firstName);
    if (status.hasPin && (status.trusted || status.skipOtp)) {
      setPin("");
      setPinState("idle");
      setError(null);
      setStep("pin");
    } else if (!status.hasPin) {
      setError(t("err.pin_not_set"));
      void goOtp();
    } else {
      void goOtp();
    }
  };

  const submitPin = async (value: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await signIn(`+91${mobile}`, value);
    if (res.ok) {
      setPinState("success");
      setBusy(false);
      setTimeout(finish, 400);
      return;
    }
    setBusy(false);
    if (res.code === "locked_use_otp") {
      void goOtp();
      return;
    }
    void haptic("error");
    setPinState("error");
    setError(
      res.code === "wrong_pin"
        ? t("err.wrong_pin", { n: res.attemptsLeft ?? 5 })
        : t(`err.${res.code}`) === `err.${res.code}`
          ? t("err.login_failed")
          : t(`err.${res.code}`),
    );
    setTimeout(() => {
      setPinState("idle");
      setPin("");
    }, 500);
  };

  const onPinChange = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    setPin(digits);
    setError(null);
    setPinState("idle");
    if (digits.length === 4) void submitPin(digits);
  };

  const formatted = (digits: string) => (digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);
  const progress = step === "mobile" ? "w-1/2" : "w-full";
  const maskedMobile = `+91 ${formatted(mobile.replace(/\D/g, ""))}`;

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col bg-navy-deep">
      {/* Brand sky: navy with slow water waves and bubbles */}
      <div className="relative overflow-hidden bg-gradient-to-b from-navy via-navy to-navy-deep pb-10 pt-[max(env(safe-area-inset-top),1.25rem)]">
        <WaterScene />
        <div className="relative flex items-center justify-between px-5">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Sunrich Team</span>
          <div className="flex gap-1 rounded-full bg-white/10 p-1" role="group" aria-label="Language">
            {LANGS.map((l: { code: Lang; short: string }) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLang(l.code)}
                aria-pressed={lang === l.code}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                  lang === l.code ? "bg-white text-navy" : "text-white/80"
                }`}
              >
                {l.short}
              </button>
            ))}
          </div>
        </div>
        <div className="relative mt-10 flex flex-col items-center px-6 text-center">
          <BrandLogo tone="white" className="h-14" />
          {tagline && <p className="mt-3 text-sm font-medium text-white/75">{tagline}</p>}
        </div>
      </div>

      {/* White sheet docked to the bottom */}
      <div className="relative z-10 -mt-6 flex flex-1 flex-col rounded-t-[28px] bg-card px-6 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-7 shadow-[0_-12px_40px_-20px_rgba(13,50,120,0.45)]">
        <div className="mb-6 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-aqua transition-all duration-300" style={{ width: progress === "w-full" ? "100%" : "50%" }} />
        </div>

        {step === "mobile" && (
          <div key="mobile" className="animate-in fade-in slide-in-from-bottom-3 duration-300">
            <h1 className="font-display text-2xl font-bold text-foreground">{t("login.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void checkMobile();
              }}
              className="mt-6"
            >
              <label htmlFor="mobile" className="mb-1 block text-sm font-medium text-foreground">
                {t("login.mobile")}
              </label>
              <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:border-aqua focus-within:ring-2 focus-within:ring-aqua/30">
                <span className="text-sm font-semibold text-muted-foreground">+91</span>
                <input
                  id="mobile"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={11}
                  value={formatted(mobile.replace(/\D/g, ""))}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="w-full bg-transparent py-3.5 text-lg font-semibold tracking-wide text-foreground outline-none"
                  placeholder="98765 43210"
                  required
                />
              </div>
              {error && (
                <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy || mobile.replace(/\D/g, "").length !== 10}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground shadow-soft transition-opacity active:opacity-80 disabled:opacity-50"
              >
                {busy ? <WaterLoader className="h-5 w-5" light /> : <WhatsAppIcon />}
                {busy ? t("login.verifying") : t("login.cta")}
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> {t("login.secure")}
              </p>
            </form>
          </div>
        )}

        {step === "pin" && (
          <div key="pin" className="animate-in fade-in slide-in-from-right-3 duration-300">
            <button type="button" onClick={() => setStep("mobile")} className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
              <ChevronLeft className="h-4 w-4" /> {t("login.changeNumber")}
            </button>
            <h1 className="font-display text-2xl font-bold text-foreground">{t("login.welcome", { name: name ?? "" })}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("login.pinHint")}</p>
            <div className="relative mt-6">
              <input
                ref={(el) => {
                  if (el) setTimeout(() => el.focus(), 200);
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={pin}
                onChange={(e) => onPinChange(e.target.value)}
                className="absolute inset-0 h-16 w-full cursor-pointer opacity-0"
                aria-label={t("login.pin")}
                autoFocus
              />
              <CodeBoxes count={4} code={pin} state={pinState} />
            </div>
            {error && (
              <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="alert">
                {error}
              </p>
            )}
            <button type="button" onClick={() => void goOtp()} className="mt-5 text-sm font-semibold text-navy underline-offset-4 hover:underline">
              {t("login.forgotPin")}
            </button>
          </div>
        )}

        {step === "otp" && (
          <div key="otp" className="animate-in fade-in slide-in-from-right-3 duration-300">
            <button type="button" onClick={() => setStep("mobile")} className="mb-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
              <ChevronLeft className="h-4 w-4" /> {t("login.changeNumber")}
            </button>
            <h1 className="font-display text-2xl font-bold text-foreground">{t("login.otpTitle")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("login.otpSent", { mobile: maskedMobile })}</p>
            <div className="relative mt-6">
              <input
                ref={otpInput}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => onOtpChange(e.target.value)}
                onPaste={(e) => {
                  e.preventDefault();
                  onOtpChange(e.clipboardData.getData("text"));
                }}
                className="absolute inset-0 h-16 w-full cursor-pointer opacity-0"
                aria-label={t("login.otpTitle")}
              />
              <CodeBoxes count={6} code={code} state={otpState} />
            </div>
            {clipboardCode && (
              <button
                type="button"
                onClick={() => onOtpChange(clipboardCode)}
                className="mt-4 w-full rounded-md bg-aqua-soft px-3 py-2.5 text-sm font-semibold text-navy"
              >
                {t("login.clipboard")} · <span className="font-mono">{clipboardCode}</span>
              </button>
            )}
            {error && (
              <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="mt-5 flex items-center justify-between">
              <ResendRing
                seconds={resendIn}
                label={resendIn > 0 ? t("login.resendIn", { n: resendIn }) : t("login.resend")}
                onResend={() => void goOtp()}
              />
              <button type="button" onClick={() => void autoVerify()} disabled={busy || !otpToken.current} className="text-xs font-semibold text-navy underline-offset-4 hover:underline">
                {t("login.otpAuto")}
              </button>
            </div>
          </div>
        )}

        {busy && step !== "mobile" && (
          <div className="mt-6 flex justify-center">
            <WaterLoader />
          </div>
        )}
      </div>
    </main>
  );
}

