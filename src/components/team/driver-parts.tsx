// Panels used by the driver trip screen.
import { nativeCoords } from "@/lib/native";
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/l10n";
import { supabase } from "@/integrations/supabase/client";
import { UpiQrCode } from "@/components/team/upi-qr";
import { PhotoInput, StatusBadge } from "@/components/team/ui";
import { uploadDataUrl } from "@/lib/photo";
import { makeChallan } from "@/lib/challan";

/** Vehicle-check labels keyed by the English name; missing/empty → English. */
type CheckNames = Record<string, { name_hi?: string | undefined; name_mr?: string | undefined }>;
let checkNamesCache: CheckNames | null = null;

function useVehicleCheckNames(): CheckNames {
  const [names, setNames] = useState<CheckNames | null>(checkNamesCache);
  useEffect(() => {
    if (checkNamesCache) return;
    let alive = true;
    // The table ships with database/20261101_043_vehicle_check_item_names.sql
    // and is not in the generated types yet — query it loosely typed.
    const req = (
      supabase.from("vehicle_check_item_names" as never) as unknown as {
        select: (cols: string) => PromiseLike<{
          data: { en: string; name_hi: string | null; name_mr: string | null }[] | null;
          error: { message: string } | null;
        }>;
      }
    ).select("en, name_hi, name_mr");
    void req.then(({ data, error }) => {
      if (!alive) return;
      if (error || !data) {
        // Table not created yet (or unreadable) — English fallback.
        checkNamesCache = {};
      } else {
        checkNamesCache = Object.fromEntries(
          data.map((r) => [r.en, { name_hi: r.name_hi ?? undefined, name_mr: r.name_mr ?? undefined }]),
        );
      }
      setNames(checkNamesCache);
    });
    return () => {
      alive = false;
    };
  }, []);
  return names ?? {};
}

export type Settings = {
  require_start_selfie: boolean;
  require_start_odometer: boolean;
  require_start_odometer_photo: boolean;
  vehicle_check_enabled: boolean;
  vehicle_check_items: string[];
  proof_photo_enabled: boolean;
  proof_photo_required: boolean;
  proof_otp_enabled: boolean;
  proof_otp_required: boolean;
  proof_signature_enabled: boolean;
  proof_signature_required: boolean;
  failed_reasons: string[];
  location_tracking_enabled: boolean;
  location_interval_minutes: number;
  expenses_enabled: boolean;
  expense_types: string[];
  expense_bill_photo_required: boolean;
  allow_partial_delivery: boolean;
  allow_extra_load: boolean;
  allow_spot_sale: boolean;
  collect_old_dues: boolean;
  allow_cash: boolean;
  allow_upi: boolean;
  allow_cheque: boolean;
  sos_enabled: boolean;
  require_end_odometer: boolean;
  require_end_odometer_photo: boolean;
  show_outstanding: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  require_start_selfie: true,
  require_start_odometer: true,
  require_start_odometer_photo: true,
  vehicle_check_enabled: false,
  vehicle_check_items: [],
  proof_photo_enabled: true,
  proof_photo_required: false,
  proof_otp_enabled: false,
  proof_otp_required: false,
  proof_signature_enabled: true,
  proof_signature_required: false,
  failed_reasons: [],
  location_tracking_enabled: false,
  location_interval_minutes: 15,
  expenses_enabled: false,
  expense_types: [],
  expense_bill_photo_required: false,
  allow_partial_delivery: true,
  allow_extra_load: false,
  allow_spot_sale: false,
  collect_old_dues: false,
  allow_cash: true,
  allow_upi: true,
  allow_cheque: false,
  sos_enabled: true,
  require_end_odometer: true,
  require_end_odometer_photo: true,
  show_outstanding: true,
};

export async function getCoords(): Promise<{ latitude: number; longitude: number } | null> {
  const native = await nativeCoords();
  if (native) return native;
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 30_000 },
    );
  });
}

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const { t } = useLang();
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = ref.current!.getContext("2d")!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext("2d")!;
    const p = pos(e);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f2937";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    setDirty(true);
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(dirty ? ref.current!.toDataURL("image/png") : null);
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDirty(false);
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={ref}
        width={560}
        height={200}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-28 w-full touch-none rounded-lg border border-input bg-white"
      />
      <button type="button" onClick={clear} className="mt-1 text-xs text-muted-foreground underline">
        {t("dr.clearSign")}
      </button>
    </div>
  );
}

export function StartTripPanel({
  staffId,
  tripId,
  settings,
  checkPhotoRequired,
  onSubmit,
  busy,
  error,
}: {
  staffId: string;
  tripId: string;
  settings: Settings;
  checkPhotoRequired: boolean;
  onSubmit: (v: { selfie: string | null; odometer: string; odoPhoto: string | null; checkPhoto: string | null; checkItems: { item: string; ok: boolean }[] }) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const { t, lang } = useLang();
  const checkNames = useVehicleCheckNames();
  const checkLabel = (item: string) => {
    const n = checkNames[item];
    if (lang === "hi" && n?.name_hi) return n.name_hi;
    if (lang === "mr" && n?.name_mr) return n.name_mr;
    return item;
  };
  const [selfie, setSelfie] = useState<string | null>(null);
  const [odometer, setOdometer] = useState("");
  const [odoPhoto, setOdoPhoto] = useState<string | null>(null);
  const [checkPhoto, setCheckPhoto] = useState<string | null>(null);
  const [checks, setChecks] = useState<string[]>([]);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const submit = async () => {
    setLocalErr(null);
    if (settings.require_start_selfie && !selfie) return setLocalErr(t("dr.needSelfie"));
    if (settings.require_start_odometer && odometer === "") return setLocalErr(t("dr.needOdo"));
    if (settings.require_start_odometer_photo && !odoPhoto) return setLocalErr(t("dr.needPhoto"));
    // Vehicle check is submitted as [{ item, ok }] — the DB validates that every
    // item passed (bool_and) before a trip may start.
    await onSubmit({
      selfie,
      odometer,
      odoPhoto,
      checkPhoto,
      checkItems: settings.vehicle_check_items.map((item) => ({ item, ok: checks.includes(item) })),
    });
  };

  const err = localErr ?? error;
  // Subtitle reflects the enabled steps instead of a fixed list.
  const startSteps = [
    settings.require_start_selfie ? t("dr.selfie") : null,
    settings.require_start_odometer || settings.require_start_odometer_photo ? t("dr.odometer") : null,
    settings.vehicle_check_enabled && settings.vehicle_check_items.length > 0 ? t("dr.vehicleCheck") : null,
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <p className="text-sm font-bold text-foreground">{t("dr.startTrip")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{startSteps.join(" · ")}</p>
      <div className="mt-4 grid gap-4">
        {settings.require_start_selfie && (
          <PhotoInput userId={staffId} kind="selfie" label={t("dr.selfie")} required value={selfie} onChange={setSelfie} />
        )}
        {(settings.require_start_odometer || settings.require_start_odometer_photo) && (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                {t("dr.odometer")} {settings.require_start_odometer && <span className="text-destructive">*</span>}
              </label>
              <input
                inputMode="numeric"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-lg border border-input bg-background px-3 py-3 text-base font-semibold outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30"
              />
            </div>
            {settings.require_start_odometer_photo && (
              <PhotoInput userId={staffId} kind="odo-start" label={t("dr.odometerPhoto")} required value={odoPhoto} onChange={setOdoPhoto} />
            )}
          </>
        )}
        {settings.vehicle_check_enabled && settings.vehicle_check_items.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-foreground">{t("dr.vehicleCheck")}</p>
            <div className="grid gap-2">
              {settings.vehicle_check_items.map((item) => (
                <label key={item} className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={checks.includes(item)}
                    onChange={(e) => setChecks((s) => (e.target.checked ? [...s, item] : s.filter((x) => x !== item)))}
                    className="h-4 w-4 rounded border-input"
                  />
                  {checkLabel(item)}
                </label>
              ))}
            </div>
            <div className="mt-3">
              <PhotoInput userId={staffId} kind="vehicle-check" label={t("dr.vehicleCheckPhoto")} required={checkPhotoRequired} value={checkPhoto} onChange={setCheckPhoto} />
            </div>
          </div>
        )}
        {err && <p className="text-sm font-medium text-destructive">{err}</p>}
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground active:opacity-80 disabled:opacity-60"
        >
          {busy ? t("c.loading") : t("dr.startTrip")}
        </button>
      </div>
    </div>
  );
}

export type StopRow = {
  id: string;
  seq: number;
  status: string;
  fail_reason: string | null;
  do_later_at?: string | null;
  arrived_at: string | null;
  orders: {
    id: string;
    customer_id: string;
    order_no: string;
    business_name: string | null;
    customer_name: string | null;
    delivery_address_text: string | null;
    grand_total: number | null;
    amount_paid: number | null;
    payment_mode: string | null;
    payment_method?: string | null;
    customer_mobile?: string | null;
    delivery_latitude: number | null;
    delivery_longitude: number | null;
    firm_id?: string | null;
  } | null;
};

export type LineRow = { id: string; product_name: string; pack_label: string | null; qty: number; value?: number; line_total?: number | null; deposit_total?: number | null; kept?: number };

/** Value of what the customer keeps: delivered good qty × order price (short/refused/damaged not charged). */
export function keptValue(lines: LineRow[], keptQty: (l: LineRow) => number) {
  return Math.round(lines.reduce((a, l) => a + (l.qty > 0 ? (Number(l.value ?? 0) * Math.max(0, Math.min(l.qty, keptQty(l)))) / l.qty : 0), 0) * 100) / 100;
}

export function StopCard({
  stop,
  done,
  onOpen,
}: {
  stop: StopRow;
  done: number;
  onOpen: () => void;
}) {
  const { t } = useLang();
  const o = stop.orders;
  return (
    <button onClick={onOpen} className="block w-full rounded-xl border border-border bg-card p-4 text-left transition-colors active:bg-accent">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{t("dr.stop", { n: stop.seq })}</span>
        <StatusBadge status={stop.status} />
      </div>
      <p className="mt-1 text-sm text-foreground">{o?.business_name || o?.customer_name || "—"}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{o?.delivery_address_text ?? ""}</p>
      {done > 0 && <p className="mt-1 text-xs font-medium text-emerald-600">{t("dr.deliveredStops", { done, total: 1 })}</p>}
    </button>
  );
}

export function StopDetailPanel({
  tripId,
  stop,
  lines,
  settings,
  staffId,
  outstanding,
  onSubmitDelivery,
  onSubmitCollection,
  onSubmitDueCollection,
  busy,
  error,
  message,
  upi,
}: {
  tripId: string;
  stop: StopRow;
  lines: LineRow[];
  settings: Settings;
  staffId: string;
  outstanding: number | null;
  upi?: { id: string; payee: string | null } | null;
  onSubmitDelivery: (v: { lines: { order_line_id: string; delivered: number; short: number; damaged: number; refused: number; empties: number }[]; fail: boolean; failReason: string; failNote: string; photo: string | null; signature: string | null; otp: string; skipPay?: boolean }) => Promise<void>;
  onSubmitCollection: (v: { mode: string; amount: string; reference: string; photo: string | null; keepOpen?: boolean }) => Promise<void>;
  onSubmitDueCollection: (v: { amount: string; mode: string; reference: string; photo: string | null }) => Promise<void>;
  busy: boolean;
  error: string | null;
  message: string | null;
}) {
  const { t } = useLang();
  const o = stop.orders;
  const delivered = stop.status === "delivered";
  // Partial stops also allow collecting the remaining payment.
  const canCollect = delivered || stop.status === "partial";
  const [qty, setQty] = useState<Record<string, { delivered: string; damaged: string; refused: string; empties: string }>>({});
  const [failMode, setFailMode] = useState(false);
  const [failReason, setFailReason] = useState(settings.failed_reasons[0] ?? "");
  const [failNote, setFailNote] = useState("");
  const [different, setDifferent] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);
  // Cash/UPI orders: the driver must say what was paid. Part/None needs the office's OK.
  const needsPayCheckBase = stop.status === "pending" && (o?.payment_mode ?? "") === "cod";
  const [officeOk, setOfficeOk] = useState(false);
  const [officeRejected, setOfficeRejected] = useState(false);

  // Collection mode must be a payment channel (cash/upi/cheque), not the
  // order's payment_mode (cod/credit/prepaid) — trip_collections validates it.
  // Pre-select the payment channel chosen on the order (cash / upi / cheque).
  const orderMethod = String(o?.payment_method ?? "").toLowerCase();
  const [mode, setMode] = useState(["cash", "upi", "cheque"].includes(orderMethod) ? orderMethod : "cash");
  const [addOldDues, setAddOldDues] = useState(false);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [payPhoto, setPayPhoto] = useState<string | null>(null);
  const [splitCash, setSplitCash] = useState("");
  const [dueAmount, setDueAmount] = useState("");
  const [dueMode, setDueMode] = useState("cash");
  const [dueReference, setDueReference] = useState("");
  // Udhaar: only for customers allowed credit in Command Center.
  const [udhaarOk, setUdhaarOk] = useState(false);
  const [udhaarMsg, setUdhaarMsg] = useState<string | null>(null);
  const [udhaarTaken, setUdhaarTaken] = useState(false);
  const [payChoice, setPayChoice] = useState<"full" | "part" | "none" | null>(null);
  useEffect(() => {
    let live = true;
    void supabase.rpc("stop_udhaar_check" as never, { p_stop_id: stop.id } as never).then(({ data }) => {
      const r = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean } | null;
      if (live) setUdhaarOk(Boolean(r?.allowed));
    });
    return () => { live = false; };
  }, [stop.id]);
  // Call: order phone → delivery address contact → customer mobile (looked up server-side).
  const [phone, setPhone] = useState<string | null>(String(o?.customer_mobile ?? "").trim() || null);
  const [challanBusy, setChallanBusy] = useState(false);
  useEffect(() => {
    if (o?.customer_mobile?.trim()) { setPhone(o.customer_mobile.trim()); return; }
    let live = true;
    void supabase.rpc("stop_contact_phone" as never, { p_stop_id: stop.id } as never).then(({ data }) => {
      const p = String((data as unknown) ?? "").trim();
      if (live) setPhone(p || null);
    });
    return () => { live = false; };
  }, [stop.id, o?.customer_mobile]);
  const takeUdhaar = async (amt: number) => {
    setUdhaarMsg(null);
    const { data, error } = await supabase.rpc("stop_take_udhaar" as never, { p_stop_id: stop.id, p_amount: amt } as never);
    if (error) return setLocalErr(error.message);
    if (data) { setOfficeOk(true); setUdhaarTaken(true); setUdhaarMsg(t("dr.udhaarSaved")); }
    else setUdhaarMsg(t("dr.udhaarAsk"));
  };

  useEffect(() => {
    setQty(Object.fromEntries(lines.map((l) => [l.id, { delivered: String(l.qty), damaged: "", refused: "", empties: "" }])));
  }, [lines]);

  const hasValues = lines.some((l) => l.value != null);
  const kept = hasValues
    ? keptValue(lines, (l) => (stop.status === "pending" ? (failMode ? 0 : Number(qty[l.id]?.delivered ?? l.qty)) : Number(l.kept ?? l.qty)))
    : Number(o?.grand_total ?? 0);
  const due = Math.max(0, kept - Number(o?.amount_paid ?? 0));
  const needsPayCheck = needsPayCheckBase && due > 0;
  const oldDues = outstanding != null && outstanding > 0 && settings.collect_old_dues ? outstanding : 0;
  const toCollect = due + (addOldDues ? oldDues : 0);

  const submitDelivery = async () => {
    setLocalErr(null);
    // deliver_stop expects { order_line_id, delivered, short, damaged, refused,
    // empties } and the outcome quantities must add up to the ordered qty.
    // Short = whatever is not delivered, damaged or refused (goes back to stock).
    const linesOut = lines.map((l) => {
      const d = qty[l.id] ?? { delivered: String(l.qty), damaged: "", refused: "", empties: "" };
      const empties = Number(d.empties || 0);
      // A failed stop records nothing as delivered — everything goes back as short.
      if (failMode) return { order_line_id: l.id, delivered: 0, short: l.qty, damaged: 0, refused: 0, empties };
      const delivered = Number(d.delivered || 0);
      const damaged = Number(d.damaged || 0);
      const refused = Number(d.refused || 0);
      return { order_line_id: l.id, delivered, short: Math.max(0, l.qty - delivered - damaged - refused), damaged, refused, empties };
    });
    if (!failMode) {
      for (const [i, v] of linesOut.entries()) {
        const l = lines[i];
        if (!l) continue;
        if (v.delivered + v.damaged + v.refused > l.qty) {
          return setLocalErr(`${l.product_name}: ${t("dr.qtyOverflow")}`);
        }
      }
      if (settings.proof_photo_required && !photo) return setLocalErr(t("dr.needPhoto"));
      if (settings.proof_otp_required && otp === "") return setLocalErr(`${t("dr.verifyOtp")} — ${t("c.required")}`);
    }
    await onSubmitDelivery({ lines: linesOut, fail: failMode, failReason, failNote, photo, signature, otp, skipPay: officeOk && (payChoice === "none" || udhaarTaken) });
  };

  const submitCollection = async () => {
    setLocalErr(null);
    if (mode !== "split") {
      return onSubmitCollection({ mode, amount: amount === "" ? String(toCollect) : amount, reference, photo: payPhoto });
    }
    const cash = Number(splitCash || 0);
    const upiPart = Math.round((toCollect - cash) * 100) / 100;
    if (!(cash > 0) || !(upiPart > 0)) return setLocalErr(t("dr.splitBad"));
    await onSubmitCollection({ mode: "cash", amount: String(cash), reference: "", photo: payPhoto, keepOpen: true });
    await onSubmitCollection({ mode: "upi", amount: String(upiPart), reference, photo: payPhoto });
  };

  const err = localErr ?? error;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-foreground">
          {t("dr.stop", { n: stop.seq })} · {o?.order_no}
        </p>
        <StatusBadge status={stop.status} />
      </div>
      <p className="mt-1 text-sm text-foreground">{o?.business_name || o?.customer_name}</p>
      {o?.delivery_address_text && <p className="mt-0.5 text-xs text-muted-foreground">{o.delivery_address_text}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a
          href={o?.delivery_latitude != null && o?.delivery_longitude != null ? `https://www.google.com/maps/dir/?api=1&destination=${o.delivery_latitude},${o.delivery_longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o?.delivery_address_text ?? "")}`}
          target="_blank" rel="noreferrer"
          className="rounded-lg border border-border bg-background py-3 text-center text-sm font-bold text-foreground active:bg-accent"
        >🧭 {t("dr.map")}</a>
        {phone ? (
          <a href={`tel:${phone}`} className="rounded-lg border border-border bg-background py-3 text-center text-sm font-bold text-foreground active:bg-accent">📞 {t("dr.call")}</a>
        ) : (
          <span className="rounded-lg border border-border bg-muted py-3 text-center text-sm font-bold text-muted-foreground opacity-60">📞 {t("dr.call")}</span>
        )}
      </div>
      <button
        type="button"
        disabled={challanBusy}
        onClick={async () => {
          setChallanBusy(true);
          try {
            await makeChallan({ orderNo: o?.order_no ?? "", firmId: o?.firm_id, customer: o?.business_name || o?.customer_name || "", address: o?.delivery_address_text, phone, lines });
          } catch (e) {
            setLocalErr(e instanceof Error ? e.message : String(e));
          } finally {
            setChallanBusy(false);
          }
        }}
        className="mt-2 w-full rounded-lg border border-border bg-background py-3 text-center text-sm font-bold text-foreground active:bg-accent disabled:opacity-60"
      >📄 {t("dr.challan")}</button>

      {!delivered && (
        <>
          <div className="mt-4 grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{different ? t("dr.deliveredQty") : t("dr.allAsOrdered")}</p>
              {settings.allow_partial_delivery && !different && (
                <button type="button" onClick={() => setDifferent(true)} className="text-xs font-semibold text-navy underline">
                  {t("dr.somethingDifferent")}
                </button>
              )}
            </div>
            {!different && lines.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
                <p className="min-w-0 truncate text-sm text-foreground">{l.product_name}{l.pack_label ? ` · ${l.pack_label}` : ""}</p>
                <span className="font-display text-lg font-bold text-foreground">{l.qty}</span>
              </div>
            ))}
            {different && lines.map((l) => {
              const d = qty[l.id] ?? { delivered: String(l.qty), damaged: "", refused: "", empties: "" };
              const set = (k: "delivered" | "damaged" | "refused" | "empties", raw: string) =>
                setQty((s) => ({ ...s, [l.id]: { ...d, [k]: raw.replace(/\D/g, "") } }));
              return (
                <div key={l.id} className="rounded-lg bg-muted/50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-foreground">{l.product_name}</p>
                      {l.pack_label && <p className="text-xs text-muted-foreground">{l.pack_label}</p>}
                    </div>
                    <input
                      inputMode="numeric"
                      value={d.delivered}
                      onChange={(e) => set("delivered", e.target.value)}
                      disabled={!settings.allow_partial_delivery}
                      className="w-16 rounded-md border border-input bg-background px-2 py-2.5 text-center text-base font-semibold outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30 disabled:opacity-60"
                    />
                  </div>
                  {settings.allow_partial_delivery && (
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[10px] font-medium uppercase text-muted-foreground">{t("dr.damaged")}</label>
                        <input inputMode="numeric" value={d.damaged} onChange={(e) => set("damaged", e.target.value)} placeholder="0" className="w-full rounded-md border border-input bg-background px-2 py-2.5 text-center text-base font-semibold outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium uppercase text-muted-foreground">{t("dr.refused")}</label>
                        <input inputMode="numeric" value={d.refused} onChange={(e) => set("refused", e.target.value)} placeholder="0" className="w-full rounded-md border border-input bg-background px-2 py-2.5 text-center text-base font-semibold outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium uppercase text-muted-foreground">{t("dr.empties")}</label>
                        <input inputMode="numeric" value={d.empties} onChange={(e) => set("empties", e.target.value)} placeholder="0" className="w-full rounded-md border border-input bg-background px-2 py-2.5 text-center text-base font-semibold outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {settings.proof_photo_enabled && (
            <div className="mt-4">
              <PhotoInput userId={staffId} kind={`proof-${stop.id}`} label={t("dr.proofPhoto")} required={settings.proof_photo_required} value={photo} onChange={setPhoto} />
            </div>
          )}
          {settings.proof_signature_enabled && (
            <div className="mt-4">
              <p className="mb-1 text-sm font-medium text-foreground">
                {t("dr.signature")} {settings.proof_signature_required && <span className="text-destructive">*</span>}
              </p>
              <SignaturePad onChange={setSignature} />
            </div>
          )}
          {settings.proof_otp_enabled && (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-foreground">
                {t("dr.deliveryOtp")} {settings.proof_otp_required && <span className="text-destructive">*</span>}
              </label>
              <OtpBoxes value={otp} onChange={setOtp} />
            </div>
          )}
        </>
      )}

      {canCollect && due > 0 && (
        <div className="mt-4 rounded-lg bg-muted/60 p-3">
          <p className="text-sm font-medium text-foreground">{t("dr.amountDue")}: ₹{due}</p>
        </div>
      )}

      {outstanding != null && outstanding > 0 && settings.collect_old_dues && !delivered && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-semibold text-foreground">{t("dr.oldDue")}: ₹{outstanding}</p>
          <div className="mt-2 grid gap-2">
            <input inputMode="decimal" value={dueAmount} onChange={(e) => setDueAmount(e.target.value)} placeholder={t("dr.dueAmount")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
          </div>
          <div className="mt-2"><ModeChips settings={settings} value={dueMode} onChange={setDueMode} /></div>
          {dueMode === "upi" && upi && upi.id && (
            <div className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-center">
              <UpiQrCode pa={upi.id} pn={upi.payee} amount={Number(dueAmount || outstanding) || null} tn={o?.order_no ?? null} />
            </div>
          )}
          <input value={dueReference} onChange={(e) => setDueReference(e.target.value)} placeholder={t("dr.reference")} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
          <button
            onClick={() => void onSubmitDueCollection({ amount: dueAmount, mode: dueMode, reference: dueReference, photo: payPhoto })}
            disabled={busy || dueAmount === ""}
            className="mt-2 w-full rounded-lg border border-amber-500/60 py-3.5 text-base font-bold text-foreground active:bg-accent disabled:opacity-50"
          >
            {t("dr.recordCollection")}
          </button>
        </div>
      )}

      {!delivered && (
        <>
          <label className="mt-4 flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={failMode} onChange={(e) => setFailMode(e.target.checked)} className="h-4 w-4 rounded border-input" />
            {t("dr.markFailed")}
          </label>
          {failMode && (
            <div className="mt-2 grid gap-2">
              {settings.failed_reasons.length > 0 && (
                <select value={failReason} onChange={(e) => setFailReason(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30">
                  {settings.failed_reasons.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              )}
              <input value={failNote} onChange={(e) => setFailNote(e.target.value)} placeholder={t("dr.failNote")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
            </div>
          )}
          {officeRejected && failMode && (
            <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{t("dr.officeRejected")}</p>
          )}
          {needsPayCheck && !failMode && udhaarOk && !officeOk && (
            <button type="button" onClick={() => void takeUdhaar(due)} disabled={busy} className="mt-4 w-full rounded-lg border-2 border-amber-500/60 py-3 text-base font-bold text-foreground active:bg-accent disabled:opacity-60">
              {t("dr.udhaar")} ₹{due}
            </button>
          )}
          {udhaarMsg && <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm font-medium text-foreground">{udhaarMsg}</p>}
          {needsPayCheck && !failMode && (
            <AskOfficePanel
              tripId={tripId}
              stopId={stop.id}
              due={due}
              onChoose={(full, v) => { setOfficeOk(full); setPayChoice(v); }}
              onDecision={(ok) => {
                setOfficeOk(ok);
                if (!ok) {
                  setOfficeRejected(true);
                  setFailMode(true);
                }
              }}
            />
          )}
          <button
            onClick={() => void submitDelivery()}
            disabled={busy || (needsPayCheck && !failMode && !officeOk)}
            className={`mt-4 w-full rounded-lg py-3 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60 ${failMode ? "bg-destructive" : "bg-primary"}`}
          >
            {busy ? t("c.loading") : failMode ? t("dr.markFailed") : t("dr.deliver")}
          </button>
        </>
      )}

      {canCollect && due > 0 && (
        <div className="mt-4 grid gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("dr.toCollect")}</p>
          <p className="text-sm text-muted-foreground">{t("dr.todayGoods")} ₹{due}</p>
          {oldDues > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2">
              <span className="text-sm text-foreground">{t("dr.oldDue")} ₹{oldDues}</span>
              <button type="button" onClick={() => setAddOldDues((v) => !v)} className={`rounded-md border px-3 py-1.5 text-sm font-bold ${addOldDues ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground"}`}>
                {addOldDues ? "✓" : `+ ${t("dr.add")}`}
              </button>
            </div>
          )}
          <p className="font-display text-3xl font-extrabold text-foreground">₹{toCollect}</p>
          {mode !== "split" && (
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(toCollect)} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
          )}
          <ModeChips settings={settings} value={mode} onChange={setMode} split />
          {mode === "split" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
                {t("dr.modeCash")}
                <input inputMode="decimal" value={splitCash} onChange={(e) => setSplitCash(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" className="rounded-lg border border-input bg-background px-3 py-3 text-base text-foreground outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
              </label>
              <div className="grid gap-1 text-xs font-semibold text-muted-foreground">
                {t("dr.modeUpi")}
                <p className="rounded-lg bg-muted px-3 py-3 text-base font-bold text-foreground">₹{Math.max(0, Math.round((toCollect - Number(splitCash || 0)) * 100) / 100)}</p>
              </div>
            </div>
          )}
          {mode !== "cash" && (
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("dr.reference")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
          )}
          {(mode === "upi" || mode === "split") && upi && upi.id && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-center">
              <UpiQrCode pa={upi.id} pn={upi.payee} amount={(mode === "split" ? Math.max(0, toCollect - Number(splitCash || 0)) : Number(amount || toCollect)) || null} tn={o?.order_no ?? null} />
              <p className="mt-1 text-xs text-muted-foreground">{upi.payee ?? ""}</p>
              <p className="font-mono text-sm font-semibold text-foreground">{upi.id || "—"}</p>
            </div>
          )}
          <PhotoInput userId={staffId} kind={`pay-${stop.id}`} label={t("c.camera")} value={payPhoto} onChange={setPayPhoto} />
          <button
            onClick={() => void submitCollection()}
            disabled={busy}
            className="rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground active:opacity-80 disabled:opacity-60"
          >
            {t("dr.recordCollection")}
          </button>
        </div>
      )}

      {message && <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">{message}</p>}
      {err && <p className="mt-3 text-sm font-medium text-destructive">{err}</p>}
    </div>
  );
}

export async function signatureToPath(dataUrl: string | null, staffId: string, stopId: string): Promise<string | null> {
  if (!dataUrl) return null;
  try {
    return await uploadDataUrl(dataUrl, staffId, `sign-${stopId}`);
  } catch {
    return dataUrl; // keep the raw data URL if upload fails (e.g. offline)
  }
}

const PAY_REASONS = ["dr.rsnLater", "dr.rsnCheque", "dr.rsnRefused", "dr.rsnOwnerAway"] as const;

/** Full / Part / None. Part or None → "Ask office" and wait for Approve / Reject (or the no-reply rule). */
function AskOfficePanel({ tripId, stopId, due, onChoose, onDecision }: { tripId: string; stopId: string; due: number; onChoose: (full: boolean, v: "full" | "part" | "none") => void; onDecision: (ok: boolean) => void }) {
  const { t } = useLang();
  const [pay, setPay] = useState<"full" | "part" | "none" | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState<string>(PAY_REASONS[0]);
  const [alertId, setAlertId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const decide = useRef(onDecision);
  decide.current = onDecision;

  useEffect(() => {
    if (!alertId || result) return;
    let stop = false;
    const tick = async () => {
      const { data, error } = await supabase.rpc("ask_office_status" as never, { p_alert_id: alertId } as never);
      if (stop) return;
      if (error) return setErr(error.message);
      const d = data as unknown as { resolution: string | null; deadline: string; now: string } | null;
      if (!d) return;
      setLeft(Math.max(0, Math.round((new Date(d.deadline).getTime() - new Date(d.now).getTime()) / 1000)));
      if (d.resolution) {
        setResult(d.resolution);
        const ok = d.resolution === "approved" || d.resolution === "no_reply:deliver_and_flag";
        decide.current(ok);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 10000);
    return () => { stop = true; window.clearInterval(id); };
  }, [alertId, result]);

  const choose = (v: "full" | "part" | "none") => {
    setPay(v);
    setErr(null);
    onChoose(v === "full", v);
  };

  const ask = async () => {
    if (pay === "part" && !(Number(amount) > 0 && Number(amount) < due)) return setErr(t("dr.partAmountBad"));
    setSending(true);
    setErr(null);
    const { data, error } = await supabase.rpc("ask_office" as never, {
      p_trip_id: tripId, p_stop_id: stopId, p_mode: pay, p_amount: pay === "part" ? Number(amount) : 0, p_reason: t(reason as never),
    } as never);
    setSending(false);
    if (error) return setErr(error.message);
    setAlertId(data as unknown as string);
  };

  const opt = (v: "full" | "part" | "none", label: string) => (
    <button
      key={v}
      onClick={() => choose(v)}
      disabled={alertId !== null}
      className={`rounded-lg border py-3 text-sm font-bold ${pay === v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground"} disabled:opacity-60`}
    >
      {label}
    </button>
  );

  const resultText = result === "approved" ? t("dr.officeApproved")
    : result === "rejected" ? t("dr.officeRejected")
    : result === "no_reply:deliver_and_flag" ? t("dr.officeNoReplyDeliver")
    : result ? t("dr.officeNoReplyStop") : null;
  const resultOk = result === "approved" || result === "no_reply:deliver_and_flag";

  return (
    <div className="mt-4 grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("dr.payReceived", { n: due })}</p>
      <div className="grid grid-cols-3 gap-2">
        {opt("full", t("dr.payFull"))}
        {opt("part", t("dr.payPart"))}
        {opt("none", t("dr.payNone"))}
      </div>
      {(pay === "part" || pay === "none") && !alertId && (
        <>
          {pay === "part" && (
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder={t("dr.partAmount")} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
          )}
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30">
            {PAY_REASONS.map((r) => <option key={r} value={r}>{t(r)}</option>)}
          </select>
          <button onClick={() => void ask()} disabled={sending} className="rounded-lg bg-primary py-3 text-sm font-bold text-primary-foreground active:opacity-80 disabled:opacity-60">
            {sending ? t("c.loading") : t("dr.askOffice")}
          </button>
        </>
      )}
      {alertId && !result && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-400">
          {t("dr.waitingOffice")}{left != null ? ` · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : ""}
        </p>
      )}
      {resultText && (
        <p className={`rounded-lg px-3 py-2 text-sm font-medium ${resultOk ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive"}`}>{resultText}</p>
      )}
      {err && <p className="text-sm font-medium text-destructive">{err}</p>}
    </div>
  );
}

/** Big tap buttons for the payment channel (Cash · UPI QR · Cheque). */
function ModeChips({ settings, value, onChange, split = false }: { settings: Settings; value: string; onChange: (v: string) => void; split?: boolean }) {
  const { t } = useLang();
  const modes = [
    settings.allow_cash && { v: "cash", label: t("dr.modeCash") },
    settings.allow_upi && { v: "upi", label: t("dr.modeUpi") },
    settings.allow_cheque && { v: "cheque", label: t("dr.modeCheque") },
    split && settings.allow_cash && settings.allow_upi && { v: "split", label: t("dr.modeSplit") },
  ].filter(Boolean) as { v: string; label: string }[];
  return (
    <div className={`grid gap-2 ${modes.length > 3 ? "grid-cols-2" : "grid-cols-3"}`}>
      {modes.map((m) => (
        <button
          key={m.v}
          type="button"
          onClick={() => onChange(m.v)}
          className={`rounded-lg border py-3 text-sm font-bold ${value === m.v ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground"}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Four big boxes for the customer's delivery OTP. */
function OtpBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: 4 }, (_, i) => value[i] ?? "");
  const setAt = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, "");
    if (d.length > 1) {
      onChange(d.slice(0, 4));
      refs.current[Math.min(3, d.length - 1)]?.focus();
      return;
    }
    const next = [...digits];
    next[i] = d;
    onChange(next.join("").slice(0, 4));
    if (d && i < 3) refs.current[i + 1]?.focus();
  };
  return (
    <div className="flex gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label={`OTP ${i + 1}`}
          value={d}
          onChange={(e) => setAt(i, e.target.value)}
          onKeyDown={(e) => { if (e.key === "Backspace" && !d && i > 0) refs.current[i - 1]?.focus(); }}
          className="h-14 w-12 rounded-lg border border-input bg-background text-center font-display text-2xl font-bold text-foreground outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30"
        />
      ))}
    </div>
  );
}
