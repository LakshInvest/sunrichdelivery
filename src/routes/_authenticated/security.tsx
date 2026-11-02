import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { ErrorCard, Screen, Spinner, StatusBadge, SyncBadge, AvatarLink, DockButton } from "@/components/team/ui";
import { isOffline, queueRpc } from "@/lib/offline";
import { haptic, isNative, scanQr } from "@/lib/native";
import { ScanLine, LogIn, LogOut, TriangleAlert, ArrowLeft, ClipboardList, UserRoundCog } from "lucide-react";
import { friendlyError } from "@/lib/friendly-error";
import { GateEntryPanel, GateExitPanel, inputCls } from "@/components/team/gate-entry";
import { VehiclesOutList } from "@/components/team/vehicles-out";
import { ChangeGuardPanel, ProblemPanel, RegisterPanel } from "@/components/team/gate-extras";

export const Route = createFileRoute("/_authenticated/security")({
  head: () => ({
    meta: [
      { title: "Security gate · Sunrich Delivery" },
      { name: "description", content: "Scan passes, record entry and exit, report problems and keep the gate register." },
      { property: "og:title", content: "Security gate · Sunrich Delivery" },
      { property: "og:description", content: "Scan passes, record entry and exit, report problems and keep the gate register." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SecurityGate,
});

type View = "home" | "entry" | "exit" | "problem" | "register" | "guard";
type ScanHit =
  | { kind: "trip_out" | "trip_in" | "trip_done"; trip_id: string; trip_no: string; reg_no: string | null; status: string }
  | { kind: "material" | "material_done"; id: string; pass_no: string; direction: string; party: string | null; vehicle_no: string | null; items: string }
  | { kind: "pickup"; order: string; otp: string }
  | { kind: "unknown" }
  | { kind: "offline" };

function istLongDate(): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date());
}

function SecurityGate() {
  const { t } = useLang();
  const { staff } = useTeamAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [view, setView] = useState<View>("home");
  const [unit, setUnit] = useState("");
  const [counts, setCounts] = useState<{ vehicles: number; people: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [hit, setHit] = useState<ScanHit | null>(null);
  const [busy, setBusy] = useState(false);
  const [odo, setOdo] = useState("");
  const typedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void supabase.rpc("has_perm", { p_module: "gate", p_action: "create" }).then((r) => setAllowed(!!r.data));
  }, []);

  useEffect(() => {
    if (!staff?.unitId) return;
    void supabase
      .from("units")
      .select("name")
      .eq("id", staff.unitId)
      .maybeSingle()
      .then((r) => setUnit(r.data?.name ?? ""));
  }, [staff?.unitId]);

  const loadCounts = useCallback(async () => {
    const [v, p] = await Promise.all([
      supabase.from("trips").select("id", { count: "exact", head: true }).not("gate_out_at", "is", null).is("gate_in_at", null).neq("status", "cancelled"),
      supabase.from("gate_entries").select("people_count").is("out_at", null),
    ]);
    setCounts({ vehicles: v.count ?? 0, people: (p.data ?? []).reduce((s, r) => s + ((r as { people_count: number }).people_count ?? 1), 0) });
  }, []);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const go = (v: View) => {
    void haptic("light");
    setMsg(null);
    setError(null);
    setHit(null);
    setView(v);
  };

  const finish = (m: string) => {
    setMsg(m);
    setError(null);
    setHit(null);
    setTyped("");
    setOdo("");
    setView("home");
    void loadCounts();
  };

  const detect = async (raw: string) => {
    const v = raw.trim();
    setMsg(null);
    setError(null);
    if (!v) return;
    setTyped(v);
    const ord = v.match(/order[=:]([^&\s]+)/i)?.[1];
    if (ord) {
      const otp = v.match(/(?:otp|code)[=:](\d{4,6})/i)?.[1] ?? v.match(/\b(\d{6})\b/)?.[1] ?? "";
      setHit({ kind: "pickup", order: decodeURIComponent(ord), otp });
      return;
    }
    if (isOffline()) {
      setHit({ kind: "offline" });
      return;
    }
    setBusy(true);
    const r = await supabase.rpc("gate_scan_lookup", { p_token: v });
    setBusy(false);
    if (r.error) return setError(friendlyError(r.error.message, t));
    const h = r.data as unknown as ScanHit;
    if (h.kind === "unknown") return setError(t("sec.scanUnknown"));
    if (h.kind === "trip_done" || h.kind === "material_done") return setError(t("sec.scanUsed"));
    void haptic("success");
    setHit(h);
  };

  const startScan = async () => {
    if (isNative()) {
      const v = await scanQr();
      if (v) await detect(v);
    } else typedRef.current?.focus();
  };

  const act = async () => {
    if (!hit || busy) return;
    setBusy(true);
    try {
      if (hit.kind === "trip_out") {
        const tok = typed.trim();
        const res = await queueRpc("gate_out", { p_qr_token: tok, p_odometer: odo === "" ? null : Number(odo) });
        if (res.queued) return finish(t("c.tryAgainOffline"));
        if (res.error) return setError(friendlyError(res.error, t));
        void haptic("success");
        finish(`${t("sec.gateOutDone")}: ${hit.trip_no}`);
      } else if (hit.kind === "material") {
        const r = await queueRpc("gate_material_scan", { p_token: typed.trim() });
        if (r.queued) return finish(t("sec.savedOffline"));
        if (r.error) return setError(friendlyError(r.error, t));
        void haptic("success");
        finish(`${t("sec.materialDone")}: ${hit.pass_no}`);
      } else if (hit.kind === "offline") {
        // No network: the guard says what the pass is; it is checked when it uploads.
        return;
      } else if (hit.kind === "pickup") {
        const res = await queueRpc("gate_pickup_handover", { p_order_no: hit.order, p_otp: hit.otp });
        if (res.queued) return finish(t("c.tryAgainOffline"));
        if (res.error) return setError(friendlyError(res.error, t));
        void haptic("success");
        finish(`${t("sec.pickupDone")}: ${hit.order}`);
      }
    } finally {
      setBusy(false);
    }
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
    finish(t("sec.gateInDone"));
    return t("sec.gateInDone");
  };

  if (allowed === null) return <Screen title={t("sec.title")}><Spinner label={t("c.loading")} /></Screen>;
  if (!allowed)
    return (
      <Screen title={t("sec.title")} right={<AvatarLink />}>
        <ErrorCard message={t("sec.noGatePerm")} />
      </Screen>
    );

  const titles: Record<View, string> = {
    home: t("sec.title"),
    entry: t("sec.entry"),
    exit: t("sec.exit"),
    problem: t("sec.problem"),
    register: t("sec.register"),
    guard: t("sec.changeGuard"),
  };

  const back = (
    <button type="button" onClick={() => go("home")} className="mb-3 flex items-center gap-1 text-sm font-bold text-primary">
      <ArrowLeft className="h-4 w-4" /> {t("c.back")}
    </button>
  );

  return (
    <Screen title={titles[view]} right={<div className="flex items-center gap-2"><SyncBadge /><AvatarLink /></div>}>
      {view === "home" && (
        <div className="grid gap-3">
          <div className="rounded-xl bg-navy p-4 text-primary-foreground shadow-soft" data-testid="sec-header">
            <p className="font-display text-lg font-bold leading-tight">{staff?.fullName}</p>
            <p className="text-xs text-primary-foreground/75">{[unit, istLongDate()].filter(Boolean).join(" · ")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-primary-foreground/10 px-3 py-2">
                <p className="font-display text-2xl font-bold" data-testid="count-vehicles">{counts?.vehicles ?? "–"}</p>
                <p className="text-xs text-primary-foreground/80">{t("sec.vehiclesOut")}</p>
              </div>
              <div className="rounded-lg bg-primary-foreground/10 px-3 py-2">
                <p className="font-display text-2xl font-bold" data-testid="count-people">{counts?.people ?? "–"}</p>
                <p className="text-xs text-primary-foreground/80">{t("sec.peopleInside")}</p>
              </div>
            </div>
          </div>

          {!hit && (
            <>
              <button
                onClick={() => void startScan()}
                className="flex w-full flex-col items-center gap-2 rounded-xl bg-primary px-6 py-7 text-primary-foreground shadow-soft transition-transform active:scale-[0.99]"
              >
                <ScanLine className="h-10 w-10" />
                <span className="font-display text-2xl font-bold">{t("sec.scan")}</span>
                <span className="text-xs font-medium text-primary-foreground/75">{t("sec.scanSub")}</span>
              </button>
              <div className="flex gap-2">
                <input
                  ref={typedRef}
                  aria-label={t("sec.typeCode")}
                  placeholder={t("sec.typeCode")}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className={`${inputCls} min-w-0 flex-1 font-mono text-sm`}
                />
                <button type="button" onClick={() => void detect(typed)} disabled={busy || !typed.trim()} className="rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">
                  {t("sec.check")}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <BigBtn icon={<LogIn className="h-6 w-6" />} label={t("sec.entry")} onClick={() => go("entry")} />
                <BigBtn icon={<LogOut className="h-6 w-6" />} label={t("sec.exit")} onClick={() => go("exit")} />
                <BigBtn icon={<TriangleAlert className="h-6 w-6" />} label={t("sec.problem")} onClick={() => go("problem")} danger />
              </div>
              <div className="flex items-center justify-between px-1">
                <button type="button" onClick={() => go("register")} className="flex items-center gap-1 text-sm font-bold text-primary underline-offset-2 hover:underline">
                  <ClipboardList className="h-4 w-4" /> {t("sec.register")}
                </button>
                  <VehiclesOutList refreshKey={counts?.vehicles ?? 0} onArrived={() => finish(t("sec.arrived"))} />
                <button type="button" onClick={() => go("guard")} className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
                  <UserRoundCog className="h-4 w-4" /> {t("sec.changeGuard")}
                </button>
              </div>
            </>
          )}

          {hit && hit.kind === "trip_in" && (
            <>
              <p className="text-sm font-bold text-foreground">{t("sec.scanTripIn")}</p>
              <GateInCard trip={{ id: hit.trip_id, trip_no: hit.trip_no, reg_no: hit.reg_no, status: hit.status }} onConfirm={gateIn} />
              <button type="button" onClick={() => setHit(null)} className="text-sm font-bold text-muted-foreground">{t("c.cancel")}</button>
            </>
          )}

          {hit && hit.kind === "offline" && (
            <div className="grid gap-2 rounded-xl border-2 border-amber-500 bg-card p-4 shadow-card" data-testid="scan-hit">
              <p className="text-sm font-bold text-foreground">{t("sec.offlineScan")}</p>
              <DockButton onClick={() => void queueRpc("gate_out", { p_qr_token: typed.trim(), p_odometer: null }).then(() => finish(t("sec.savedOffline")))}>{t("sec.gateOut")}</DockButton>
              <DockButton onClick={() => void queueRpc("gate_material_scan", { p_token: typed.trim() }).then(() => finish(t("sec.savedOffline")))}>{t("sec.materialPass")}</DockButton>
              <button type="button" onClick={() => setHit(null)} className="text-sm font-bold text-muted-foreground">{t("c.cancel")}</button>
            </div>
          )}

          {hit && hit.kind !== "offline" && hit.kind !== "trip_in" && hit.kind !== "unknown" && hit.kind !== "trip_done" && hit.kind !== "material_done" && (
            <div className="grid gap-3 rounded-xl border-2 border-primary bg-card p-4 shadow-card" data-testid="scan-hit">
              <span className="w-fit rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">
                {hit.kind === "trip_out" ? t("sec.gateOut") : hit.kind === "material" ? t("sec.materialPass") : t("sec.pickup")}
              </span>
              {hit.kind === "trip_out" && (
                <>
                  <p className="font-display text-xl font-bold text-foreground">{hit.trip_no}</p>
                  <p className="text-sm text-muted-foreground">{hit.reg_no}</p>
                  <label className="text-sm font-medium text-foreground">{t("sec.odometerOptional")}</label>
                  <input inputMode="numeric" aria-label={t("sec.odometerOptional")} value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ""))} className={inputCls} />
                </>
              )}
              {hit.kind === "material" && (
                <>
                  <p className="font-display text-xl font-bold text-foreground">{hit.pass_no}</p>
                  <p className="text-sm text-foreground">{hit.items}</p>
                  <p className="text-xs text-muted-foreground">
                    {[t(hit.direction === "in" ? "sec.dirIn" : "sec.dirOut"), hit.party, hit.vehicle_no].filter(Boolean).join(" · ")}
                  </p>
                </>
              )}
              {hit.kind === "pickup" && (
                <>
                  <p className="font-display text-xl font-bold text-foreground">{hit.order}</p>
                  <p className="font-mono text-sm text-muted-foreground">{t("sec.passCode")}: {hit.otp || "—"}</p>
                </>
              )}
              <DockButton onClick={() => void act()} disabled={busy}>
                {busy ? t("c.loading") : hit.kind === "trip_out" ? t("sec.gateOut") : hit.kind === "material" ? t("sec.materialOk") : t("sec.pickupHand")}
              </DockButton>
              <button type="button" onClick={() => setHit(null)} className="text-sm font-bold text-muted-foreground">{t("c.cancel")}</button>
            </div>
          )}
        </div>
      )}

      {view !== "home" && back}
      {view === "entry" && <GateEntryPanel onDone={(q) => finish(q ? t("sec.savedOffline") : t("sec.entryDone"))} />}
      {view === "exit" && <GateExitPanel onChange={() => void loadCounts()} />}
      {view === "problem" && <ProblemPanel onDone={(q) => finish(q ? t("sec.savedOffline") : t("sec.problemDone"))} />}
      {view === "register" && <RegisterPanel />}
      {view === "guard" && <ChangeGuardPanel />}

      {msg && <p className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status">{msg}</p>}
      {error && <div className="mt-4"><ErrorCard message={error} /></div>}
    </Screen>
  );
}

function BigBtn({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-col items-center gap-1 rounded-xl border bg-card px-2 py-4 text-sm font-bold shadow-card active:bg-accent ${danger ? "border-destructive/40 text-destructive" : "border-border text-foreground"}`}
    >
      {icon}
      <span className="block w-full truncate text-center">{label}</span>
    </button>
  );
}

function GateInCard({
  trip,
  onConfirm,
}: {
  trip: { id: string; trip_no: string; reg_no: string | null; status: string };
  onConfirm: (tripId: string, odo: string, fuelL: string, fuelA: string) => Promise<string>;
}) {
  const { t } = useLang();
  const [odo, setOdo] = useState("");
  const [fuelL, setFuelL] = useState("");
  const [fuelA, setFuelA] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(trip.id, odo, fuelL, fuelA);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("c.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-xl border-2 border-primary bg-card p-4 shadow-card" data-testid="scan-hit">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-display font-bold text-foreground">{t("ld.trip", { no: trip.trip_no })}</span>
          {trip.reg_no && <span className="ml-2 text-xs text-muted-foreground">{trip.reg_no}</span>}
        </div>
        <StatusBadge status={trip.status} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-foreground">{t("sec.odometer")}</label>
        <input inputMode="numeric" aria-label={t("sec.odometer")} value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ""))} className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">{t("sec.fuelLitres")}</label>
          <input inputMode="decimal" value={fuelL} onChange={(e) => setFuelL(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-foreground">{t("sec.fuelAmount")}</label>
          <input inputMode="decimal" value={fuelA} onChange={(e) => setFuelA(e.target.value)} className={inputCls} />
        </div>
      </div>
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
      <DockButton onClick={() => void confirm()} disabled={busy}>
        {busy ? t("c.loading") : t("sec.gateIn")}
      </DockButton>
    </div>
  );
}

