import { createFileRoute, Link } from "@tanstack/react-router";
import { startTripMode } from "@/lib/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { ErrorCard, PhotoInput, Screen, Spinner, StatusBadge } from "@/components/team/ui";
import { StopMap } from "@/components/team/stop-map";
import { GatePassScreen } from "@/components/team/gate-pass";
import { QrCode } from "lucide-react";
import { friendlyError } from "@/lib/friendly-error";
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
      { title: "Trip · Sunrich Delivery" },
      { name: "description", content: "Work your delivery trip." },
      { property: "og:title", content: "Trip · Sunrich Delivery" },
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
  start_odometer: number | null;
  gate_out_at: string | null;
  driver_started_at: string | null;
  unit_id: string | null;
  vehicles: { reg_no: string } | null;
};

type ExtraProduct = { id: string; name: string };

/** One product on the vehicle's load plan. */
type LoadRow = {
  product_id: string;
  planned_qty: number | null;
  loaded_qty: number | null;
  products: { name: string } | null;
};

/** What the driver may still sell from the vehicle. */
type VehicleStock = { product_id: string; name: string; left: number };

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
  const [vehicleStock, setVehicleStock] = useState<VehicleStock[]>([]);
  const [showTools, setShowTools] = useState<string | null>(null); // extras | expense | pickup | sos | end
  const [expType, setExpType] = useState("");
  const [expAmount, setExpAmount] = useState("");
  const [expNote, setExpNote] = useState("");
  const [expPhoto, setExpPhoto] = useState<string | null>(null);
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
  const [firmUpi, setFirmUpi] = useState<{ id: string; payee: string | null } | null>(null);

  const locTimer = useRef<number | null>(null);
  const [gatePass, setGatePass] = useState<string | null>(null);
  const [itemCount, setItemCount] = useState(0);
  const [showPass, setShowPass] = useState(false);
  const [plant, setPlant] = useState<{ lat: number; lng: number } | null>(null);

  // Cash expenses paid from the bag reduce what the driver must hand over (same rule as settle_trip).
  const [cashSpent, setCashSpent] = useState(0);

  // Spinner only on the first load: swapping the screen for a spinner on every
  // refresh unmounted the live Google map and made it throw IntersectionObserver errors.
  const loadedOnce = useRef(false);
  const fetchAll = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    setError(null);
    const [tripRes, stopsRes, settingsRes] = await Promise.all([
      supabase
        .from("trips")
        .select("id, trip_no, status, trip_date, ended_at, cash_expected, cash_received, start_odometer, gate_out_at, driver_started_at, unit_id, vehicles(reg_no)")
        .eq("id", tripId)
        .single(),
      supabase
        .from("trip_stops")
        .select("id, seq, status, fail_reason, arrived_at, do_later_at, orders(id, customer_id, order_no, business_name, customer_name, delivery_address_text, grand_total, amount_paid, payment_mode, delivery_latitude, delivery_longitude, firm_id)")
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
    void supabase
      .from("trip_expenses")
      .select("amount, approved")
      .eq("trip_id", tripId)
      .eq("paid_from_cash", true)
      .then(({ data }) => {
        const rows = (data ?? []) as { amount: number | null; approved: boolean | null }[];
        setCashSpent(rows.filter((r) => r.approved !== false).reduce((a, r) => a + Number(r.amount ?? 0), 0));
      });
    // Gate pass token + loaded item count for the driver's QR screen.
    const [gpRes, ldRes] = await Promise.all([
      supabase.from("gate_passes").select("qr_token").eq("trip_id", tripId).order("issued_at", { ascending: false }).limit(1).maybeSingle(),
      supabase
        .from("trip_loading")
        .select("product_id, planned_qty, loaded_qty, products(name)")
        .eq("trip_id", tripId),
    ]);
    const unitId = (tripRes.data as unknown as Trip).unit_id;
    if (unitId) {
      const u = await supabase.from("units").select("latitude, longitude").eq("id", unitId).maybeSingle();
      const ud = u.data as { latitude: number | null; longitude: number | null } | null;
      setPlant(ud?.latitude != null && ud.longitude != null ? { lat: Number(ud.latitude), lng: Number(ud.longitude) } : null);
    }
    setGatePass((gpRes.data as { qr_token: string } | null)?.qr_token ?? null);
    setItemCount(((ldRes.data ?? []) as { loaded_qty: number | null }[]).reduce((a, r) => a + Number(r.loaded_qty ?? 0), 0));
    const stopRows = (stopsRes.data ?? []) as unknown as StopRow[];
    setStops(stopRows);
    if (!stopsRes.error && stopRows.length > 0) {
      const lineRes = await supabase
        .from("order_lines")
        .select("id, order_id, product_id, product_name, pack_label, qty, line_total, deposit_total")
        .in("order_id", stopRows.map((s) => s.orders?.id).filter((x): x is string => Boolean(x)));
      const map: Record<string, LineRow[]> = {};
      for (const l of (lineRes.data ?? []) as unknown as (LineRow & { order_id: string })[]) {
        (map[l.order_id] ??= []).push({ id: l.id, product_name: l.product_name, pack_label: l.pack_label, qty: l.qty, value: Number(l.line_total ?? 0) + Number(l.deposit_total ?? 0) });
      }
      setLines(map);
      // Stock left on the vehicle: what was loaded minus what has been handed over.
      const dlRes = await supabase
        .from("delivery_lines")
        .select("order_line_id, delivered_qty")
        .in("stop_id", stopRows.map((s) => s.id));
      const lineProduct: Record<string, string> = {};
      for (const l of (lineRes.data ?? []) as unknown as { id: string; product_id: string }[]) {
        lineProduct[l.id] = l.product_id;
      }
      const handedOver: Record<string, number> = {};
      for (const d of (dlRes.data ?? []) as unknown as { order_line_id: string; delivered_qty: number }[]) {
        const pid = lineProduct[d.order_line_id];
        if (!pid) continue;
        handedOver[pid] = (handedOver[pid] ?? 0) + Number(d.delivered_qty ?? 0);
      }
      const keptByLine: Record<string, number> = {};
      for (const d of (dlRes.data ?? []) as unknown as { order_line_id: string; delivered_qty: number }[]) {
        keptByLine[d.order_line_id] = (keptByLine[d.order_line_id] ?? 0) + Number(d.delivered_qty ?? 0);
      }
      for (const k of Object.keys(map)) map[k] = (map[k] ?? []).map((l) => (keptByLine[l.id] != null ? { ...l, kept: keptByLine[l.id] ?? 0 } : l));
      setLines({ ...map });
      setVehicleStock(
        ((ldRes.data ?? []) as unknown as LoadRow[])
          .map((r) => ({
            product_id: r.product_id,
            name: r.products?.name ?? "",
            left: Math.max(0, Number(r.loaded_qty ?? r.planned_qty ?? 0) - (handedOver[r.product_id] ?? 0)),
          }))
          .filter((r) => r.left > 0),
      );
    } else {
      setLines({});
      setVehicleStock([]);
    }
    // Firm UPI details for the QR shown at collection time.
    const firmId = stopRows.find((s) => s.orders?.firm_id)?.orders?.firm_id;
    if (firmId) {
      const fRes = await supabase.from("firms").select("upi_id, upi_payee_name").eq("id", firmId).single();
      if (!fRes.error && fRes.data) {
        const f = fRes.data as { upi_id: string | null; upi_payee_name: string | null };
        setFirmUpi({
          id: f.upi_id ?? "",
          payee: f.upi_payee_name,
        });
      }
    }
    if (!settingsRes.error && settingsRes.data) {
      setSettings({ ...DEFAULT_SETTINGS, ...(settingsRes.data as unknown as Settings) });
    }
    loadedOnce.current = true;
    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Empties and jars the driver may take back — the plant refuses other items.
  useEffect(() => {
    void supabase
      .from("products")
      .select("id, name")
      .eq("is_active", true)
      .eq("is_returnable", true)
      .order("name")
      .then(({ data }: { data: { id: string; name: string }[] | null }) => setProducts((data ?? []) as ExtraProduct[]));
  }, []);

  const stop = stops.find((s) => s.id === selected) ?? null;

  // "Do later" is the driver's own choice, saved on the stop (do_later_at) so it survives reinstalls.
  const deferred = stops
    .filter((s) => s.do_later_at)
    .sort((a, b) => String(a.do_later_at).localeCompare(String(b.do_later_at)))
    .map((s) => s.id);
  const toggleLater = (id: string) => {
    const later = !deferred.includes(id);
    setStops((list) => list.map((x) => (x.id === id ? { ...x, do_later_at: later ? new Date().toISOString() : null } : x)));
    void queueRpc("set_stop_later", { p_stop_id: id, p_later: later }).then((r) => {
      if (r.error && !r.queued) setError(r.error);
    });
  };
  const orderedStops = [...stops.filter((s) => !deferred.includes(s.id)), ...deferred.map((id) => stops.find((s) => s.id === id)).filter((s): s is StopRow => Boolean(s))];

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

  // Arrival at a stop: record the timestamp and a 'stop' location ping once.
  useEffect(() => {
    if (!stop || trip?.status !== "in_progress" || stop.arrived_at) return;
    void (async () => {
      const c = await getCoords();
      await queueRpc("mark_arrived", {
        p_stop_id: stop.id,
        ...(c ? { p_latitude: c.latitude, p_longitude: c.longitude } : {}),
      });
    })();
  }, [stop, trip?.status]);

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
    // In the Android app: background tracking + screen on. In a browser: foreground timer.
    let stopNative: (() => void) | null = null;
    let cancelled = false;
    void startTripMode(intervalMs, (c) => {
      void queueRpc("log_location", { p_trip_id: tripId, p_latitude: c.latitude, p_longitude: c.longitude });
    }).then((stop) => {
      if (cancelled) stop?.();
      else if (stop) stopNative = stop;
      else locTimer.current = window.setInterval(() => void tick(), intervalMs);
    });
    return () => {
      cancelled = true;
      stopNative?.();
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
        setError(friendlyError(res.error, t));
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
        setError(friendlyError(res.error, t));
        return;
      }
      setMessage(res.queued ? t("c.tryAgainOffline") : t("dr.stopDone"));
      // Money still owed? Keep the stop open so the driver can collect it on the spot.
      if (Number(stop.orders?.grand_total ?? 0) - Number(stop.orders?.amount_paid ?? 0) <= 0) setSelected(null);
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
        setError(friendlyError(res.error, t));
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
        setError(friendlyError(res.error, t));
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
        setError(friendlyError(res.error, t));
        return;
      }
      setShowTools(null);
      setMessage(res.queued ? t("c.tryAgainOffline") : t("c.saved"));
      setExpAmount("");
      setExpNote("");
      setExpPhoto(null);
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
        setError(friendlyError(res.error, t));
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
        setError(friendlyError(res.error, t));
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
        setError(friendlyError(res.error, t));
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
        setError(friendlyError(res.error, t));
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
        setError(friendlyError(res.error, t));
        return;
      }
      setShowTools(null);
      setMessage(res.queued ? t("c.tryAgainOffline") : t("dr.settled"));
      await fetchAll();
    });
  };

  const doneCount = stops.filter((s) => s.status === "delivered").length;
  // Order: loading done -> security gate out -> driver start checks -> on road.
  const loadingNotDone = trip.status === "planned" || trip.status === "loading";
  const awaitingGateOut = (trip.status === "loaded" || trip.status === "in_progress") && !trip.gate_out_at;
  const canStart = trip.status === "in_progress" && !!trip.gate_out_at && !trip.driver_started_at;
  const onRoad = trip.status === "in_progress" && !!trip.driver_started_at;
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
      className={`rounded-full border px-4 py-3 text-sm font-bold active:bg-accent ${danger ? "border-destructive/50 text-destructive" : "border-input bg-card text-foreground shadow-card"}`}
    >
      {label}
    </button>
  );

  const mapStops = stops.map((s) => ({
    id: s.id,
    seq: s.seq,
    status: s.status,
    lat: s.orders?.delivery_latitude ?? null,
    lng: s.orders?.delivery_longitude ?? null,
    label: s.orders?.business_name || s.orders?.customer_name || "",
  }));

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

      {loadingNotDone && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4 text-center shadow-card">
          <p className="text-sm font-semibold text-foreground">{t("dr.loadingNotDone")}</p>
        </div>
      )}

      {awaitingGateOut && (
        <div className="mb-4 grid gap-3">
          <button
            type="button"
            onClick={() => setShowPass(true)}
            disabled={!gatePass}
            className="flex w-full items-center justify-center gap-3 rounded-xl bg-primary px-6 py-6 text-primary-foreground shadow-soft active:scale-[0.99] disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            <QrCode className="h-8 w-8" />
            <span className="font-display text-xl font-bold">{t("dr.gatePass")}</span>
          </button>
          <p className="text-center text-sm text-muted-foreground">{t("dr.waitGateOut")}</p>
        </div>
      )}

      {showPass && gatePass && (
        <GatePassScreen
          token={gatePass}
          tripNo={trip.trip_no}
          vehicle={trip.vehicles?.reg_no ?? ""}
          driver={staff?.fullName ?? ""}
          items={itemCount}
          onClose={() => {
            setShowPass(false);
            void fetchAll();
          }}
        />
      )}

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
          <div className="mb-3">
            <StopMap stops={mapStops} origin={plant} />
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {settings.expenses_enabled && toolBtn("expense", t("dr.expenses"))}
            {toolBtn("pickup", t("dr.pickup"))}
            {settings.allow_spot_sale && toolBtn("spot", t("dr.spotSale"))}
            {settings.sos_enabled && toolBtn("sos", t("dr.sos"), true)}
            {toolBtn("end", t("dr.endTrip"))}
          </div>

          {showTools === "expense" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-card">
              <p className="mb-2 text-sm font-bold text-foreground">{t("dr.expenses")}</p>
              <div className="grid gap-2">
                <select value={expType} onChange={(e) => setExpType(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30">
                  {(settings.expense_types.length ? settings.expense_types : ["other"]).map((x) => (
                    <option key={x} value={x}>{x}</option>
                  ))}
                </select>
                <input inputMode="decimal" value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder={t("dr.expenseAmount")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
                <input value={expNote} onChange={(e) => setExpNote(e.target.value)} placeholder={t("c.notes")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
                <PhotoInput userId={staff?.id ?? "anon"} kind="expense-bill" label={t("dr.expenseBill")} required={settings.expense_bill_photo_required} value={expPhoto} onChange={setExpPhoto} />
                <button onClick={() => void addExpense()} disabled={busy || expAmount === ""} className="rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground disabled:opacity-50">
                  {t("c.submit")}
                </button>
              </div>
            </div>
          )}

          {showTools === "pickup" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-card">
              <p className="mb-2 text-sm font-bold text-foreground">{t("dr.pickup")}</p>
              <div className="grid gap-2">
                <select value={pickupCustomer} onChange={(e) => setPickupCustomer(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30">
                  <option value="">{t("dr.customer")}</option>
                  {stops.filter((s) => s.orders).map((s) => (
                    <option key={s.id} value={s.orders!.customer_id}>{s.orders!.business_name || s.orders!.customer_name}</option>
                  ))}
                </select>
                <select value={pickupProduct} onChange={(e) => setPickupProduct(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30">
                  <option value="">{t("dr.pickupProduct")}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {products.length === 0 && <p className="text-sm text-muted-foreground">{t("c.none")}</p>}
                <input inputMode="numeric" value={pickupQty} onChange={(e) => setPickupQty(e.target.value.replace(/\D/g, ""))} placeholder={t("dr.pickupQty")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
                <button onClick={() => void addPickup()} disabled={busy || !pickupCustomer || !pickupProduct || pickupQty === ""} className="rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground disabled:opacity-50">
                  {t("c.submit")}
                </button>
              </div>
            </div>
          )}

          {showTools === "spot" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-card">
              <p className="mb-2 text-sm font-bold text-foreground">{t("dr.spotSale")}</p>
              <div className="grid gap-2">
                <select value={spotCustomer} onChange={(e) => setSpotCustomer(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30">
                  <option value="">{t("dr.customer")}</option>
                  {stops.filter((s) => s.orders).map((s) => (
                    <option key={s.id} value={s.orders!.customer_id}>{s.orders!.business_name || s.orders!.customer_name}</option>
                  ))}
                </select>
                <select value={spotProduct} onChange={(e) => setSpotProduct(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30">
                  <option value="">{t("dr.pickupProduct")}</option>
                  {vehicleStock.map((p) => (
                    <option key={p.product_id} value={p.product_id}>
                      {p.name} · {t("dr.leftOnVehicle", { n: p.left })}
                    </option>
                  ))}
                </select>
                {vehicleStock.length === 0 && <p className="text-sm text-muted-foreground">{t("c.none")}</p>}
                <input inputMode="numeric" value={spotQty} onChange={(e) => setSpotQty(e.target.value.replace(/\D/g, ""))} placeholder={t("c.qty")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={spotPaid} onChange={(e) => setSpotPaid(e.target.checked)} className="h-4 w-4 rounded border-input" />
                  {t("dr.paidNow")}
                </label>
                <button onClick={() => void addSpotSale()} disabled={busy || !spotCustomer || !spotProduct || spotQty === ""} className="rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground disabled:opacity-50">
                  {t("c.submit")}
                </button>
              </div>
            </div>
          )}

          {showTools === "sos" && (
            <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <p className="mb-2 text-sm font-bold text-destructive">{t("dr.sos")}</p>
              <input value={sosNote} onChange={(e) => setSosNote(e.target.value)} placeholder={t("dr.sosNote")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
              <button onClick={() => void sendSos()} disabled={busy} className="mt-2 w-full rounded-lg bg-destructive py-4 text-base font-bold text-white active:opacity-80 disabled:opacity-60">
                {t("dr.sos")}
              </button>
            </div>
          )}

          {showTools === "end" && (
            <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-card">
              <p className="mb-1 text-sm font-bold text-foreground">{t("dr.endTrip")}</p>
              <p className="mb-2 text-xs text-muted-foreground">{t("dr.gateInFirst")}</p>
              <div className="grid gap-2">
                <input inputMode="numeric" value={endOdo} onChange={(e) => setEndOdo(e.target.value.replace(/\D/g, ""))} placeholder={t("dr.odometer")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
                <PhotoInput userId={staff?.id ?? "anon"} kind="odo-end" label={t("dr.odometerPhoto")} required={settings.require_end_odometer_photo} value={endOdoPhoto} onChange={setEndOdoPhoto} />
                <button onClick={() => void endTrip()} disabled={busy} className="rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground disabled:opacity-50">
                  {t("dr.endTrip")}
                </button>
              </div>
            </div>
          )}

          <div className="grid gap-2">
            {orderedStops.map((s) => {
              const open = s.status !== "delivered" && s.status !== "failed" && s.status !== "cancelled";
              const isLater = deferred.includes(s.id);
              return (
                <div key={s.id} className="grid gap-1">
                  <StopCard stop={s} done={0} onOpen={() => setSelected(s.id === selected ? null : s.id)} />
                  {open && (
                    <button
                      onClick={() => toggleLater(s.id)}
                      className="self-end rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground active:bg-accent"
                    >
                      {isLater ? `↩ ${t("dr.later")}` : t("dr.doLater")}
                    </button>
                  )}
                </div>
              );
            })}
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
                tripId={tripId}
                stop={stop}
                lines={lines[stop.orders?.id ?? ""] ?? []}
                settings={settings}
                staffId={staff?.id ?? "anon"}
                outstanding={outstanding[stop.id] ?? null}
                upi={firmUpi}
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
        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <p className="text-sm font-bold text-foreground">{t("dr.settle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("dr.cashExpected")}: <span className="font-bold text-foreground">₹{Math.max(0, Number(trip.cash_expected ?? 0) - cashSpent)}</span>
          </p>
          {cashSpent > 0 && (
            <p className="text-xs text-muted-foreground">
              ₹{Number(trip.cash_expected ?? 0)} − {t("dr.expenses")} ₹{cashSpent}
            </p>
          )}
          {canSettle ? (
            <div className="mt-3 grid gap-2">
              <input inputMode="decimal" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} placeholder={t("dr.cashReceived")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
              <input value={settleNote} onChange={(e) => setSettleNote(e.target.value)} placeholder={t("dr.settleNote")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
              <button onClick={() => void settle()} disabled={busy} className="rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground disabled:opacity-50">
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
            {t("dr.cashExpected")}: ₹{Math.max(0, Number(trip.cash_expected ?? 0) - cashSpent)} · {t("dr.cashReceived")}: ₹{trip.cash_received ?? 0}
          </p>
        </div>
      )}
    </Screen>
  );
}
