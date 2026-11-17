import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
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
        <header className={`home-hero ${stats ? "pb-20" : "pb-7"}`}>
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
      <span className="flex items-center justify-between gap-2"><span className="font-display text-3xl font-bold text-navy">{value}</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary/10 text-secondary"><Icon className="h-5 w-5" aria-hidden /></span></span>
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
      <span className="grid h-14 w-14 place-items-center rounded-full bg-secondary/10 text-secondary"><Icon className="h-7 w-7" aria-hidden /></span>
      <p className="text-lg font-semibold text-muted-foreground">{text}</p>
    </div>
  );
}

/** Driver home: "Trip 1 of 2 ▾" when the driver has more than one open trip; hidden with one. */
export function DriverTripPicker({ tripId }: { tripId: string }) {
  const { staff } = useTeamAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<{ id: string; trip_no: string; reg: string | null }[]>([]);
  useEffect(() => {
    if (!staff) return;
    void supabase.from("trips").select("id,trip_no,vehicles(reg_no)").eq("driver_user_id", staff.id)
      .in("status", ["planned", "loading", "loaded", "in_progress", "returned"]).order("trip_date").order("trip_no").limit(10)
      .then(({ data }) => setTrips(((data ?? []) as unknown as { id: string; trip_no: string; vehicles: { reg_no: string } | null }[]).map((r) => ({ id: r.id, trip_no: r.trip_no, reg: r.vehicles?.reg_no ?? null }))));
  }, [staff, tripId]);
  if (trips.length < 2) return null;
  const i = Math.max(0, trips.findIndex((r) => r.id === tripId));
  return (
    <label className="home-card relative flex min-h-14 items-center gap-2 px-4" data-testid="trip-picker">
      <span className="flex-1 text-lg font-bold">{t("dr.tripOf", { i: i + 1, n: trips.length })}</span>
      <ChevronDown className="h-5 w-5 text-navy" aria-hidden />
      <select aria-label={t("dr.tripOf", { i: i + 1, n: trips.length })} className="absolute inset-0 opacity-0" value={tripId}
        onChange={(e) => void navigate({ to: "/driver/$tripId", params: { tripId: e.target.value } })}>
        {trips.map((r, k) => <option key={r.id} value={r.id}>{`${k + 1}. ${r.reg ?? ""} · ${r.trip_no}`}</option>)}
      </select>
    </label>
  );
}
