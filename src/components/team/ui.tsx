// Shared mobile UI pieces for the Team app screens — Sunrich water identity.
// Big touch targets, soft shadows, 20px cards, round chips, no hard corners.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LANGS, useLang } from "@/lib/l10n";
import { pendingCount, subscribe } from "@/lib/offline";
import { supabase } from "@/integrations/supabase/client";
import { fileToDataUrl, photoUrl, uploadPhoto } from "@/lib/photo";
import { isNative, takeNativePhoto, haptic } from "@/lib/native";
import logoNavy from "@/assets/sunrich-logo-navy.png.asset.json";
import logoWhite from "@/assets/sunrich-logo-white.png.asset.json";

/** Sunrich wordmark from the CDN (navy on light, white on navy). */
export function BrandLogo({ tone = "navy", className = "h-8" }: { tone?: "navy" | "white"; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={tone === "white" ? logoWhite.url : logoNavy.url} alt="Sunrich" className={`${className} w-auto`} />;
}

/** Tiny bottle that fills with water — the app's loader. */
export function WaterLoader({ className = "h-9 w-9", light = false }: { className?: string; light?: boolean }) {
  const stroke = light ? "rgba(255,255,255,0.75)" : "var(--color-muted-foreground)";
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <defs>
        <clipPath id="bottle-clip">
          <path d="M10 2.5h4v2.2c0 .6.3 1 .8 1.5 1.6 1.4 2.7 3.4 2.7 5.8v6.5a3.5 3.5 0 0 1-3.5 3.5h-4a3.5 3.5 0 0 1-3.5-3.5V12c0-2.4 1.1-4.4 2.7-5.8.5-.4.8-.9.8-1.5V2.5z" />
        </clipPath>
      </defs>
      <g clipPath="url(#bottle-clip)">
        <rect
          x="4"
          y="2"
          width="16"
          height="22"
          fill="var(--color-aqua)"
          style={{ transformOrigin: "center", animation: "bottle-fill 1.3s ease-in-out infinite" }}
        />
      </g>
      <path
        d="M10 2.5h4v2.2c0 .6.3 1 .8 1.5 1.6 1.4 2.7 3.4 2.7 5.8v6.5a3.5 3.5 0 0 1-3.5 3.5h-4a3.5 3.5 0 0 1-3.5-3.5V12c0-2.4 1.1-4.4 2.7-5.8.5-.4.8-.9.8-1.5V2.5z"
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function LanguageChips({ className = "" }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`flex gap-1 ${className}`} role="group" aria-label="Language">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLang(l.code)}
          aria-pressed={lang === l.code}
          className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
            lang === l.code ? "bg-primary text-primary-foreground shadow-soft" : "bg-muted text-muted-foreground hover:bg-accent"
          }`}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}

/** Offline + pending-sync pill; always visible while work is unsent. */
export function SyncBadge() {
  const { t } = useLang();
  const [n, setN] = useState(pendingCount());
  useEffect(() => subscribe(() => setN(pendingCount())), []);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (n === 0 && online) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
        !online ? "bg-destructive/10 text-destructive" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      }`}
    >
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      {!online ? t("c.offline") : t("c.pendingSync", { n })}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const key = `st.${status}`;
  const label = t(key);
  const tone =
    status === "in_progress"
      ? "bg-aqua/15 text-navy dark:text-aqua"
      : status === "delivered" || status === "settled" || status === "loaded" || status === "partial"
        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
        : status === "failed" || status === "cancelled"
          ? "bg-red-500/15 text-red-700 dark:text-red-300"
          : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

/** Standard screen shell: full phone height (no page scroll — content scrolls inside), safe-area aware. */
export function Screen({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <main className="mx-auto flex h-[100dvh] w-full max-w-md flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-32 pt-[max(env(safe-area-inset-top),1rem)]">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {right}
        </div>
        {children}
      </div>
    </main>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
      <WaterLoader />
      {label && <span className="text-sm font-medium">{label}</span>}
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLang();
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center">
      <p className="text-sm font-medium text-destructive">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-md border border-input px-4 py-2 text-sm font-medium">
          {t("c.retry")}
        </button>
      )}
    </div>
  );
}

/** Sticky bottom dock: the screen's one main action, always reachable one-handed. */
export function ActionDock({ children, tone = "solid" }: { children: ReactNode; tone?: "solid" | "plain" }) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 ${
        tone === "solid" ? "bg-gradient-to-t from-background via-background to-background/0" : ""
      }`}
    >
      {children}
    </div>
  );
}

/** Big primary button for the ActionDock — min 56px tall. */
export function DockButton({
  onClick,
  disabled,
  children,
  tone = "primary",
}: {
  onClick?: () => void;
  disabled?: boolean;
  children: ReactNode;
  tone?: "primary" | "danger" | "quiet";
}) {
  const cls =
    tone === "primary"
      ? "bg-primary text-primary-foreground shadow-soft"
      : tone === "danger"
        ? "bg-destructive text-destructive-foreground"
        : "border border-input bg-card text-foreground";
  return (
    <button
      onClick={() => {
        void haptic("light");
        onClick?.();
      }}
      disabled={disabled}
      className={`w-full rounded-lg py-4 text-base font-bold transition-opacity active:opacity-80 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none ${cls}`}
    >
      {children}
    </button>
  );
}

/** − / + stepper for pack counts: numeric keyboard not needed, big targets. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99999,
  label,
  size = "md",
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
  size?: "md" | "lg";
}) {
  const btn =
    size === "lg"
      ? "h-11 w-11 text-xl font-bold"
      : "h-9 w-9 text-lg font-bold";
  const set = (v: number) => {
    void haptic("light");
    onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
      {label && <span className="pl-2 text-xs font-semibold text-muted-foreground">{label}</span>}
      <button type="button" aria-label="minus" onClick={() => set(value - 1)} disabled={value <= min} className={`${btn} rounded-full bg-background text-foreground shadow-soft disabled:opacity-40`}>
        −
      </button>
      <input
        inputMode="numeric"
        value={String(value)}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value.replace(/\D/g, "")) || 0)))}
        className={`w-14 bg-transparent text-center font-bold text-foreground outline-none ${size === "lg" ? "text-lg" : "text-base"}`}
        aria-label={label ?? "count"}
      />
      <button type="button" aria-label="plus" onClick={() => set(value + 1)} disabled={value >= max} className={`${btn} rounded-full bg-primary text-primary-foreground shadow-soft disabled:opacity-40`}>
        +
      </button>
    </div>
  );
}

/** Camera capture button that uploads to the operations bucket and shows a preview. */
export function PhotoInput({
  userId,
  kind,
  required,
  label,
  value,
  onChange,
}: {
  userId: string;
  kind: string;
  required?: boolean;
  label: string;
  value: string | null;
  onChange: (path: string | null) => void;
}) {
  const { t } = useLang();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!value) {
      setPreview(null);
      return;
    }
    void photoUrl(value).then((u) => alive && setPreview(u));
    return () => {
      alive = false;
    };
  }, [value]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const path = await uploadPhoto(file, userId, kind);
      onChange(path);
      void haptic("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("c.error"));
      // keep a local preview so the flow can continue offline
      try {
        setPreview(await fileToDataUrl(file));
      } catch {
        // ignore
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="mb-1 flex items-center gap-1 text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
      </label>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (isNative()) void takeNativePhoto().then((f) => (f ? void pick(f) : ref.current?.click()));
            else ref.current?.click();
          }}
          disabled={busy}
          className="flex items-center gap-2 rounded-md border border-input bg-card px-4 py-3 text-sm font-semibold text-foreground shadow-card active:bg-accent disabled:opacity-60"
        >
          {busy ? <WaterLoader className="h-5 w-5" /> : preview ? t("c.retake") : t("c.takePhoto")}
        </button>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-14 w-14 rounded-xl border border-border object-cover" />
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {!error && value && <p className="mt-1 text-xs text-muted-foreground">{t("c.photoTaken")}</p>}
    </div>
  );
}

/** Live signed-URL image for a stored photo path. */
export function PhotoImg({ path, className = "" }: { path: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void photoUrl(path).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className={className} />;
}

/** Sign out helper used by headers. */
export function useSignOut() {
  return async () => {
    try {
      await supabase.rpc("record_logout");
    } catch {
      // ignore
    }
    await supabase.auth.signOut();
  };
}
