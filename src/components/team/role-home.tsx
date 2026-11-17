import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Sun, ListChecks, UserRound, Boxes, Undo2, ScanLine, BookOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { AvatarLink } from "@/components/team/ui";

const locales = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" } as const;

/** Role home (driver D1, loader L1, guard G1): navy header, no back arrow, avatar → Profile. */
export type RoleTab = { key: string; label: string; icon: LucideIcon; to: string; search?: Record<string, string>; params?: Record<string, string> };
export type TabRole = "driver" | "loader" | "security";
export function roleTabs(role: TabRole): Omit<RoleTab, "label">[] {
  if (role === "driver") return [{ key: "today", icon: Sun, to: "/driver" }, { key: "trips", icon: ListChecks, to: "/driver", search: { view: "trips" } }, { key: "profile", icon: UserRound, to: "/profile" }];
  if (role === "loader") return [{ key: "load", icon: Boxes, to: "/loader" }, { key: "returns", icon: Undo2, to: "/loader", search: { view: "returns" } }, { key: "profile", icon: UserRound, to: "/profile" }];
  return [{ key: "gate", icon: ScanLine, to: "/security" }, { key: "register", icon: BookOpen, to: "/security/$step", params: { step: "register" } }, { key: "profile", icon: UserRound, to: "/profile" }];
}

/** Customer-app BottomNav, shown only on role home tabs (never on inner task pages). */
export function BottomNav({ role, active }: { role: TabRole; active: string }) {
  const { t } = useLang();
  return (
    <nav className="bottom-nav" aria-label={t("sec.menu")} data-testid="bottom-nav">
      <div className="mx-auto flex max-w-md">
        {roleTabs(role).map(({ key, icon: Icon, to, search, params }) => {
          const on = key === active;
          return (
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            <Link key={key} to={to as any} search={(search ?? {}) as any} params={(params ?? {}) as any} aria-current={on ? "page" : undefined}
              className={`relative flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors ${on ? "font-bold text-secondary" : "font-medium text-muted-foreground"}`}>
              <span className={`relative flex h-8 w-14 items-center justify-center rounded-full transition-all ${on ? "-translate-y-0.5 bg-secondary/15 shadow-sm" : ""}`}>
                <Icon className="h-6 w-6" fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.2 : 0} strokeWidth={on ? 2.4 : 1.8} aria-hidden />
              </span>
              <span className="whitespace-nowrap">{t(`tab.${key}`)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** One line summary tiles under the header so a home never looks empty. */
export function SummaryCard({ title, items }: { title: string; items: { label: string; value: number | string; onClick?: () => void }[] }) {
  return (
    <section className="home-card p-4" data-testid="summary-card">
      <h2 className="text-sm font-bold text-muted-foreground">{title}</h2>
      <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => { const body = <><p className="font-display text-2xl font-bold text-primary">{it.value}</p><p className="line-clamp-2 text-xs font-semibold leading-tight text-muted-foreground [overflow-wrap:anywhere]">{it.label}</p></>; return it.onClick ? <button key={it.label} type="button" onClick={it.onClick} className="min-w-0 rounded-xl bg-secondary/10 p-3 text-left active:scale-95">{body}</button> : <div key={it.label} className="min-w-0 rounded-xl bg-secondary/10 p-3">{body}</div>; })}
      </div>
    </section>
  );
}

/** Today / Older filter chips for trip lists. */
export function ListFilter({ value, onChange }: { value: "today" | "old"; onChange: (v: "today" | "old") => void }) {
  const { t } = useLang();
  return (
    <div className="flex gap-2" role="group">
      {(["today", "old"] as const).map((v) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
        className={`min-h-11 whitespace-nowrap rounded-full px-5 text-sm font-semibold transition active:scale-95 ${value === v ? "bg-primary text-primary-foreground shadow-sm" : "border border-border bg-card text-foreground"}`}>{t(v === "today" ? "list.today" : "list.old")}</button>)}
    </div>
  );
}

/** Older and QA trips go under "Purane"; the default list is today's open work. */
export function isTodayTrip(r: { trip_date: string; trip_no: string; vehicles?: { reg_no: string } | null }, today: string) {
  const qa = /^QA[-\s]/i.test(r.trip_no) || /^QA[-\s]/i.test(r.vehicles?.reg_no ?? "");
  return !qa && r.trip_date >= today;
}

export function HomeScreen({ role, menu, stats, children, action, tabs }: { role: string; menu?: ReactNode; stats?: ReactNode; children: ReactNode; action?: ReactNode; tabs?: { role: TabRole; active: string } }) {
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
              <h1 className="mt-1 break-words font-display text-xl font-bold leading-tight">{t("home.greeting", { name: staff?.fullName?.split(" ")[0] ?? "" })}</h1>
              <p className="mt-1 break-words text-sm opacity-80">{[unit, date].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">{menu}</div>
          </div>
        </header>
        {stats && <div className="relative -mt-12 grid grid-cols-2 gap-3 px-4">{stats}</div>}
        <div className="grid gap-4 px-4 pt-4">{children}</div>
      </div>
      {action && <footer className="task-action" data-testid="task-action">{action}</footer>}
      {tabs && <BottomNav role={tabs.role} active={tabs.active} />}
    </main>
  );
}

export function StatCard({ icon: Icon, value, label, to, step }: { icon: LucideIcon; value: number; label: string; to: "/security/$step"; step: string }) {
  return (
    <Link to={to} params={{ step }} className="home-card flex min-h-24 flex-col justify-between gap-2 p-4 active:scale-[0.98]">
      <span className="flex items-center justify-between gap-2"><span className="font-display text-2xl font-bold text-primary">{value}</span><span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary/10 text-secondary"><Icon className="h-5 w-5" aria-hidden /></span></span>
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

/** Customer-app EmptyState: aqua icon circle and one friendly line. */
export function EmptyState({ icon: Icon, text, body }: { icon: LucideIcon; text: string; body?: string }) {
  return (
    <div className="flex flex-col items-center px-8 py-12 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/10"><Icon className="h-8 w-8 text-secondary" aria-hidden /></span>
      <p className="mt-4 text-base font-semibold text-foreground">{text}</p>
      {body && <p className="mt-1 max-w-72 text-sm text-muted-foreground">{body}</p>}
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
