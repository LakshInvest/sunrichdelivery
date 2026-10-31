import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { ErrorCard, Screen, Spinner, StatusBadge } from "@/components/team/ui";
import { queueRpc } from "@/lib/offline";

export const Route = createFileRoute("/_authenticated/security")({
  head: () => ({
    meta: [
      { title: "Security gate · Sunrich Team" },
      { name: "description", content: "Record gate out, gate in and the gate log." },
      { property: "og:title", content: "Security gate · Sunrich Team" },
      { property: "og:description", content: "Record gate out, gate in and the gate log." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SecurityGate,
});

type Tab = "out" | "in" | "log";

type OutTrip = { id: string; trip_no: string; gate_out_at: string | null; gate_in_at: string | null; status: string; vehicles: { reg_no: string } | null };
type LogRow = {
  id: string;
  pass_no: string;
  qr_token: string;
  issued_at: string;
  trips: { trip_no: string; gate_out_at: string | null; gate_in_at: string | null; vehicles: { reg_no: string } | null } | null;
};

function fmt(dt: string | null | undefined): string {
  if (!dt) return "—";
  const d = new Date(dt);
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function SecurityGate() {
  const { t } = useLang();
  const [tab, setTab] = useState<Tab>("out");
  const [token, setToken] = useState("");
  const [odo, setOdo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [outTrips, setOutTrips] = useState<OutTrip[] | null>(null);
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const fetchLists = useCallback(async () => {
    setListError(null);
    const [tripsRes, logRes] = await Promise.all([
      supabase
        .from("trips")
        .select("id, trip_no, status, gate_out_at, gate_in_at, vehicles(reg_no)")
        .not("gate_out_at", "is", null)
        .is("gate_in_at", null)
        .in("status", ["loaded", "in_progress", "returned"])
        .order("trip_no"),
      supabase
        .from("gate_passes")
        .select("id, pass_no, qr_token, issued_at, trips(trip_no, gate_out_at, gate_in_at, vehicles(reg_no))")
        .order("issued_at", { ascending: false })
        .limit(25),
    ]);
    if (tripsRes.error || logRes.error) {
      setListError(tripsRes.error?.message ?? logRes.error?.message ?? t("c.error"));
      setOutTrips([]);
      setLog([]);
      return;
    }
    setOutTrips((tripsRes.data ?? []) as unknown as OutTrip[]);
    setLog((logRes.data ?? []) as unknown as LogRow[]);
  }, [t]);

  useEffect(() => {
    void fetchLists();
  }, [fetchLists]);

  const gateOut = async () => {
    if (busy) return;
    setMsg(null);
    setError(null);
    const clean = token.trim();
    if (!clean) {
      setError(t("sec.scanToken"));
      return;
    }
    setBusy(true);
    const res = await queueRpc("gate_out", { p_qr_token: clean, p_odometer: odo === "" ? null : Number(odo) });
    setBusy(false);
    if (res.queued) {
      setMsg(t("c.tryAgainOffline"));
      return;
    }
    if (res.error) {
      setError(res.error);
      return;
    }
    setMsg(t("sec.gateOutDone"));
    setToken("");
    setOdo("");
    await fetchLists();
  };

  const gateIn = async (tripId: string, odometer: string, fuelL: string, fuelA: string) => {
    const res = await queueRpc("gate_in", {
      p_trip_id: tripId,
      p_odometer: odometer === "" ? null : Number(odometer),
      p_fuel_litres: fuelL === "" ? null : Number(fuelL),
      p_fuel_amount: fuelA === "" ? null : Number(fuelA),
    });
    if (res.queued) return t("c.tryAgainOffline");
    if (res.error) throw new Error(res.error);
    await fetchLists();
    return t("sec.gateInDone");
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "out", label: t("sec.gateOut") },
    { id: "in", label: t("sec.gateIn") },
    { id: "log", label: t("sec.gateLog") },
  ];

  return (
    <Screen title={t("sec.title")}>
      <div className="mb-4 flex rounded-lg bg-muted p-1">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => {
              setTab(x.id);
              setMsg(null);
              setError(null);
            }}
            className={`flex-1 rounded-md px-2 py-2 text-sm font-semibold transition-colors ${
              tab === x.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {msg && <p className="mb-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">{msg}</p>}
      {error && <div className="mb-4"><ErrorCard message={error} /></div>}

      {tab === "out" && (
        <div className="rounded-xl border border-border bg-card p-4">
          <label className="mb-1 block text-sm font-medium text-foreground">{t("sec.scanToken")}</label>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t("sec.tokenPlaceholder")}
            className="w-full rounded-lg border border-input bg-background px-3 py-3 font-mono text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <label className="mb-1 mt-3 block text-sm font-medium text-foreground">{t("sec.odometerOptional")}</label>
          <input
            inputMode="numeric"
            value={odo}
            onChange={(e) => setOdo(e.target.value.replace(/\D/g, ""))}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={() => void gateOut()}
            disabled={busy}
            className="mt-4 w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60"
          >
            {busy ? t("c.loading") : t("sec.gateOut")}
          </button>
        </div>
      )}

      {tab === "in" && (
        <div className="grid gap-3">
          {listError && <ErrorCard message={listError} onRetry={() => void fetchLists()} />}
          {outTrips === null && <Spinner label={t("c.loading")} />}
          {outTrips && outTrips.length === 0 && <p className="py-4 text-sm text-muted-foreground">{t("sec.noTrips")}</p>}
          {outTrips?.map((r) => (
            <GateInCard key={r.id} trip={r} onConfirm={gateIn} />
          ))}
        </div>
      )}

      {tab === "log" && (
        <div className="grid gap-2">
          {listError && <ErrorCard message={listError} onRetry={() => void fetchLists()} />}
          {log === null && <Spinner label={t("c.loading")} />}
          {log && log.length === 0 && <p className="py-4 text-sm text-muted-foreground">{t("c.none")}</p>}
          {log?.map((r) => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-foreground">{r.pass_no}</span>
                <StatusBadge status={r.trips?.gate_in_at ? "settled" : "in_progress"} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("sec.logTrip")}: {r.trips?.trip_no ?? "—"}
                {r.trips?.vehicles?.reg_no ? ` · ${r.trips.vehicles.reg_no}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("sec.logOut")}: {fmt(r.trips?.gate_out_at)} · {t("sec.logIn")}: {fmt(r.trips?.gate_in_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

function GateInCard({
  trip,
  onConfirm,
}: {
  trip: OutTrip;
  onConfirm: (tripId: string, odo: string, fuelL: string, fuelA: string) => Promise<string>;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [odo, setOdo] = useState("");
  const [fuelL, setFuelL] = useState("");
  const [fuelA, setFuelA] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      setMsg(await onConfirm(trip.id, odo, fuelL, fuelA));
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("c.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left">
        <div>
          <span className="text-sm font-semibold text-foreground">{t("ld.trip", { no: trip.trip_no })}</span>
          {trip.vehicles?.reg_no && <span className="ml-2 text-xs text-muted-foreground">{trip.vehicles.reg_no}</span>}
        </div>
        <StatusBadge status={trip.status} />
      </button>
      {open && (
        <div className="mt-3 grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">{t("sec.odometer")}</label>
            <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ""))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">{t("sec.fuelLitres")}</label>
              <input inputMode="decimal" value={fuelL} onChange={(e) => setFuelL(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">{t("sec.fuelAmount")}</label>
              <input inputMode="decimal" value={fuelA} onChange={(e) => setFuelA(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
          </div>
          {msg && <p className="text-xs font-medium text-emerald-600">{msg}</p>}
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <button onClick={() => void confirm()} disabled={busy} className="rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60">
            {busy ? t("c.loading") : t("sec.gateIn")}
          </button>
        </div>
      )}
    </div>
  );
}
