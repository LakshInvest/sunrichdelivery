// Shared mobile UI pieces for the Team app screens.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LANGS, useLang } from "@/lib/l10n";
import { pendingCount, subscribe } from "@/lib/offline";
import { supabase } from "@/integrations/supabase/client";
import { fileToDataUrl, photoUrl, uploadPhoto } from "@/lib/photo";

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
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
            lang === l.code ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"
          }`}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}

export function SyncBadge() {
  const { t } = useLang();
  const [n, setN] = useState(pendingCount());
  useEffect(() => subscribe(() => setN(pendingCount())), []);
  if (n === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      {t("c.pendingSync", { n })}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLang();
  const key = `st.${status}`;
  const label = t(key);
  const tone =
    status === "in_progress"
      ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
      : status === "delivered" || status === "settled" || status === "loaded"
        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
        : status === "failed" || status === "cancelled"
          ? "bg-red-500/15 text-red-700 dark:text-red-300"
          : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>;
}

export function Screen({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 pb-24 pt-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight text-foreground">{title}</h1>
        {right}
      </div>
      {children}
    </main>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useLang();
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center">
      <p className="text-sm font-medium text-destructive">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 rounded-lg border border-input px-4 py-2 text-sm font-medium">
          {t("c.retry")}
        </button>
      )}
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
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium text-foreground active:bg-accent disabled:opacity-60"
        >
          {busy ? t("c.loading") : preview ? t("c.retake") : t("c.takePhoto")}
        </button>
        {preview && (
          <img src={preview} alt="" className="h-12 w-12 rounded-lg border border-border object-cover" />
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
