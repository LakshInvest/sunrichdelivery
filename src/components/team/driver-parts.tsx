// Panels used by the driver trip screen.
import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/l10n";
import { PhotoInput, StatusBadge } from "@/components/team/ui";
import { uploadDataUrl } from "@/lib/photo";

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
        Clear
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
  onSubmit: (v: { selfie: string | null; odometer: string; odoPhoto: string | null; checkPhoto: string | null; checks: string[] }) => Promise<void>;
  busy: boolean;
  error: string | null;
}) {
  const { t } = useLang();
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
    await onSubmit({ selfie, odometer, odoPhoto, checkPhoto, checks });
  };

  const err = localErr ?? error;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-bold text-foreground">{t("dr.startTrip")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{t("dr.startSub")}</p>
      <div className="mt-4 grid gap-4">
        {(settings.require_start_selfie || settings.require_start_odometer_photo || settings.require_start_odometer) && (
          <>
            <PhotoInput userId={staffId} kind="selfie" label={t("dr.selfie")} required={settings.require_start_selfie} value={selfie} onChange={setSelfie} />
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">
                {t("dr.odometer")} {settings.require_start_odometer && <span className="text-destructive">*</span>}
              </label>
              <input
                inputMode="numeric"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <PhotoInput userId={staffId} kind="odo-start" label={t("dr.odometerPhoto")} required={settings.require_start_odometer_photo} value={odoPhoto} onChange={setOdoPhoto} />
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
                  {item}
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
          className="rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60"
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
  orders: {
    id: string;
    order_no: string;
    business_name: string | null;
    customer_name: string | null;
    delivery_address_text: string | null;
    grand_total: number | null;
    amount_paid: number | null;
    payment_mode: string | null;
  } | null;
};

export type LineRow = { id: string; product_name: string; pack_label: string | null; qty: number };

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
}: {
  stop: StopRow;
  lines: LineRow[];
  settings: Settings;
  staffId: string;
  outstanding: number | null;
  onSubmitDelivery: (v: { lines: { line_id: string; delivered_qty: number }[]; fail: boolean; failReason: string; failNote: string; photo: string | null; signature: string | null; otp: string }) => Promise<void>;
  onSubmitCollection: (v: { mode: string; amount: string; reference: string; photo: string | null }) => Promise<void>;
  onSubmitDueCollection: (v: { amount: string; mode: string; reference: string; photo: string | null }) => Promise<void>;
  busy: boolean;
  error: string | null;
  message: string | null;
}) {
  const { t } = useLang();
  const o = stop.orders;
  const delivered = stop.status === "delivered";
  const [qty, setQty] = useState<Record<string, string>>({});
  const [failMode, setFailMode] = useState(false);
  const [failReason, setFailReason] = useState(settings.failed_reasons[0] ?? "");
  const [failNote, setFailNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [localErr, setLocalErr] = useState<string | null>(null);

  const [mode, setMode] = useState(o?.payment_mode ?? "cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [payPhoto, setPayPhoto] = useState<string | null>(null);
  const [dueAmount, setDueAmount] = useState("");
  const [dueMode, setDueMode] = useState("cash");
  const [dueReference, setDueReference] = useState("");

  useEffect(() => {
    setQty(Object.fromEntries(lines.map((l) => [l.id, String(l.qty)])));
  }, [lines]);

  const due = Math.max(0, Number(o?.grand_total ?? 0) - Number(o?.amount_paid ?? 0));

  const submitDelivery = async () => {
    setLocalErr(null);
    const linesOut = lines.map((l) => ({ line_id: l.id, delivered_qty: Number(qty[l.id] ?? l.qty) }));
    if (!failMode) {
      if (settings.proof_photo_required && !photo) return setLocalErr(t("dr.needPhoto"));
      if (settings.proof_otp_required && otp === "") return setLocalErr(`${t("dr.verifyOtp")} — ${t("c.required")}`);
    }
    await onSubmitDelivery({ lines: linesOut, fail: failMode, failReason, failNote, photo, signature, otp });
  };

  const err = localErr ?? error;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-foreground">
          {t("dr.stop", { n: stop.seq })} · {o?.order_no}
        </p>
        <StatusBadge status={stop.status} />
      </div>
      <p className="mt-1 text-sm text-foreground">{o?.business_name || o?.customer_name}</p>
      {o?.delivery_address_text && <p className="mt-0.5 text-xs text-muted-foreground">{o.delivery_address_text}</p>}

      {!delivered && (
        <>
          <div className="mt-4 grid gap-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("dr.deliveredQty")}</p>
            {lines.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{l.product_name}</p>
                  {l.pack_label && <p className="text-xs text-muted-foreground">{l.pack_label}</p>}
                </div>
                <input
                  inputMode="numeric"
                  value={qty[l.id] ?? ""}
                  onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value.replace(/\D/g, "") }))}
                  disabled={!settings.allow_partial_delivery}
                  className="w-16 rounded-md border border-input bg-background px-2 py-1.5 text-center text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                />
              </div>
            ))}
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
              <input
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-center text-sm tracking-[0.3em] outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </>
      )}

      {delivered && due > 0 && (
        <div className="mt-4 rounded-lg bg-muted/60 p-3">
          <p className="text-sm font-medium text-foreground">{t("dr.amountDue")}: ₹{due}</p>
        </div>
      )}

      {outstanding != null && outstanding > 0 && settings.collect_old_dues && !delivered && (
        <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-sm font-semibold text-foreground">{t("dr.oldDue")}: ₹{outstanding}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input inputMode="decimal" value={dueAmount} onChange={(e) => setDueAmount(e.target.value)} placeholder={t("dr.dueAmount")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            <select value={dueMode} onChange={(e) => setDueMode(e.target.value)} className="rounded-lg border border-input bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              {settings.allow_cash && <option value="cash">Cash</option>}
              {settings.allow_upi && <option value="upi">UPI</option>}
              {settings.allow_cheque && <option value="cheque">Cheque</option>}
            </select>
          </div>
          <input value={dueReference} onChange={(e) => setDueReference(e.target.value)} placeholder={t("dr.reference")} className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          <button
            onClick={() => void onSubmitDueCollection({ amount: dueAmount, mode: dueMode, reference: dueReference, photo: payPhoto })}
            disabled={busy || dueAmount === ""}
            className="mt-2 w-full rounded-lg border border-amber-500/60 py-2 text-sm font-semibold text-foreground active:bg-accent disabled:opacity-50"
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
                <select value={failReason} onChange={(e) => setFailReason(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
                  {settings.failed_reasons.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              )}
              <input value={failNote} onChange={(e) => setFailNote(e.target.value)} placeholder={t("dr.failNote")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </div>
          )}
          <button
            onClick={() => void submitDelivery()}
            disabled={busy}
            className={`mt-4 w-full rounded-lg py-3 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60 ${failMode ? "bg-destructive" : "bg-primary"}`}
          >
            {busy ? t("c.loading") : failMode ? t("dr.markFailed") : t("dr.deliver")}
          </button>
        </>
      )}

      {delivered && due > 0 && (
        <div className="mt-4 grid gap-2">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("dr.recordCollection")}</p>
          <div className="grid grid-cols-2 gap-2">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(due)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="rounded-lg border border-input bg-background px-2 py-2 text-sm outline-none focus:ring-2 focus:ring-ring">
              {settings.allow_cash && <option value="cash">Cash</option>}
              {settings.allow_upi && <option value="upi">UPI</option>}
              {settings.allow_cheque && <option value="cheque">Cheque</option>}
            </select>
          </div>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("dr.reference")} className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          <PhotoInput userId={staffId} kind={`pay-${stop.id}`} label={t("c.camera")} value={payPhoto} onChange={setPayPhoto} />
          <button
            onClick={() => void onSubmitCollection({ mode, amount: amount === "" ? String(due) : amount, reference, photo: payPhoto })}
            disabled={busy}
            className="rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-60"
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
