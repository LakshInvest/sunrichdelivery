import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Lock, ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTeamAuth } from "@/lib/team-auth";
import { LANGS, useLang, type Lang } from "@/lib/l10n";
import { getDeviceId, getDeviceLabel, initDeviceId } from "@/lib/device";
import { checkDeviceStatus, staffLogin, staffRequestOtp, staffVerifyOtp } from "@/lib/staff-login.functions";
import { haptic } from "@/lib/native";
import { WaterLoader, BrandLogo } from "@/components/team/ui";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in · Sunrich Delivery" },
      { name: "description", content: "Sign in to the Sunrich Delivery app with your mobile number and PIN." },
      { property: "og:title", content: "Sign in · Sunrich Delivery" },
      { property: "og:description", content: "Sign in to the Sunrich Delivery app with your mobile number and PIN." },
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

type Step = "mobile" | "pin" | "otp" | "setpin";

const LAST_MOBILE_KEY = "sunrich_last_mobile";

/** Soft rising bubbles behind the navy hero — no wave strip, one clean block. */
function BubbleScene() {
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
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
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
                  : "bg-gradient-to-t from-aqua to-aqua/70"
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
      className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground disabled:opacity-70"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--color-border)" strokeWidth="2.5" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke="var(--color-aqua)"
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
  const [resendTimer, setResendTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const otpInput = useRef<HTMLInputElement>(null);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinStage, setPinStage] = useState<"new" | "confirm">("new");

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

  // Offer a 4-digit code found on the clipboard when the app regains focus
  // (WhatsApp "Copy code" button).
  useEffect(() => {
    if (step !== "otp") return;
    const check = async () => {
      try {
        const text = await navigator.clipboard.readText();
        const c = text.match(/\b(\d{4})\b/)?.[1];
        if (c && c !== code) setClipboardCode(c);
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
    // The server generates the code and keeps it; the browser never receives
    // it. Only login_without_otp accounts get an auto-verifiable session token.
    const res = await staffRequestOtp({ data: { mobile: `+91${mobile}`, deviceId: getDeviceId() } });
    if (!res.ok) {
      setError(t(`err.${res.code}`) === `err.${res.code}` ? t("err.login_failed") : t(`err.${res.code}`));
      return;
    }
    if (res.auto) {
      setOtpEmail(res.email);
      otpToken.current = res.token;
    }
    setTimeout(() => otpInput.current?.focus(), 250);
  }, [mobile, resendTimer, t]);

  const verifyCode = async (candidate: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);

    // Auto path (login_without_otp / demo): the held token opens the session.
    if (otpEmail && otpToken.current) {
      const { error: vErr } = await supabase.auth.verifyOtp({ email: otpEmail, token: otpToken.current, type: "magiclink" });
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
      setTimeout(openSetPin, 350);
      return;
    }

    // Normal path: the typed code is verified on the server. Only after the
    // server accepts it does it hand back the one-time session token.
    const res = await staffVerifyOtp({ data: { mobile: `+91${mobile}`, code: candidate } });
    if (!res.ok) {
      setBusy(false);
      void haptic("error");
      setOtpState("error");
      setError(
        res.code === "wrong_otp"
          ? t("err.wrong_otp", { n: res.attemptsLeft ?? 0 })
          : t(`err.${res.code}`) === `err.${res.code}`
            ? t("err.otp_mismatch")
            : t(`err.${res.code}`),
      );
      setTimeout(() => {
        setOtpState("idle");
        setCode("");
      }, 500);
      return;
    }
    const { error: vErr } = await supabase.auth.verifyOtp({ email: res.email, token: res.token, type: "magiclink" });
    if (vErr) {
      setBusy(false);
      void haptic("error");
      setOtpState("error");
      setError(t("err.verify_failed"));
      setTimeout(() => {
        setOtpState("idle");
        setCode("");
      }, 500);
      return;
    }
    setOtpState("success");
    await recordLogin();
    setBusy(false);
    // First OTP on this phone (or Forgot PIN / locked PIN): set a PIN, which
    // also trusts this device so next time it's mobile + PIN only.
    setTimeout(openSetPin, 350);
  };

  function openSetPin() {
    setNewPin("");
    setConfirmPin("");
    setPinStage("new");
    setPinState("idle");
    setError(null);
    setStep("setpin");
  }

  const savePin = async () => {
    if (busy) return;
    if (pinStage === "new") {
      if (newPin.length !== 4) return;
      setPinStage("confirm");
      setConfirmPin("");
      setError(null);
      return;
    }
    if (confirmPin !== newPin) {
      void haptic("error");
      setPinState("error");
      setError(t("err.pin_mismatch"));
      setTimeout(() => {
        setPinState("idle");
        setNewPin("");
        setConfirmPin("");
        setPinStage("new");
      }, 600);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: pErr } = await supabase.rpc("set_my_pin", {
      p_device_id: await initDeviceId(),
      p_device_label: getDeviceLabel(),
      p_pin: newPin,
    });
    setBusy(false);
    if (pErr) {
      console.warn("[login] set_my_pin failed", pErr.message);
      setPinState("error");
      setError(t("err.pin_save_failed"));
      return;
    }
    setPinState("success");
    setTimeout(finish, 400);
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
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    setCode(digits);
    setError(null);
    setOtpState("idle");
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
    const deviceId = await initDeviceId().catch(() => getDeviceId());
    const status = await checkDeviceStatus({ data: { mobile: `+91${digits}`, deviceId } });
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
    if (res.code === "locked_use_otp" || res.code === "locked") {
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
  };

  const formatted = (digits: string) => (digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits);
  const maskedMobile = `+91 ${formatted(mobile.replace(/\D/g, ""))}`;

  return (
    <main className="relative mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden bg-navy-deep">
      {/* Navy hero — one clean block, soft bubbles, logo + tagline centred. Shrinks with the keyboard. */}
      <div
        className="relative flex shrink-0 flex-col overflow-hidden bg-gradient-to-b from-navy via-navy to-navy-deep pt-[max(env(safe-area-inset-top),0.75rem)] transition-[height] duration-300 ease-out"
        style={{ height: "55dvh", minHeight: "220px" }}
      >
        <BubbleScene />
        <div className="relative z-10 flex justify-end px-4">
          <div className="flex gap-1 rounded-full bg-white/10 p-1" role="group" aria-label="Language">
            {LANGS.map((l: { code: Lang; short: string }) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setLang(l.code)}
                aria-pressed={lang === l.code}
                className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                  lang === l.code ? "bg-aqua text-navy" : "text-white/80"
                }`}
              >
                {l.short}
              </button>
            ))}
          </div>
        </div>
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 pb-6 text-center">
          <BrandLogo tone="white" className="h-16" />
          <p className={`mt-4 text-sm font-bold uppercase text-aqua ${lang === "en" ? "tracking-[0.35em]" : "tracking-wide"}`}>
            {lang === "hi" ? "डिलीवरी" : lang === "mr" ? "डिलिव्हरी" : "DELIVERY"}
          </p>
        </div>
      </div>

      {/* White sheet docked low: rounded top, small centred progress bar, centred content */}
      <div className="relative z-10 -mt-7 flex min-h-0 flex-1 flex-col rounded-t-[28px] bg-card px-6 pb-[max(env(safe-area-inset-bottom),1.25rem)] pt-4 shadow-[0_-12px_40px_-20px_rgba(13,50,120,0.45)]">
        <div aria-hidden className="mx-auto mb-5 h-1 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-aqua transition-all duration-300"
            style={{ width: step === "mobile" ? "34%" : step === "setpin" ? "100%" : "67%" }}
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {step === "mobile" && (
            <div key="mobile" className="animate-in text-center fade-in slide-in-from-bottom-3 duration-300">
              <h1 className="font-display text-2xl font-bold text-foreground">{t("login.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void checkMobile();
                }}
                className="mt-6"
              >
                <label htmlFor="mobile" className="mb-1.5 block text-center text-sm font-medium text-foreground">
                  {t("login.mobile")}
                </label>
                <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 focus-within:border-aqua focus-within:ring-2 focus-within:ring-aqua/30">
                  <span className="text-xl font-semibold tabular-nums text-foreground">+91</span>
                  <input
                    id="mobile"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    maxLength={11}
                    value={formatted(mobile.replace(/\D/g, ""))}
                    onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    size={11}
                    style={{ width: "11ch" }}
                    className="bg-transparent py-3.5 text-left text-xl font-semibold tabular-nums text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/50"
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
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground shadow-soft transition-opacity active:opacity-80 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
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
            <div key="pin" className="animate-in text-center fade-in slide-in-from-right-3 duration-300">
              <button
                type="button"
                onClick={() => setStep("mobile")}
                className="mx-auto mb-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"
              >
                <ChevronLeft className="h-4 w-4" /> {t("login.changeNumber")}
              </button>
              <h1 className="font-display text-2xl font-bold text-foreground">{t("login.welcome", { name: name ?? "" })}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("login.pinHint")}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pin.length === 4 && !busy) void submitPin(pin);
                }}
              >
              <div className="relative mt-6" onPointerDown={(e) => { const el = e.currentTarget.querySelector("input"); if (el) { el.focus(); } }}>
                <input
                  enterKeyHint="done"
                  ref={(el) => {
                    if (el) setTimeout(() => el.focus(), 200);
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={pin}
                  onChange={(e) => onPinChange(e.target.value)}
                  className="absolute inset-0 z-10 h-16 w-full cursor-pointer bg-transparent text-[16px] text-transparent caret-transparent opacity-[0.01] outline-none"
                  aria-label={t("login.pin")}
                  autoFocus
                />
                <CodeBoxes count={4} code={pin} state={pinState} />
              </div>
              <button
                type="submit"
                disabled={busy || pin.length !== 4}
                className="mt-5 flex w-full items-center justify-center rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground shadow-soft transition-opacity active:opacity-80 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
              >
                {t("login.continue")}
              </button>
              </form>
              {error && (
                <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="alert">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={() => void goOtp()}
                className="mx-auto mt-5 block text-sm font-semibold text-navy underline-offset-4 hover:underline"
              >
                {t("login.forgotPin")}
              </button>
            </div>
          )}

          {step === "otp" && (
            <div key="otp" className="animate-in text-center fade-in slide-in-from-right-3 duration-300">
              <button
                type="button"
                onClick={() => setStep("mobile")}
                className="mx-auto mb-3 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"
              >
                <ChevronLeft className="h-4 w-4" /> {t("login.changeNumber")}
              </button>
              <h1 className="font-display text-2xl font-bold text-foreground">{t("login.otpTitle")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t("login.otpSent", { mobile: maskedMobile })}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (code.length === 4 && !busy) void verifyCode(code);
                }}
              >
              <div className="relative mt-6" onPointerDown={(e) => { const el = e.currentTarget.querySelector("input"); if (el) { el.focus(); } }}>
                <input
                  enterKeyHint="done"
                  ref={otpInput}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => onOtpChange(e.target.value)}
                  onPaste={(e) => {
                    e.preventDefault();
                    onOtpChange(e.clipboardData.getData("text"));
                  }}
                  className="absolute inset-0 z-10 h-16 w-full cursor-pointer bg-transparent text-[16px] text-transparent caret-transparent opacity-[0.01] outline-none"
                  aria-label={t("login.otpTitle")}
                />
                <CodeBoxes count={4} code={code} state={otpState} />
              </div>
              <button
                type="submit"
                disabled={busy || code.length !== 4}
                className="mt-5 flex w-full items-center justify-center rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground shadow-soft transition-opacity active:opacity-80 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
              >
                {t("login.verify")}
              </button>
              </form>
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
              <div className="mt-5 flex flex-col items-center gap-3">
                <ResendRing
                  seconds={resendIn}
                  label={resendIn > 0 ? t("login.resendIn", { n: resendIn }) : t("login.resend")}
                  onResend={() => void goOtp()}
                />
                <button
                  type="button"
                  onClick={() => void autoVerify()}
                  disabled={busy || !otpToken.current}
                  className="text-xs font-semibold text-navy underline-offset-4 hover:underline"
                >
                  {t("login.otpAuto")}
                </button>
              </div>
            </div>
          )}

          {step === "setpin" && (
            <div key={`setpin-${pinStage}`} className="animate-in text-center fade-in slide-in-from-right-3 duration-300">
              <h1 className="font-display text-2xl font-bold text-foreground">
                {pinStage === "new" ? t("login.setPinTitle") : t("login.confirmPinTitle")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {pinStage === "new" ? t("login.setPinHint") : t("login.confirmPinHint")}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void savePin();
                }}
              >
                <div className="relative mt-6" onPointerDown={(e) => { const el = e.currentTarget.querySelector("input"); if (el) el.focus(); }}>
                  <input
                    enterKeyHint="done"
                    ref={(el) => {
                      if (el) setTimeout(() => el.focus(), 200);
                    }}
                    inputMode="numeric"
                    autoComplete="off"
                    value={pinStage === "new" ? newPin : confirmPin}
                    onChange={(e) => {
                      const d = e.target.value.replace(/\D/g, "").slice(0, 4);
                      if (pinStage === "new") setNewPin(d);
                      else setConfirmPin(d);
                      setError(null);
                      setPinState("idle");
                    }}
                    className="absolute inset-0 z-10 h-16 w-full cursor-pointer bg-transparent text-[16px] text-transparent caret-transparent opacity-[0.01] outline-none"
                    aria-label={pinStage === "new" ? t("login.setPinTitle") : t("login.confirmPinTitle")}
                  />
                  <CodeBoxes count={4} code={pinStage === "new" ? newPin : confirmPin} state={pinState} />
                </div>
                <button
                  type="submit"
                  disabled={busy || (pinStage === "new" ? newPin : confirmPin).length !== 4}
                  className="mt-5 flex w-full items-center justify-center rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground shadow-soft transition-opacity active:opacity-80 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
                >
                  {t("login.continue")}
                </button>
              </form>
              {error && (
                <p className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}

          {busy && step !== "mobile" && (
            <div className="mt-6 flex justify-center">
              <WaterLoader />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.2 14.8l-.4-.2-2.6.7.7-2.5-.3-.4A8 8 0 0 1 12 4zm-2.5 3.8c-.2 0-.5 0-.7.3-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.2.2 1.8 2.9 4.5 3.9 2.2.9 2.7.7 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3l-2-1c-.3-.1-.5-.1-.7.1l-.9 1.1c-.2.2-.3.2-.6.1a7.4 7.4 0 0 1-2.2-1.3 8 8 0 0 1-1.5-1.9c-.2-.3 0-.4.1-.6l.5-.6c.1-.2.2-.3.3-.5v-.5l-.9-2.1c-.2-.5-.4-.5-.6-.5h-.6z" />
    </svg>
  );
}
