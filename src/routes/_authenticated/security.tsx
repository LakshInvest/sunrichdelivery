import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { istDisplay } from "@/lib/ist";
import { ErrorCard, Screen, Spinner, StatusBadge, SyncBadge, ActionDock, DockButton } from "@/components/team/ui";
import { queueRpc } from "@/lib/offline";
import { haptic, isNative, scanQr } from "@/lib/native";
import { ScanLine, LogOut, LogIn, ClipboardList, PackageCheck } from "lucide-react";
import { friendlyError } from "@/lib/friendly-error";

export const Route = createFileRoute("/_authenticated/security")({
  head: () => ({
    meta: [
      { title: "Security gate · Sunrich Delivery" },
      { name: "description", content: "Record gate out, gate in and the gate log." },
      { property: "og:title", content: "Security gate · Sunrich Delivery" },
      { property: "og:description", content: "Record gate out, gate in and the gate log." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SecurityGate,
});

type Tab = "out" | "in" | "log" | "pickup";

type OutTrip = { id: string; trip_no: string; gate_out_at: string | null; gate_in_at: string | null; status: string; vehicles: { reg_no: string } | null };
type PickupOrder = {
  id: string;
  order_no: string;
  delivery_otp: string | null;
  grand_total: number | null;
  payment_status: string;
  customers: { business_name: string | null; contact_name: string | null } | null;
};
type LogRow = {
  id: string;
  pass_no: string;
  qr_token: string;
  issued_at: string;
  trips: { trip_no: string; gate_out_at: string | null; gate_in_at: string | null; vehicles: { reg_no: string } | null } | null;
};

function fmt(dt: string | null | undefined): string {
  return istDisplay(dt);
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
  const [pickups, setPickups] = useState<PickupOrder[] | null>(null);
  const [pickupOrder, setPickupOrder] = useState("");
  const [pickupOtp, setPickupOtp] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const tokenInput = useRef<HTMLInputElement>(null);

  const fetchLists = useCallback(async () => {
    setListError(null);
    const [tripsRes, logRes, pickRes] = await Promise.all([
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
      supabase
        .from("orders")
        .select("id, order_no, delivery_otp, grand_total, payment_status, customers!orders_customer_id_fkey(business_name, contact_name)")
        .eq("delivery_mode", "pickup")
        .in("status", ["approved", "processing"])
        .order("order_no"),
    ]);
    if (tripsRes.error || logRes.error || pickRes.error) {
      setListError(tripsRes.error?.message ?? logRes.error?.message ?? pickRes.error?.message ?? t("c.error"));
      setOutTrips([]);
      setLog([]);
      setPickups([]);
      return;
    }
    setOutTrips((tripsRes.data ?? []) as unknown as OutTrip[]);
    setLog((logRes.data ?? []) as unknown as LogRow[]);
    setPickups((pickRes.data ?? []) as unknown as PickupOrder[]);
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
      setError(friendlyError(res.error, t));
      return;
    }
    void haptic("success");
    await confirmTrip(res.data);
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
    if (res.error) throw new Error(friendlyError(res.error, t));
    void haptic("success");
    await fetchLists();
    return t("sec.gateInDone");
  };

  const pickupHandover = async () => {
    if (busy) return;
    setMsg(null);
    setError(null);
    if (!pickupOrder.trim() || !pickupOtp.trim()) {
      setError(t("sec.pickupSub"));
      return;
    }
    setBusy(true);
    const res = await queueRpc("gate_pickup_handover", { p_order_no: pickupOrder.trim(), p_otp: pickupOtp.trim() });
    setBusy(false);
    if (res.queued) {
      setMsg(t("c.tryAgainOffline"));
      return;
    }
    if (res.error) {
      setError(friendlyError(res.error, t));
      return;
    }
    void haptic("success");
    setMsg(`${t("sec.pickupDone")}: ${pickupOrder.trim()}`);
    setPickupOrder("");
    setPickupOtp("");
    await fetchLists();
  };

  const startScan = async () => {
    if (isNative()) {
      const v = await scanQr();
      if (v) {
        void haptic("success");
        setToken(v.trim());
        void gateOutWith(v.trim());
      }
    } else {
      tokenInput.current?.focus();
    }
  };

  const gateOutWith = async (tok: string) => {
    if (busy) return;
    setMsg(null);
    setError(null);
    setBusy(true);
    const res = await queueRpc("gate_out", { p_qr_token: tok, p_odometer: odo === "" ? null : Number(odo) });
    setBusy(false);
    if (res.queued) {
      setMsg(t("c.tryAgainOffline"));
      return;
    }
    if (res.error) {
      setError(friendlyError(res.error, t));
      return;
    }
    void haptic("success");
    await confirmTrip(res.data);
    setMsg(t("sec.gateOutDone"));
    setToken("");
    await fetchLists();
  };

  const [confirm, setConfirm] = useState<{ no: string; reg: string } | null>(null);
  const confirmTrip = async (tripId: unknown) => {
    if (typeof tripId !== "string") return;
    const r = await supabase.from("trips").select("trip_no, vehicles(reg_no)").eq("id", tripId).maybeSingle();
    const d = r.data as unknown as { trip_no: string; vehicles: { reg_no: string } | null } | null;
    if (!d) return;
    setConfirm({ no: d.trip_no, reg: d.vehicles?.reg_no ?? "" });
    await new Promise((ok) => setTimeout(ok, 1000));
    setConfirm(null);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "out", label: t("sec.tabOut") },
    { id: "in", label: t("sec.tabIn") },
    { id: "log", label: t("sec.tabLog") },
    { id: "pickup", label: t("sec.tabPickup") },
  ];

  return (
    <>
      <Screen title={t("sec.title")} right={<div className="flex items-center gap-2"><SyncBadge /><AvatarLink /></div>}>
        {tab === "out" && (
          <>
            {/* The one big action, right at the top: scan the gate pass. */}
            <button
              onClick={() => void startScan()}
              className="mb-5 flex w-full flex-col items-center gap-3 rounded-xl bg-primary px-6 py-8 text-primary-foreground shadow-soft transition-transform active:scale-[0.99]"
            >
              <ScanLine className="h-10 w-10" />
              <span className="font-display text-xl font-bold">{t("sec.gateOut")}</span>
              <span className="text-xs font-medium text-primary-foreground/70">{t("sec.scanToken")}</span>
            </button>

            <div className="rounded-xl border border-border bg-card p-4 shadow-card">
              <label className="mb-1 block text-sm font-medium text-foreground">{t("sec.scanToken")}</label>
              <input
                ref={tokenInput}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t("sec.tokenPlaceholder")}
                className="w-full rounded-md border border-input bg-background px-3 py-3 font-mono text-sm outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30"
              />
              <label className="mb-1 mt-3 block text-sm font-medium text-foreground">{t("sec.odometerOptional")}</label>
              <input
                inputMode="numeric"
                value={odo}
                onChange={(e) => setOdo(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-md border border-input bg-background px-3 py-3 text-lg font-semibold outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30"
              />
              <DockButton onClick={() => void gateOut()} disabled={busy}>
                {busy ? t("c.loading") : t("sec.gateOut")}
              </DockButton>
            </div>
          </>
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
              <div key={r.id} className="rounded-xl border border-border bg-card p-4 text-sm shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-bold text-foreground">{r.pass_no}</span>
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

        {tab === "pickup" && (
          <div className="grid gap-3">
            <div className="rounded-xl border border-border bg-card p-4 shadow-card">
              <p className="font-display text-base font-bold text-foreground">{t("sec.pickup")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("sec.pickupSub")}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <input value={pickupOrder} onChange={(e) => setPickupOrder(e.target.value)} placeholder={t("sec.pickupOrder")} className="rounded-md border border-input bg-background px-3 py-3 text-sm outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
                <input inputMode="numeric" maxLength={6} value={pickupOtp} onChange={(e) => setPickupOtp(e.target.value.replace(/\D/g, ""))} placeholder={t("sec.passCode")} className="rounded-md border border-input bg-background px-3 py-3 text-center text-lg font-semibold tracking-[0.3em] outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
              </div>
              {isNative() && (
                <button
                  type="button"
                  onClick={() =>
                    void scanQr().then((v) => {
                      if (!v) return;
                      void haptic("success");
                      const code = v.match(/\b(\d{6})\b/)?.[1] ?? v.replace(/\D/g, "").slice(-6);
                      const ord = v.match(/order[=:]([^&\s]+)/i)?.[1];
                      if (ord) setPickupOrder(decodeURIComponent(ord));
                      if (code) setPickupOtp(code);
                    })
                  }
                  className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background py-3 text-sm font-semibold text-foreground active:bg-accent"
                >
                  <ScanLine className="h-4 w-4" /> {t("sec.scanPass")}
                </button>
              )}
            </div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("sec.pickupList")}</p>
            {pickups === null && <Spinner label={t("c.loading")} />}
            {pickups && pickups.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t("c.none")}</p>}
            {pickups?.map((o) => (
              <div key={o.id} className="rounded-xl border border-border bg-card p-4 text-sm shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display font-bold text-foreground">{o.order_no}</span>
                  <span className="text-xs text-muted-foreground">₹{o.grand_total ?? 0}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{o.customers?.business_name || o.customers?.contact_name || "—"}</p>
                <p className="mt-1 font-mono text-xs text-foreground">{t("sec.passCode")}: {o.delivery_otp ?? "—"}</p>
              </div>
            ))}
          </div>
        )}

        {msg && <p className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">{msg}</p>}
        {error && <div className="mt-4"><ErrorCard message={error} /></div>}
      </Screen>

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy/90 p-6" role="status">
          <div className="rounded-2xl bg-card px-8 py-6 text-center shadow-soft">
            <p className="text-sm font-semibold text-emerald-600">{t("sec.scanned")}</p>
            <p className="mt-1 font-display text-2xl font-bold text-foreground">{confirm.no}</p>
            <p className="text-base font-semibold text-muted-foreground">{confirm.reg}</p>
          </div>
        </div>
      )}
      {/* Tab switcher docked at the bottom, thumb-reachable */}
      <ActionDock tone="plain">
        <div className="grid grid-cols-4 gap-1 rounded-2xl bg-navy p-1 shadow-soft">
          {tabs.map((x) => (
            <button
              key={x.id}
              onClick={() => {
                void haptic("light");
                setTab(x.id);
                setMsg(null);
                setError(null);
              }}
              className={`flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[11px] font-bold leading-tight transition-colors ${
                tab === x.id ? "bg-card text-navy shadow-soft" : "text-primary-foreground/80"
              }`}
            >
              {x.id === "out" ? <LogOut className="h-5 w-5" /> : x.id === "in" ? <LogIn className="h-5 w-5" /> : x.id === "log" ? <ClipboardList className="h-5 w-5" /> : <PackageCheck className="h-5 w-5" />}
              <span className="block w-full truncate whitespace-nowrap text-center">{x.label}</span>
            </button>
          ))}
        </div>
      </ActionDock>
    </>
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
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-2 text-left">
        <div>
          <span className="font-display font-bold text-foreground">{t("ld.trip", { no: trip.trip_no })}</span>
          {trip.vehicles?.reg_no && <span className="ml-2 text-xs text-muted-foreground">{trip.vehicles.reg_no}</span>}
        </div>
        <StatusBadge status={trip.status} />
      </button>
      {open && (
        <div className="mt-3 grid gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground">{t("sec.odometer")}</label>
            <input inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ""))} className="w-full rounded-md border border-input bg-background px-3 py-3 text-base font-semibold outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">{t("sec.fuelLitres")}</label>
              <input inputMode="decimal" value={fuelL} onChange={(e) => setFuelL(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">{t("sec.fuelAmount")}</label>
              <input inputMode="decimal" value={fuelA} onChange={(e) => setFuelA(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
            </div>
          </div>
          {msg && <p className="text-xs font-medium text-emerald-600">{msg}</p>}
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <DockButton onClick={() => void confirm()} disabled={busy}>
            {busy ? t("c.loading") : t("sec.gateIn")}
          </DockButton>
        </div>
      )}
    </div>
  );
}
