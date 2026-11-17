import { HomeScreen, EmptyState, ListFilter, SummaryCard, isTodayTrip } from "@/components/team/role-home";
import { Boxes, Undo2 } from "lucide-react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { istToday } from "@/lib/ist";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { ErrorCard, Spinner, StatusBadge, SyncBadge } from "@/components/team/ui";

export const Route = createFileRoute("/_authenticated/loader/")({
  validateSearch: (s: Record<string, unknown>): { view?: "returns" } => (s["view"] === "returns" ? { view: "returns" } : {}),
  head: () => ({
    meta: [
      { title: "Loading bay · Sunrich Delivery" },
      { name: "description", content: "Load vehicles for today's Sunrich trips." },
      { property: "og:title", content: "Loading bay · Sunrich Delivery" },
      { property: "og:description", content: "Load vehicles for today's Sunrich trips." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoaderHome,
});

type TripRow = {
  id: string; trip_no: string; trip_date: string; status: string; gate_in_at: string | null; returns_received_at: string | null;
  vehicles: { reg_no: string } | null; geo_routes: { name: string } | null; trip_stops: { count: number }[];
};
const cols = "id, trip_no, trip_date, status, gate_in_at, returns_received_at, vehicles(reg_no), geo_routes(name), trip_stops(count)";

function LoaderHome() {
  const { t } = useLang();
  const { view } = Route.useSearch();
  const navigate = useNavigate();
  const [open, setOpen] = useState<TripRow[] | null>(null);
  const [done, setDone] = useState<TripRow[]>([]);
  const [back, setBack] = useState<TripRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"today" | "old">("today");

  const load = useCallback(async () => {
    setError(null);
    const today = istToday();
    const [o, d, r] = await Promise.all([
      supabase.from("trips").select(cols).in("status", ["planned", "loading"]).order("trip_date").order("trip_no"),
      supabase.from("trips").select(cols).in("status", ["loaded", "in_progress", "returned", "settled"]).gte("trip_date", today).order("trip_no"),
      supabase.from("trips").select(cols).in("status", ["in_progress", "returned"]).not("gate_in_at", "is", null).is("returns_received_at", null).order("trip_date").order("trip_no"),
    ]);
    const e = o.error ?? d.error ?? r.error;
    if (e) { setError(e.message ?? t("c.error")); setOpen([]); return; }
    setOpen((o.data ?? []) as unknown as TripRow[]);
    setDone((d.data ?? []) as unknown as TripRow[]);
    setBack((r.data ?? []) as unknown as TripRow[]);
  }, [t]);

  useLiveRefresh(load, [{ table: "trips" }, { table: "trip_stops" }, { table: "trip_loading" }, { table: "gate_passes" }], "loader-home");

  const today = istToday();
  const source = view === "returns" ? back : (open ?? []);
  const list = source.filter((r) => (filter === "today") === isTodayTrip(r, today));
  const card = (r: TripRow) => (
    <Link key={r.id} to={view === "returns" ? "/loader/$tripId/$step" : "/loader/$tripId"} params={view === "returns" ? { tripId: r.id, step: "returns" } : { tripId: r.id }} className="home-card block p-5 active:scale-[0.99]">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-display text-base font-bold text-foreground">{t("ld.trip", { no: r.trip_no })}</span>
        <StatusBadge status={r.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {r.vehicles?.reg_no && <span className="font-semibold text-foreground">{r.vehicles.reg_no}</span>}
        {r.geo_routes?.name && <span>{r.geo_routes.name}</span>}
        <span className="font-semibold text-primary">{t((r.trip_stops?.[0]?.count ?? 0) === 1 ? "ld.stops1" : "ld.stops", { n: r.trip_stops?.[0]?.count ?? 0 })}</span>
      </div>
    </Link>
  );

  return (
    <HomeScreen role={t("ld.title")} menu={<SyncBadge />} tabs={{ role: "loader", active: view === "returns" ? "returns" : "load" }}>
      {open === null && !error ? <Spinner label={t("c.loading")} /> : (
        <>
          {error && <ErrorCard message={error} onRetry={() => void load()} />}
          <SummaryCard title={t("sum.today")} items={[
            { label: t("sum.open"), value: (open ?? []).filter((r) => isTodayTrip(r, today)).length, onClick: () => void navigate({ to: "/loader", search: {} }) },
            { label: t("sum.done"), value: done.filter((r) => isTodayTrip(r, today)).length },
            { label: t("sum.returns"), value: back.length, onClick: () => void navigate({ to: "/loader", search: { view: "returns" } }) },
          ]} />
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t(view === "returns" ? "ld.returns" : "ld.toLoad")}</h2>
          <ListFilter value={filter} onChange={setFilter} />
          <div className="grid gap-3">
            {list.length > 0 ? list.map(card) : view === "returns" ? <EmptyState icon={Undo2} text={t("ld.noReturns")} /> : <EmptyState icon={Boxes} text={t(filter === "today" ? "empty.loadToday" : "dr.noOld")} />}
          </div>
          {view !== "returns" && done.some((r) => (filter === "today") === isTodayTrip(r, today)) && <>
            <h2 className="mt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("ld.loadedToday")}</h2>
            <div className="grid gap-3">{done.filter((r) => (filter === "today") === isTodayTrip(r, today)).map(card)}</div>
          </>}
        </>
      )}
    </HomeScreen>
  );
}
