import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { ErrorCard, Screen, Spinner, StatusBadge } from "@/components/team/ui";

export const Route = createFileRoute("/_authenticated/driver")({
  head: () => ({
    meta: [
      { title: "My trips · Sunrich Team" },
      { name: "description", content: "Your assigned Sunrich delivery trips." },
      { property: "og:title", content: "My trips · Sunrich Team" },
      { property: "og:description", content: "Your assigned Sunrich delivery trips." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DriverHome,
});

type TripRow = {
  id: string;
  trip_no: string;
  trip_date: string;
  status: string;
  vehicles: { reg_no: string } | null;
  trip_stops: { status: string }[];
};

function DriverHome() {
  const { t } = useLang();
  const { staff } = useTeamAuth();
  const [rows, setRows] = useState<TripRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    if (e) {
      setError(e.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as TripRow[]);
  }, [staff]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen title={t("dr.title")}>
      {rows === null && !error ? (
        <Spinner label={t("c.loading")} />
      ) : (
        <>
          {error && <div className="mb-4"><ErrorCard message={error} onRetry={() => void load()} /></div>}
          <div className="grid gap-2">
            {rows && rows.length > 0 ? (
              rows.map((r) => {
                const stops = r.trip_stops ?? [];
                const done = stops.filter((s) => s.status === "delivered").length;
                return (
                  <Link
                    key={r.id}
                    to="/driver/$tripId"
                    params={{ tripId: r.id }}
                    className="block rounded-xl border border-border bg-card p-4 transition-colors active:bg-accent"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-foreground">{t("ld.trip", { no: r.trip_no })}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {r.vehicles?.reg_no ? `${r.vehicles.reg_no} · ` : ""}
                      {r.trip_date} · {t("dr.deliveredStops", { done, total: stops.length })}
                    </div>
                  </Link>
                );
              })
            ) : (
              <p className="py-4 text-sm text-muted-foreground">{t("dr.noTrips")}</p>
            )}
          </div>
        </>
      )}
    </Screen>
  );
}
