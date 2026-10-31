import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { ErrorCard, PhotoInput, Screen, Spinner, StatusBadge } from "@/components/team/ui";
import {
  DEFAULT_SETTINGS,
  StartTripPanel,
  StopCard,
  StopDetailPanel,
  getCoords,
  signatureToPath,
  type LineRow,
  type Settings,
  type StopRow,
} from "@/components/team/driver-parts";
import { queueRpc } from "@/lib/offline";

export const Route = createFileRoute("/_authenticated/driver/$tripId")({
  head: () => ({
    meta: [
      { title: "Trip · Sunrich Team" },
      { name: "description", content: "Work your delivery trip." },
      { property: "og:title", content: "Trip · Sunrich Team" },
      { property: "og:description", content: "Work your delivery trip." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TripScreen,
});

type Trip = {
  id: string;
  trip_no: string;
  status: string;
  trip_date: string;
  ended_at: string | null;
  cash_expected: number | null;
  cash_received: number | null;
  vehicles: { reg_no: string } | null;
};

type ExtraProduct = { id: string; name: string };

type Alert = { id: string; type: string; note: string | null; created_at: string };

function TripScreen() {
  const { tripId } = Route.useParams();
  const { t } = useLang();
  const { staff } = useTeamAuth();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [lines, setLines] = useState<Record<string, LineRow[]>>({});
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [selected, setSelected] = useState<string | null>(null);
  const [outstanding, setOutstanding] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // trip tools state
  const [products, setProducts] = useState<ExtraProduct[]>([]);
  const [showTools, setShowTools] = useState<string | null>(null); // extras | expense | pickup | sos | end
  const [expType, setExpType] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expNote, setExpNote] = useState("");
  const [expPhoto, setExpPhoto] = useState<string | null>(null);
  const [extraProduct, setExtraProduct] = useState("");
  const [extraQty, setExtraQty] = useState("");
  const [pickupCustomer, setPickupCustomer] = useState("");
  const [pickupProduct, setPickupProduct] = useState("");
  const [pickupQty, setPickupQty] = useState("");
  const [spotCustomer, setSpotCustomer] = useState("");
  const [spotProduct, setSpotProduct] = useState("");
  const [spotQty, setSpotQty] = useState("");
  const [spotPaid, setSpotPaid] = useState(true);
  const [sosNote, setSosNote] = useState("");
  const [endOdo, setEndOdo] = useState("");
  const [endOdoPhoto, setEndOdoPhoto] = useState<string | null>(null);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleNote, setSettleNote] = useState("");

  const locTimer = useRef<number | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tripRes, stopsRes, settingsRes] = await Promise.all([
      supabase
        .from("trips")
        .select("id, trip_no, status, trip_date, ended_at, cash_expected, cash_received, vehicles(reg_no)")
        .eq("id", tripId)
        .single(),
      supabase
        .from("trip_stops")
        .select("id, seq, status, fail_reason, orders(id, customer_id, order_no, business_name, customer_name, delivery_address_text, grand_total, amount_paid, payment_mode)")
        .eq("trip_id", tripId)
        .order("seq"),
      supabase.rpc("my_delivery_settings"),
    ]);
    if (tripRes.error) {
      setError(tripRes.error.message);
      setLoading(false);
      return;
    }
    setTrip(tripRes.data as unknown as Trip);
    const stopRows = (stopsRes.data ?? []) as unknown as StopRow[];
    setStops(stopRows);
    if (!stopsRes.error && stopRows.length > 0) {
      const lineRes = await supabase
        .from("order_lines")
        .select("id, order_id, product_name, pack_label, qty")
        .in("order_id", stopRows.map((s) => s.orders?.id).filter((x): x is string => Boolean(x)));
      const map: Record<string, LineRow[]> = {};
      for (const l of (lineRes.data ?? []) as unknown as (LineRow & { order_id: string })[]) {
        (map[l.order_id] ??= []).push({ id: l.id, product_name: l.product_name, pack_label: l.pack_label, qty: l.qty });
      }
      setLines(map);
    } else {
      setLines({});
    }
    if (!settingsRes.error && settingsRes.data) {
      setSettings({ ...DEFAULT_SETTINGS, ...(settingsRes.data as unknown as Settings) });
    }
    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    void supabase
      .from("products")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }: { data: { id: string; name: string }[] | null }) => setProducts((data ?? []) as ExtraProduct[]));
  }, []);

  const stop = stops.find((s) => s.id === selected) ?? null;

  const refreshOutstanding = useCallback(
    async (stopId: string, customerId: string | undefined) => {
      if (!customerId) return;
      const res = await queueRpc("stop_customer_summary", { p_customer_id: customerId, p_trip_id: tripId });
      const data = res.data as { outstanding?: number } | undefined;
      if (data && typeof data.outstanding === "number") {
        setOutstanding((s) => ({ ...s, [stopId]: data.outstanding as number }));
      }
    },
    [tripId],
  );

  useEffect(() => {
    if (stop?.orders?.customer_id) void refreshOutstanding(stop.id, stop.orders.customer_id);
  }, [stop, refreshOutstanding]);

  // Location tracking while on the road.
  useEffect(() => {
    if (!trip || trip.status !== "in_progress" || !settings.location_tracking_enabled) return;
    const intervalMs = Math.max(60, settings.location_interval_minutes * 60) * 1000;
    const tick = async () => {
      const c = await getCoords();
      if (!c) return;
      await queueRpc("log_location", { p_trip_id: tripId, p_latitude: c.latitude, p_longitude: c.longitude });
    };
    void tick();
    locTimer.current = window.setInterval(() => void tick(), intervalMs);
    return () => {
      if (locTimer.current) window.clearInterval(locTimer.current);
    };
  }, [trip?.status, settings.location_tracking_enabled, settings.location_interval_minutes, tripId, trip]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Screen title={t("dr.trip", { no: "…" })}><Spinner label={t("c.loading")} /></Screen>;
  if (!trip) return <Screen title={t("dr.title")}><ErrorCard message={error ?? t("c.error")} onRetry={() => void fetchAll()} /></Screen>;

  const startTrip = async (v: { selfie: string | null; odometer: string; odoPhoto: string | null; checkPhoto: string | null; checkItems: { item: string; ok: boolean }[] }) => {
    await run(async () => {
      // start_trip takes no coordinates; location tracking logs them separately.
      const res = await queueRpc("start_trip", {
        p_trip_id: tripId,
        p_selfie_url: v.selfie,
        p_odometer: Number(v.odometer),
        p_odometer_photo_url: v.odoPhoto,
        p_check_photo_url: v.checkPhoto,
        p_vehicle_check: v.checkItems,
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setMessage(res.queued ? t("c.tryAgainOffline") : t("c.saved"));
      await fetchAll();
    });
  };

  const deliverStop = async (v: {
    lines: { order_line_id: string; delivered: number; short: number; damaged: number; refused: number; empties: number }[];
    fail: boolean;
    failReason: string;
    failNote: string;
    photo: string | null;
    signature: string | null;
    otp: string;
  }) => {
    if (!staff || !stop) return;
    await run(async () => {
      const coords = await getCoords();
      const signPath = await signatureToPath(v.signature, staff.id, stop.id);
      const proof: {
        photo_url?: string;
        signature_url?: string;
        otp?: string;
        latitude?: number;
        longitude?: number;
      } = {};
      if (v.photo) proof.photo_url = v.photo;
      if (signPath) proof.signature_url = signPath;
      if (v.otp) proof.otp = v.otp;
      if (coords) {
        proof.latitude = coords.latitude;
        proof.longitude = coords.longitude;
      }
      const res = await queueRpc("deliver_stop", {
        p_stop_id: stop.id,
        p_lines: v.lines,
        p_proof: proof,
        p_fail_reason: v.fail ? (v.failNote ? `${v.failReason}: ${v.failNote}` : v.failReason) : null,
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setMessage(res.queued ? t("c.tryAgainOffline") : t("dr.stopDone"));
      setSelected(null);
      await fetchAll();
    });
  };

  const collectForStop = async (v: { mode: string; amount: string; reference: string; photo: string | null }) => {
    if (!stop) return;
    await run(async () => {
      const res = await queueRpc("record_collection", {
        p_stop_id: stop.id,
        p_mode: v.mode,
        p_amount: Number(v.amount),
        p_reference: v.reference || null,
        p_photo_url: v.photo,
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setMessage(res.queued ? t("c.tryAgainOffline") : t("c.saved"));
      await fetchAll();
    });
  };

  const collectDue = async (v: { amount: string; mode: string; reference: string; photo: string | null }) => {
    if (!stop || !stop.orders) return;
    await run(async () => {
      const res = await queueRpc("record_due_collection", {
        p_trip_id: tripId,
        p_customer_id: stop.orders!.customer_id,
        p_mode: v.mode,
        p_amount: Number(v.amount),
        p_reference: v.reference || null,
        p_photo_url: v.photo,
        p_stop_id: stop.id,
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setMessage(res.queued ? t("c.tryAgainOffline") : t("c.saved"));
    });
  };

  const addExpense = async () => {
    await run(async () => {
      const res = await queueRpc("add_trip_expense", {
        p_trip_id: tripId,
        p_type: expType || settings.expense_types[0] || "other",
        p_amount: Number(expAmount),
        p_bill_photo_url: expPhoto,
        p_note: expNote || null,
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setShowTools(null);
      setMessage(res.queued ? t("c.tryAgainOffline") : t("c.saved"));
      setExpAmount("");
      setExpNote("");
      setExpPhoto(null);
    });
  };

  const addExtra = async () => {
    await run(async () => {
      const res = await queueRpc("set_extra_load", {
        p_trip_id: tripId,
        p_product_id: extraProduct,
        p_qty: Number(extraQty),
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setShowTools(null);
      setMessage(res.queued ? t("c.tryAgainOffline") : t("c.saved"));
      setExtraQty("");
    });
  };

  const addPickup = async () => {
    if (!pickupCustomer) return;
    await run(async () => {
      const coords = await getCoords();
      const res = await queueRpc("record_pickup", {
        p_trip_id: tripId,
        p_customer_id: pickupCustomer,
        p_product_id: pickupProduct,
        p_qty: Number(pickupQty),
        p_photo_url: null,
        ...(coords ? { p_latitude: coords.latitude, p_longitude: coords.longitude } : {}),
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setShowTools(null);
      setMessage(res.queued ? t("c.tryAgainOffline") : t("c.saved"));
      setPickupQty("");
    });
  };

  const addSpotSale = async () => {
    if (!spotCustomer) return;
    await run(async () => {
      const coords = await getCoords();
      const res = await queueRpc("spot_sale", {
        p_trip_id: tripId,
        p_customer_id: spotCustomer,
        p_lines: [{ product_id: spotProduct, qty: Number(spotQty) }],
        p_paid_now: spotPaid,
        ...(coords ? { p_latitude: coords.latitude, p_longitude: coords.longitude } : {}),
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setShowTools(null);
      setMessage(res.queued ? t("c.tryAgainOffline") : t("dr.spotSold"));
      setSpotQty("");
    });
  };

  const sendSos = async () => {
    await run(async () => {
      const coords = await getCoords();
      const res = await queueRpc("raise_trip_alert", {
        p_trip_id: tripId,
        p_type: "sos",
        p_note: sosNote || null,
        ...(coords ? { p_latitude: coords.latitude, p_longitude: coords.longitude } : {}),
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setShowTools(null);
      setSosNote("");
      setMessage(res.queued ? t("c.tryAgainOffline") : t("dr.sosSent"));
    });
  };

  const endTrip = async () => {
    await run(async () => {
      if (settings.require_end_odometer && endOdo === "") {
        setError(t("dr.needOdo"));
        return;
      }
      if (settings.require_end_odometer_photo && !endOdoPhoto) {
        setError(t("dr.needPhoto"));
        return;
      }
      const res = await queueRpc("end_trip", {
        p_trip_id: tripId,
        p_odometer: Number(endOdo),
        p_odometer_photo_url: endOdoPhoto,
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setShowTools(null);
      setMessage(res.queued ? t("c.tryAgainOffline") : t("c.saved"));
      await fetchAll();
    });
  };

  const settle = async () => {
    await run(async () => {
      const res = await queueRpc("settle_trip", {
        p_trip_id: tripId,
        p_cash_received: Number(settleAmount || 0),
        p_note: settleNote || null,
      });
      if (res.error && !res.queued) {
        setError(res.error);
        return;
      }
      setShowTools(null);
      setMessage(res.queued ? t("c.tryAgainOffline") : t("dr.settled"));
      await fetchAll();
    });
  };

  const doneCount = stops.filter((s) => s.status === "delivered").length;
  const canStart = ["planned", "loading", "loaded"].includes(trip.status);
  const onRoad = trip.status === "in_progress";
  const returned = trip.status === "returned";
  const settled = trip.status === "settled";
  // The driver records the closing odometer, but the vehicle is only "returned"
  // once security records gate-in at the plant.
  const endedAwaitingGateIn = onRoad && Boolean(trip.ended_at);
  // Cash settlement is an office action (dispatch:approve / finance:create);
  // drivers see the handover summary only.
  const canSettle =
    !!staff &&
    (staff.permissions.includes("dispatch:approve") || staff.permissions.includes("finance:create"));

  const toolBtn = (id: string, label: string, danger = false) => (
    <button
      key={id}
      onClick={() => setShowTools((s) => (s === id ? null : id))}
      className={`rounded-lg border px-3 py-2 text-xs font-semibold active:bg-accent ${danger ? "border-destructive/50 text-destructive" : "border-input text-foreground"}`}
    >
      {label}
    </button>
  );

  return (
    <Screen
      title={t("dr.trip", { no: trip.trip_no })}
      right={<StatusBadge status={trip.status} />}
    >
      <Link to="/driver" className="mb-3 inline-block text-xs text-muted-foreground underline">← {t("dr.title")}</Link>
      <p className="mb-4 text-sm text-muted-foreground">
        {trip.vehicles?.reg_no ? `${trip.vehicles.reg_no} · ` : ""}
        {t("dr.deliveredStops", { done: doneCount, total: stops.length })}
        {settings.location_tracking_enabled && onRoad ? ` · ${t("dr.location")}` : ""}
      </p>

      {message && <p className="mb-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">{message}</p>}
      {error && <div className="mb-4"><ErrorCard message={error} /></div>}

      {canStart && (
        <StartTripPanel
          staffId={staff?.id ?? "anon"}
          tripId={tripId}
          settings={settings}
          checkPhotoRequired={false}
          onSubmit={startTrip}
          busy={busy}
          error={null}
        />
      )}

      {endedAwaitingGateIn && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm font-semibold text-foreground">{t("dr.tripEnded")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("dr.gateInFirst")}</p>
        </div>
      )}

      {onRoad && !endedAwaitingGateIn && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {settings.expenses_enabled && toolBtn("expense", t("dr.expenses"))}
            {settings.allow_extra_load && toolBtn("extras", t("dr.extras"))}
            {toolBtn("pickup", t("dr.pickup"))}
            {settings.sos_enabled && toolBtn("sos", t("dr.sos"), true)}
            {toolBtn("end", t("dr.endTrip"))}
          </div>

          {showTools === "expense" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4">
              <p className="mb-2 text-sm font-bold text-foreground">{t("dr.expenses")}</p>
              <div className="grid gap-2">
                <select value={expType} onChange={(e) => setExpType(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                  {(settings.expense_types.length ? settings.expense_types : ["other"]).map((x) => (
                    <option key={x} value={x}>{x}</option>
                  ))}
                </select>
                <input inputMode="decimal" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder={t("dr.expenseAmount")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <input value={expNote} onChange={(e) => setExpNote(e.target.value)} placeholder={t("c.notes")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <PhotoInput userId={staff?.id ?? "anon"} kind="expense-bill" label={t("dr.expenseBill")} required={settings.expense_bill_photo_required} value={expPhoto} onChange={setExpPhoto} />
                <button onClick={() => void addExpense()} disabled={busy || expAmount === ""} className="rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  {t("c.submit")}
                </button>
              </div>
            </div>
          )}

          {showTools === "extras" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4">
              <p className="mb-2 text-sm font-bold text-foreground">{t("dr.extras")}</p>
              <div className="grid gap-2">
                <select value={extraProduct} onChange={(e) => setExtraProduct(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="">{t("dr.pickupProduct")}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input inputMode="numeric" value={extraQty} onChange={(e) => setExtraQty(e.target.value.replace(/\D/g, ""))} placeholder={t("c.qty")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={() => void addExtra()} disabled={busy || !extraProduct || extraQty === ""} className="rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  {t("c.submit")}
                </button>
              </div>
            </div>
          )}

          {showTools === "pickup" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4">
              <p className="mb-2 text-sm font-bold text-foreground">{t("dr.pickup")}</p>
              <div className="grid gap-2">
                <select value={pickupCustomer} onChange={(e) => setPickupCustomer(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="">{t("dr.customer")}</option>
                  {stops.filter((s) => s.orders).map((s) => (
                    <option key={s.id} value={s.orders!.customer_id}>{s.orders!.business_name || s.orders!.customer_name}</option>
                  ))}
                </select>
                <select value={pickupProduct} onChange={(e) => setPickupProduct(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                  <option value="">{t("dr.pickupProduct")}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <input inputMode="numeric" value={pickupQty} onChange={(e) => setPickupQty(e.target.value.replace(/\D/g, ""))} placeholder={t("dr.pickupQty")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <button onClick={() => void addPickup()} disabled={busy || !pickupCustomer || !pickupProduct || pickupQty === ""} className="rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  {t("c.submit")}
                </button>
              </div>
            </div>
          )}

          {showTools === "sos" && (
            <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <p className="mb-2 text-sm font-bold text-destructive">{t("dr.sos")}</p>
              <input value={sosNote} onChange={(e) => setSosNote(e.target.value)} placeholder={t("dr.sosNote")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
              <button onClick={() => void sendSos()} disabled={busy} className="mt-2 w-full rounded-lg bg-destructive py-3 text-sm font-semibold text-white active:opacity-80 disabled:opacity-60">
                {t("dr.sos")}
              </button>
            </div>
          )}

          {showTools === "end" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4">
              <p className="mb-1 text-sm font-bold text-foreground">{t("dr.endTrip")}</p>
              <p className="mb-2 text-xs text-muted-foreground">{t("dr.gateInFirst")}</p>
              <div className="grid gap-2">
                <input inputMode="numeric" value={endOdo} onChange={(e) => setEndOdo(e.target.value.replace(/\D/g, ""))} placeholder={t("dr.odometer")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
                <PhotoInput userId={staff?.id ?? "anon"} kind="odo-end" label={t("dr.odometerPhoto")} required={settings.require_end_odometer_photo} value={endOdoPhoto} onChange={setEndOdoPhoto} />
                <button onClick={() => void endTrip()} disabled={busy} className="rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  {t("dr.endTrip")}
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-2">
            {stops.map((s) => (
              <StopCard key={s.id} stop={s} done={0} onOpen={() => setSelected(s.id === selected ? null : s.id)} />
            ))}
            {stops.length === 0 && <p className="text-sm text-muted-foreground">{t("c.none")}</p>}
          </div>

          {doneCount === stops.length && stops.length > 0 && (
            <p className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-center text-sm font-medium text-emerald-700 dark:text-emerald-300">
              {t("dr.allStopsDone")}
            </p>
          )}

          {selected && stop && (
            <div className="mt-4">
              <StopDetailPanel
                stop={stop}
                lines={lines[stop.orders?.id ?? ""] ?? []}
                settings={settings}
                staffId={staff?.id ?? "anon"}
                outstanding={outstanding[stop.id] ?? null}
                onSubmitDelivery={deliverStop}
                onSubmitCollection={collectForStop}
                onSubmitDueCollection={collectDue}
                busy={busy}
                error={null}
                message={null}
              />
            </div>
          )}
        </>
      )}

      {returned && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-bold text-foreground">{t("dr.settle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("dr.cashExpected")}: ₹{trip.cash_expected ?? 0}</p>
          {canSettle ? (
            <div className="mt-3 grid gap-2">
              <input inputMode="decimal" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} placeholder={t("dr.cashReceived")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
              <input value={settleNote} onChange={(e) => setSettleNote(e.target.value)} placeholder={t("dr.settleNote")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
              <button onClick={() => void settle()} disabled={busy} className="rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                {t("dr.settle")}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">{t("dr.settleOffice")}</p>
          )}
        </div>
      )}

      {settled && (
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-sm font-semibold text-foreground">{t("dr.settled")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("dr.cashExpected")}: ₹{trip.cash_expected ?? 0} · {t("dr.cashReceived")}: ₹{trip.cash_received ?? 0}
          </p>
        </div>
      )}
    </Screen>
  );
}
