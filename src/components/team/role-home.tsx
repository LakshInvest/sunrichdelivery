import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { AvatarLink } from "@/components/team/ui";

const locales = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" } as const;

/** Role home (driver D1, loader L1, guard G1): navy header, no back arrow, avatar → Profile. */
export function HomeScreen({ role, menu, stats, children, action }: { role: string; menu?: ReactNode; stats?: ReactNode; children: ReactNode; action?: ReactNode }) {
  const { staff } = useTeamAuth();
  const { t, lang } = useLang();
  const [unit, setUnit] = useState<string | null>(null);
  useEffect(() => {
    if (!staff?.unitId) return;
    void supabase.from("units").select("name").eq("id", staff.unitId).maybeSingle().then(({ data }) => setUnit((data as { name?: string } | null)?.name ?? null));
  }, [staff?.unitId]);
  const date = new Intl.DateTimeFormat(locales[lang] ?? "en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date());
  return (
    <main className="home-screen">
      <div className="home-scroll">
        <header className={`home-hero ${stats ? "pb-16" : "pb-7"}`}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-aqua">{role}</p>
              <h1 className="mt-1 break-words font-display text-2xl font-bold">{t("home.greeting", { name: staff?.fullName?.split(" ")[0] ?? "" })}</h1>
              <p className="mt-1 break-words text-sm opacity-80">{[unit, date].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">{menu}<AvatarLink className="bg-aqua text-navy" /></div>
          </div>
        </header>
        {stats && <div className="relative -mt-12 grid grid-cols-2 gap-3 px-4">{stats}</div>}
        <div className="grid gap-4 px-4 pt-4">{children}</div>
      </div>
      {action && <footer className="task-action" data-testid="task-action">{action}</footer>}
    </main>
  );
}

export function StatCard({ icon: Icon, value, label, to, step }: { icon: LucideIcon; value: number; label: string; to: "/security/$step"; step: string }) {
  return (
    <Link to={to} params={{ step }} className="home-card flex min-h-24 flex-col justify-between gap-2 p-4 active:scale-[0.98]">
      <span className="flex items-center justify-between gap-2"><span className="font-display text-3xl font-bold text-navy">{value}</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-navy"><Icon className="h-5 w-5" aria-hidden /></span></span>
      <span className="break-words text-sm font-semibold text-muted-foreground">{label}</span>
    </Link>
  );
}

export function TileLink({ icon: Icon, label, to, params }: { icon: LucideIcon; label: string; to: "/security/$step"; params: { step: string } }) {
  return (
    <Link to={to} params={params} className="home-card flex min-h-28 flex-col items-center justify-center gap-2 p-4 text-center active:scale-[0.98]">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-accent text-navy"><Icon className="h-6 w-6" aria-hidden /></span>
      <span className="break-words text-lg font-bold">{label}</span>
    </Link>
  );
}

/** Friendly empty state: an icon and one line. */
export function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="home-card flex flex-col items-center gap-3 px-4 py-10 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-secondary text-navy"><Icon className="h-7 w-7" aria-hidden /></span>
      <p className="text-lg font-semibold text-muted-foreground">{text}</p>
    </div>
  );
}
