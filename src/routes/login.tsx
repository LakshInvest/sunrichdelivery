import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTeamAuth } from "@/lib/team-auth";
import { LANGS, useLang, type Lang } from "@/lib/l10n";

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

function Login() {
  const { t, lang, setLang } = useLang();
  const { signIn } = useTeamAuth();
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If a session exists (e.g. back navigation), go home.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (data.session) void window.location.assign("/");
    });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    const res = await signIn(mobile, pin);
    setBusy(false);
    if (res.ok) {
      window.location.assign("/");
      return;
    }
    if (res.code === "wrong_pin") {
      setError(t("err.wrong_pin", { n: res.attemptsLeft ?? 5 }));
    } else {
      const key = `err.${res.code}`;
      const msg = t(key);
      setError(msg === key ? t("err.login_failed") : msg);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-10 pt-14">
      <div className="mb-6 flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{t("c.appName")}</span>
        <div className="flex gap-1" role="group" aria-label="Language">
          {LANGS.map((l: { code: Lang; short: string; label: string }) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLang(l.code)}
              aria-pressed={lang === l.code}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                lang === l.code
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              {l.short}
            </button>
          ))}
        </div>
      </div>

      <h1 className="text-3xl font-bold tracking-tight text-foreground">{t("login.title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("login.subtitle")}</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <div>
          <label htmlFor="mobile" className="mb-1 block text-sm font-medium text-foreground">
            {t("login.mobile")}
          </label>
          <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
            <span className="text-sm text-muted-foreground">+91</span>
            <input
              id="mobile"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, ""))}
              className="w-full bg-transparent py-3 text-base tracking-widest text-foreground outline-none"
              placeholder="9999900013"
              required
            />
          </div>
        </div>
        <div>
          <label htmlFor="pin" className="mb-1 block text-sm font-medium text-foreground">
            {t("login.pin")}
          </label>
          <input
            id="pin"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className="w-full rounded-lg border border-input bg-background px-3 py-3 text-base tracking-[0.5em] text-foreground outline-none focus:ring-2 focus:ring-ring"
            placeholder="••••"
            required
          />
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-primary py-3.5 text-base font-semibold text-primary-foreground transition-opacity active:opacity-80 disabled:opacity-60"
        >
          {busy ? t("login.signingIn") : t("login.submit")}
        </button>
      </form>

      <p className="mt-auto pt-10 text-center text-xs text-muted-foreground">{t("login.qaHint")}</p>
    </main>
  );
}
