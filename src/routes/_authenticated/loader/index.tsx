import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { istToday } from "@/lib/ist";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { ErrorCard, Screen, Spinner, StatusBadge, SyncBadge } from "@/components/team/ui";

export const Route = createFileRoute("/_authenticated/loader/")({
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
    const today = istToday();
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
      className="block rounded-xl border border-border bg-card p-5 shadow-card transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-base font-bold text-foreground">{t("ld.trip", { no: r.trip_no })}</span>
        <StatusBadge status={r.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {r.vehicles?.reg_no && <span className="font-semibold text-foreground">{r.vehicles.reg_no}</span>}
        {r.geo_routes?.name && <span>{r.geo_routes.name}</span>}
        <span className="font-semibold text-navy">{t("ld.stops", { n: r.trip_stops?.[0]?.count ?? 0 })}</span>
      </div>
    </Link>
  );

  return (
    <Screen title={t("ld.title")} right={<SyncBadge />}>
      {rows === null && !error ? (
        <Spinner label={t("c.loading")} />
      ) : (
        <>
          {error && <div className="mb-4"><ErrorCard message={error} onRetry={() => void load()} /></div>}
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("ld.toLoad")}</h2>
          <div className="grid gap-3">
            {rows && rows.length > 0 ? rows.map(card) : <p className="py-4 text-sm text-muted-foreground">{t("c.none")}</p>}
          </div>
          <h2 className="mb-2 mt-7 text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("ld.loadedToday")}</h2>
          <div className="grid gap-3">
            {doneRows && doneRows.length > 0 ? doneRows.map(card) : <p className="py-4 text-sm text-muted-foreground">{t("c.none")}</p>}
          </div>
        </>
      )}
    </Screen>
  );
}
