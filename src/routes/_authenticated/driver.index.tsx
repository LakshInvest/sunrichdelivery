import { HomeScreen, EmptyState, ListFilter, SummaryCard, isTodayTrip } from "@/components/team/role-home";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Truck } from "lucide-react";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { istToday } from "@/lib/ist";
import { useTeamAuth } from "@/lib/team-auth";
import { ErrorCard, Spinner, StatusBadge, SyncBadge } from "@/components/team/ui";

export const Route = createFileRoute("/_authenticated/driver/")({
  validateSearch: (s: Record<string, unknown>): { view?: "trips" } => (s.view === "trips" ? { view: "trips" } : {}),
  head: () => ({
    meta: [
      { title: "My trips · Sunrich Delivery" },
      { name: "description", content: "Your assigned Sunrich delivery trips." },
      { property: "og:title", content: "My trips · Sunrich Delivery" },
      { property: "og:description", content: "Your assigned Sunrich delivery trips." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverHome,
});

type TripRow = { id: string; trip_no: string; trip_date: string; status: string; vehicles: { reg_no: string } | null; trip_stops: { status: string }[] };

function DriverHome() {
  const { t } = useLang();
  const { staff } = useTeamAuth();
  const { view } = Route.useSearch();
  const [rows, setRows] = useState<TripRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"today" | "old">("today");

  const load = useCallback(async () => {
    if (!staff) return;
    setError(null);
    const { data, error: e } = await supabase
      .from("trips")
      .select("id, trip_no, trip_date, status, vehicles(reg_no), trip_stops(status)")
      .eq("driver_user_id", staff.id)
      .in("status", ["planned", "loading", "loaded", "in_progress", "returned"])
      .order("trip_date", { ascending: false })
      .order("trip_no")
      .limit(30);
    if (e) { setError(e.message); setRows([]); return; }
    setRows((data ?? []) as unknown as TripRow[]);
  }, [staff]);

  useLiveRefresh(load, [{ table: "trips" }, { table: "trip_stops" }, { table: "trip_loading" }, { table: "gate_passes" }], "driver-home");

  const today = istToday();
  const todays = (rows ?? []).filter((r) => isTodayTrip(r, today));
  const older = (rows ?? []).filter((r) => !isTodayTrip(r, today));
  const list = filter === "today" ? todays : older;
  if (!view && rows && rows.length === 1 && rows[0]) return <Navigate to="/driver/$tripId" params={{ tripId: rows[0].id }} replace />;
  if (!view && todays.length === 1 && todays[0]) return <Navigate to="/driver/$tripId" params={{ tripId: todays[0].id }} replace />;
  const stopsLeft = todays.reduce((a, r) => a + (r.trip_stops ?? []).filter((s) => s.status !== "delivered").length, 0);
  return (
    <HomeScreen role={t("dr.title")} menu={<SyncBadge />} tabs={{ role: "driver", active: view === "trips" ? "trips" : "today" }}>
      {rows === null && !error ? <Spinner label={t("c.loading")} /> : (
        <>
          {error && <ErrorCard message={error} onRetry={() => void load()} />}
          <SummaryCard title={t("sum.today")} items={[{ label: t("sum.open"), value: todays.length }, { label: t("tab.trips"), value: stopsLeft }]} />
          <ListFilter value={filter} onChange={setFilter} />
          <div className="grid gap-3">
            {list.length > 0 ? list.map((r) => {
              const stops = r.trip_stops ?? [];
              const done = stops.filter((s) => s.status === "delivered").length;
              return (
                <Link key={r.id} to="/driver/$tripId" params={{ tripId: r.id }} className="home-card block p-5 active:scale-[0.99]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-display text-base font-bold text-foreground">{t("ld.trip", { no: r.trip_no })}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    {r.vehicles?.reg_no && <span className="font-semibold text-foreground">{r.vehicles.reg_no}</span>}
                    <span>{r.trip_date}</span>
                    <span className="font-semibold text-primary">{t("dr.deliveredStops", { done, total: stops.length })}</span>
                  </div>
                </Link>
              );
            }) : <EmptyState icon={Truck} text={t(filter === "today" ? "dr.noTripsToday" : "dr.noOld")} />}
          </div>
        </>
      )}
    </HomeScreen>
  );
}
