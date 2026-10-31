import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { ErrorCard, Screen, Spinner, StatusBadge } from "@/components/team/ui";

export const Route = createFileRoute("/_authenticated/loader/")({
  head: () => ({
    meta: [
      { title: "Loading bay · Sunrich Team" },
      { name: "description", content: "Load vehicles for today's Sunrich trips." },
      { property: "og:title", content: "Loading bay · Sunrich Team" },
      { property: "og:description", content: "Load vehicles for today's Sunrich trips." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoaderHome,
});

type TripRow = {
  id: string;
  trip_no: string;
  trip_date: string;
  status: string;
  vehicles: { reg_no: string } | null;
  geo_routes: { name: string } | null;
  units: { name: string } | null;
  trip_stops: { count: number }[];
};

function LoaderHome() {
  const { t } = useLang();
  const [rows, setRows] = useState<TripRow[] | null>(null);
  const [doneRows, setDoneRows] = useState<TripRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const [open, done] = await Promise.all([
      supabase
        .from("trips")
        .select("id, trip_no, trip_date, status, vehicles(reg_no), geo_routes(name), units(name), trip_stops(count)")
        .in("status", ["planned", "loading"])
        .order("trip_date")
        .order("trip_no"),
      supabase
        .from("trips")
        .select("id, trip_no, trip_date, status, vehicles(reg_no), geo_routes(name), units(name), trip_stops(count)")
        .in("status", ["loaded", "in_progress", "returned", "settled"])
        .gte("trip_date", today)
        .order("trip_no"),
    ]);
    if (open.error || done.error) {
      setError(open.error?.message ?? done.error?.message ?? t("c.error"));
      setRows([]);
      setDoneRows([]);
      return;
    }
    setRows((open.data ?? []) as unknown as TripRow[]);
    setDoneRows((done.data ?? []) as unknown as TripRow[]);
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const card = (r: TripRow) => (
    <Link
      key={r.id}
      to="/loader/$tripId"
      params={{ tripId: r.id }}
      className="block rounded-xl border border-border bg-card p-4 transition-colors active:bg-accent"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{t("ld.trip", { no: r.trip_no })}</span>
        <StatusBadge status={r.status} />
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {r.vehicles?.reg_no ? `${t("ld.vehicle")}: ${r.vehicles.reg_no}` : ""}
        {r.geo_routes?.name ? ` · ${t("ld.route")}: ${r.geo_routes.name}` : ""}
        {` · ${t("ld.stops", { n: r.trip_stops?.[0]?.count ?? 0 })}`}
      </div>
    </Link>
  );

  return (
    <Screen title={t("ld.title")}>
      {rows === null && !error ? (
        <Spinner label={t("c.loading")} />
      ) : (
        <>
          {error && <div className="mb-4"><ErrorCard message={error} onRetry={() => void load()} /></div>}
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("ld.toLoad")}</h2>
          <div className="grid gap-2">
            {rows && rows.length > 0 ? rows.map(card) : <p className="py-4 text-sm text-muted-foreground">{t("c.none")}</p>}
          </div>
          <h2 className="mb-2 mt-6 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("ld.loadedToday")}</h2>
          <div className="grid gap-2">
            {doneRows && doneRows.length > 0 ? doneRows.map(card) : <p className="py-4 text-sm text-muted-foreground">{t("c.none")}</p>}
          </div>
        </>
      )}
    </Screen>
  );
}
