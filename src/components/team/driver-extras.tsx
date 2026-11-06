// Driver extras: hand a stop to another vehicle, spot-sale customer picker, trip alerts list.
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { friendlyError } from "@/lib/friendly-error";
import { istDisplay } from "@/lib/ist";
import { getCoords } from "@/components/team/driver-parts";

const input = "w-full rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args: Record<string, unknown>) => (supabase.rpc as any)(name, args) as Promise<{ data: any; error: { message: string } | null }>;

type OtherTrip = { trip_id: string; trip_no: string; vehicle_no: string | null; driver_name: string | null; status: string };

/** "Dusri gaadi ne deliver kiya": move my pending stop to another trip on the road. */
export function HandoverStop({ tripId, stopId, onDone }: { tripId: string; stopId: string; onDone: (msg: string) => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [trips, setTrips] = useState<OtherTrip[] | null>(null);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || trips) return;
    void rpc("driver_other_trips", { p_trip_id: tripId }).then(({ data, error }) => {
      if (error) setErr(friendlyError(error.message, t));
      setTrips((data ?? []) as OtherTrip[]);
    });
  }, [open, trips, tripId, t]);

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-end rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground active:bg-accent">
        🚚 {t("dx.otherVehicle")}
      </button>
    );

  const confirm = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await rpc("driver_handover_stop", { p_stop_id: stopId, p_to_trip_id: pick, p_note: note.trim() || null });
    setBusy(false);
    if (error) return setErr(friendlyError(error.message, t));
    const tr = trips?.find((x) => x.trip_id === pick);
    onDone(t("dx.moved", { v: tr?.vehicle_no || tr?.trip_no || "" }));
  };

  return (
    <div className="grid gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
      <p className="text-sm font-bold text-foreground">{t("dx.otherVehicle")}</p>
      {trips === null && <p className="text-sm text-muted-foreground">{t("c.loading")}</p>}
      {trips?.length === 0 && <p className="text-sm text-muted-foreground">{t("dx.noOtherTrips")}</p>}
      {trips?.map((tr) => (
        <button
          key={tr.trip_id}
          type="button"
          onClick={() => setPick(tr.trip_id)}
          aria-pressed={pick === tr.trip_id}
          className={`rounded-lg border px-3 py-3 text-left text-sm ${pick === tr.trip_id ? "border-aqua bg-aqua/10" : "border-input bg-background"}`}
        >
          <span className="block font-bold text-foreground">{tr.vehicle_no || tr.trip_no}</span>
          <span className="block break-words text-xs text-muted-foreground">{tr.trip_no}{tr.driver_name ? ` · ${tr.driver_name}` : ""}</span>
        </button>
      ))}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("dx.noteOptional")} className={input} />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-input bg-card py-3 text-sm font-semibold">{t("c.cancel")}</button>
        <button type="button" disabled={!pick || busy} onClick={() => void confirm()} className="rounded-lg bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
          {busy ? t("c.loading") : t("dx.confirm")}
        </button>
      </div>
    </div>
  );
}

export type PickedCustomer = { id: string; name: string };
type Found = { customer_id?: string; id?: string; business_name?: string | null; name?: string | null; customer_name?: string | null; contact_name?: string | null; mobile?: string | null; customer_code?: string | null };

/** Spot sale customer picker: this trip / search / new walk-in. */
export function SpotCustomerPicker({
  tripId,
  tripCustomers,
  value,
  onChange,
}: {
  tripId: string;
  tripCustomers: PickedCustomer[];
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
}) {
  const { t } = useLang();
  const [tab, setTab] = useState<"trip" | "search" | "new">("trip");
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [searching, setSearching] = useState(false);
  const [nName, setNName] = useState("");
  const [nMobile, setNMobile] = useState("");
  const [nShop, setNShop] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "search" || q.trim().length < 3) {
      setFound([]);
      return;
    }
    setSearching(true);
    const h = window.setTimeout(() => {
      void rpc("driver_find_customers", { p_trip_id: tripId, p_q: q.trim() }).then(({ data, error }) => {
        setSearching(false);
        if (error) setErr(friendlyError(error.message, t));
        else setErr(null);
        setFound((data ?? []) as Found[]);
      });
    }, 400);
    return () => window.clearTimeout(h);
  }, [q, tab, tripId, t]);

  const create = async () => {
    setBusy(true);
    setErr(null);
    setInfo(null);
    const c = await getCoords();
    const { data, error } = await rpc("driver_create_walkin_customer", {
      p_trip_id: tripId,
      p_name: nName.trim(),
      p_mobile: `+91${nMobile.replace(/\D/g, "")}`,
      p_business_name: nShop.trim() || null,
      p_latitude: c?.latitude ?? null,
      p_longitude: c?.longitude ?? null,
    });
    setBusy(false);
    if (error) return setErr(friendlyError(error.message, t));
    const r = (Array.isArray(data) ? data[0] : data) as { customer_id: string; existing: boolean };
    if (r?.existing) setInfo(t("dx.existing"));
    onChange({ id: r.customer_id, name: nShop.trim() || nName.trim() });
  };

  const tabBtn = (k: typeof tab, label: string) => (
    <button type="button" onClick={() => setTab(k)} aria-pressed={tab === k} className={`rounded-full px-2 py-2 text-xs font-semibold ${tab === k ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
      {label}
    </button>
  );

  return (
    <div className="grid gap-2">
      {value && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-aqua bg-aqua/10 px-3 py-2">
          <span className="break-words text-sm font-bold text-foreground">✓ {value.name}</span>
          <button type="button" onClick={() => { onChange(null); setInfo(null); }} className="text-xs font-semibold text-muted-foreground underline">{t("dx.change")}</button>
        </div>
      )}
      {info && <p className="rounded-lg bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-300">{info}</p>}
      {!value && (
        <>
          <div className="grid grid-cols-3 gap-1">
            {tabBtn("trip", t("dx.tabTrip"))}
            {tabBtn("search", t("dx.tabSearch"))}
            {tabBtn("new", t("dx.tabNew"))}
          </div>
          {tab === "trip" && (
            <div className="grid gap-1">
              {tripCustomers.length === 0 && <p className="text-sm text-muted-foreground">{t("c.none")}</p>}
              {tripCustomers.map((c) => (
                <button key={c.id} type="button" onClick={() => onChange(c)} className="rounded-lg border border-input bg-background px-3 py-3 text-left text-sm font-semibold text-foreground">{c.name}</button>
              ))}
            </div>
          )}
          {tab === "search" && (
            <div className="grid gap-1">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("dx.searchHint")} className={input} />
              {searching && q.trim().length >= 3 && <p className="text-xs text-muted-foreground">{t("c.loading")}</p>}
              {!searching && q.trim().length >= 3 && found.length === 0 && <p className="text-sm text-muted-foreground">{t("c.none")}</p>}
              {found.map((f) => {
                const id = f.customer_id ?? f.id ?? "";
                const name = f.business_name || f.contact_name || f.name || f.customer_name || "";
                return (
                  <button key={id} type="button" onClick={() => onChange({ id, name })} className="rounded-lg border border-input bg-background px-3 py-3 text-left text-sm">
                    <span className="block font-semibold text-foreground">{name}</span>
                    <span className="block text-xs text-muted-foreground">{[f.contact_name && f.contact_name !== name ? f.contact_name : null, f.mobile, f.customer_code].filter(Boolean).join(" · ")}</span>
                  </button>
                );
              })}
            </div>
          )}
          {tab === "new" && (
            <div className="grid gap-2">
              <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder={t("dx.name")} className={input} />
              <input inputMode="numeric" value={nMobile} onChange={(e) => setNMobile(e.target.value.replace(/\D/g, "").slice(0, 10))} placeholder={t("dx.mobile")} className={input} />
              <input value={nShop} onChange={(e) => setNShop(e.target.value)} placeholder={t("dx.shopOptional")} className={input} />
              <p className="text-xs text-muted-foreground">📍 {t("dx.gpsNote")}</p>
              <button type="button" disabled={busy || nName.trim().length < 2 || nMobile.length !== 10} onClick={() => void create()} className="rounded-lg bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
                {busy ? t("c.loading") : t("dx.createContinue")}
              </button>
            </div>
          )}
        </>
      )}
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}

type AlertRow = { id: string; type: string; note: string | null; created_at: string };
const SHOWN = ["stop_moved", "walkin_customer", "stop_added", "stop_removed", "sos"];

/** Recent alerts on this trip (stop moved, walk-in customer, etc.). */
export function TripAlertsList({ tripId, refreshKey }: { tripId: string; refreshKey: number }) {
  const { t } = useLang();
  const [rows, setRows] = useState<AlertRow[]>([]);
  useEffect(() => {
    void supabase
      .from("trip_alerts")
      .select("id, alert_type, note, raised_at")
      .eq("trip_id", tripId)
      .order("raised_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setRows(((data ?? []) as unknown as { id: string; alert_type: string; note: string | null; raised_at: string }[]).map((r) => ({ id: r.id, type: r.alert_type, note: r.note, created_at: r.raised_at })).filter((r) => SHOWN.includes(r.type))));
  }, [tripId, refreshKey]);
  if (rows.length === 0) return null;
  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-3 shadow-card">
      <p className="mb-2 text-sm font-bold text-foreground">🔔 {t("dx.alerts")}</p>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="block font-semibold text-foreground">{t(`dx.al.${r.type}`)}</span>
            {r.note && <span className="block break-words text-foreground">{r.note}</span>}
            <span className="block text-xs text-muted-foreground">{istDisplay(r.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
