import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { istDisplay } from "@/lib/ist";
import { haptic } from "@/lib/native";
import { useTeamAuth } from "@/lib/team-auth";
import { isOffline, queueRpc } from "@/lib/offline";
import { DockButton, ErrorCard, PhotoInput, Spinner, Stepper } from "@/components/team/ui";

type EntryType = "visitor" | "parcel" | "supplier" | "other";
type Found = {
  mobile: string;
  found: boolean;
  name?: string | null;
  is_staff?: boolean;
  inside?: boolean;
  from_place?: string | null;
  entry_type?: string | null;
  meet_user_id?: string | null;
  vehicle_no?: string | null;
  courier_name?: string | null;
};
type Entry = {
  id: string;
  mobile: string;
  name: string;
  person_type: string;
  entry_type: string;
  purpose: string | null;
  from_place: string | null;
  vehicle_no: string | null;
  people_count: number;
  in_at: string;
  parcel_count: number | null;
  courier_name: string | null;
  handed_at: string | null;
  handed_to: string | null;
};

export const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30";

const TYPES: EntryType[] = ["visitor", "parcel", "supplier"];

function errKey(msg: string): string {
  for (const k of ["already_inside", "name_required", "photo_required", "not_allowed", "bad_mobile"]) if (msg.includes(k)) return `sec.err.${k}`;
  return "";
}

/** Entry: +91 search, then the same form every time (staff = one tap). */
export function GateEntryPanel({ onDone }: { onDone: (queued?: boolean) => void }) {
  const { t } = useLang();
  const { staff } = useTeamAuth();
  const [mobile, setMobile] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [type, setType] = useState<EntryType>("visitor");
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [meet, setMeet] = useState("");
  const [purpose, setPurpose] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [people, setPeople] = useState(1);
  const [courier, setCourier] = useState("");
  const [parcels, setParcels] = useState(1);
  const [photo, setPhoto] = useState<string | null>(null);
  const [challan, setChallan] = useState<string | null>(null);
  const [photoRule, setPhotoRule] = useState<"off" | "optional" | "required">("off");
  const [staffList, setStaffList] = useState<{ id: string; full_name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void supabase.rpc("gate_staff_list").then((r) => setStaffList((r.data ?? []) as { id: string; full_name: string }[]));
    void supabase
      .from("delivery_settings")
      .select("visitor_photo")
      .maybeSingle()
      .then((r) => {
        const v = (r.data as { visitor_photo?: string } | null)?.visitor_photo;
        if (v === "off" || v === "required" || v === "optional") setPhotoRule(v);
      });
  }, []);

  const showErr = (m: string) => setError(errKey(m) ? t(errKey(m)) : m);

  const find = async () => {
    setError(null);
    if (mobile.length !== 10) return setError(t("sec.mobile"));
    if (isOffline()) {
      setFound({ mobile, found: false });
      return;
    }
    setBusy(true);
    const r = await supabase.rpc("gate_find_person", { p_mobile: mobile });
    setBusy(false);
    if (r.error) return showErr(r.error.message);
    const f = r.data as unknown as Found;
    setFound(f);
    setName(f.name ?? "");
    setFrom(f.from_place ?? "");
    setMeet(f.meet_user_id ?? "");
    setVehicle(f.vehicle_no ?? "");
    setCourier(f.courier_name ?? "");
    if (f.entry_type && (TYPES as string[]).includes(f.entry_type)) setType(f.entry_type as EntryType);
    if (f.inside) setError(t("sec.alreadyInside"));
  };

  const markIn = async () => {
    setError(null);
    if (!found?.is_staff) {
      if (!name.trim()) return setError(t("sec.err.name_required"));
      if (photoRule === "required" && !photo) return setError(t("sec.err.photo_required"));
      if (type === "supplier" && !vehicle.trim()) return setError(t("sec.err.vehicle_required"));
    }
    setBusy(true);
    const r = await queueRpc("gate_entry_in", {
      p: {
        mobile,
        entry_type: type,
        name,
        from_place: from,
        meet_user_id: meet,
        purpose,
        vehicle_no: vehicle,
        people_count: people,
        photo_path: photo ?? "",
        courier_name: type === "parcel" ? courier : "",
        parcel_count: type === "parcel" ? parcels : "",
        challan_photo_path: type === "supplier" ? (challan ?? "") : "",
      },
    });
    setBusy(false);
    if (r.error) return showErr(r.error);
    void haptic("success");
    onDone(r.queued);
  };

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-2 text-sm font-bold ${on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-foreground"}`;

  return (
    <div className="grid gap-3">
      <div className="rounded-xl border border-border bg-card p-4 shadow-card">
        <label className="mb-1 block text-sm font-medium text-foreground">{t("sec.mobile")}</label>
        <div className="flex gap-2">
          <span className="grid place-items-center rounded-md border border-input bg-muted px-3 text-base font-semibold text-foreground">+91</span>
          <input
            inputMode="numeric"
            maxLength={10}
            aria-label={t("sec.mobile")}
            value={mobile}
            onChange={(e) => {
              setMobile(e.target.value.replace(/\D/g, "").slice(0, 10));
              setFound(null);
            }}
            className={`${inputCls} min-w-0 flex-1 font-semibold tracking-wide`}
          />
          <button
            type="button"
            onClick={() => void find()}
            disabled={busy || mobile.length !== 10}
            className="rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground disabled:bg-muted disabled:text-muted-foreground"
          >
            {t("sec.find")}
          </button>
        </div>
      </div>

      {found && !found.inside && found.is_staff && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-card">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">{t("sec.staffTag")}</span>
            <span className="font-display text-lg font-bold text-foreground">{found.name}</span>
          </div>
          <DockButton onClick={() => void markIn()} disabled={busy}>
            {busy ? t("c.loading") : t("sec.markIn")}
          </DockButton>
        </div>
      )}

      {found && !found.inside && !found.is_staff && (
        <div className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
          <span className="w-fit rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
            {found.found ? t("sec.knownVisitor") : t("sec.newPerson")}
          </span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("sec.type")}>
            {TYPES.map((x) => (
              <button key={x} type="button" role="radio" aria-checked={type === x} onClick={() => setType(x)} className={chip(type === x)}>
                {t(`sec.type.${x}`)}
              </button>
            ))}
          </div>
          <Field label={t("sec.name")}>
            <input aria-label={t("sec.name")} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          {type === "supplier" && (
            <>
              <Field label={t("sec.supplier")}>
                <input aria-label={t("sec.supplier")} value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
              </Field>
              <Field label={t("sec.vehicleNo").replace(/\s*\(.*\)\s*/, "")}>
                <input aria-label={t("sec.vehicleNo")} value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={`${inputCls} uppercase`} />
              </Field>
            </>
          )}
          {type === "parcel" && (
            <div className="grid gap-3">
              <Field label={t("sec.courier")}>
                <input aria-label={t("sec.courier")} value={courier} onChange={(e) => setCourier(e.target.value)} className={inputCls} />
              </Field>
              <Field label={t("sec.parcelCount")}>
                <Stepper value={parcels} onChange={setParcels} min={1} max={99} label={t("sec.parcelCount")} />
              </Field>
            </div>
          )}
          <Field label={type === "parcel" ? t("sec.parcelFor") : t("sec.meet")}>
            <select aria-label={t("sec.meet")} value={meet} onChange={(e) => setMeet(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
          </Field>
          {type === "supplier" && staff && (
            <PhotoInput userId={staff.id} kind="gate-challan" label={t("sec.challanPhoto")} value={challan} onChange={setChallan} />
          )}
          {photoRule !== "off" && staff && (
            <PhotoInput userId={staff.id} kind="gate-visitor" required={photoRule === "required"} label={t("sec.photo")} value={photo} onChange={setPhoto} />
          )}
          <DockButton onClick={() => void markIn()} disabled={busy}>
            {busy ? t("c.loading") : t("sec.markIn")}
          </DockButton>
        </div>
      )}

      {error && <ErrorCard message={error} />}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

/** Exit: everyone inside now, one tap Out. */
export function GateExitPanel({ onChange }: { onChange: () => void }) {
  const { t } = useLang();
  const [inside, setInside] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const r = await supabase
      .from("gate_entries")
      .select("id, mobile, name, person_type, entry_type, purpose, from_place, vehicle_no, people_count, in_at, parcel_count, courier_name, handed_at, handed_to")
      .is("out_at", null)
      .order("in_at", { ascending: false });
    if (r.error) setError(r.error.message);
    setInside((r.data ?? []) as Entry[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markOut = async (id: string) => {
    setError(null);
    const r = await queueRpc("gate_entry_out", { p_entry_id: id });
    if (r.error) return setError(r.error);
    void haptic("success");
    setMsg(r.queued ? t("sec.savedOffline") : t("sec.exitDone"));
    if (r.queued) setInside((l) => (l ?? []).filter((x) => x.id !== id));
    onChange();
    if (!r.queued) await load();
  };

  const handOver = async (id: string, who: string) => {
    setError(null);
    if (!who.trim()) return setError(t("sec.receivedBy"));
    const r = await queueRpc("gate_parcel_handover", { p_entry_id: id, p_received_by: who });
    if (r.error) return setError(r.error);
    void haptic("success");
    setMsg(r.queued ? t("sec.savedOffline") : t("sec.handedDone"));
    if (r.queued) setInside((l) => (l ?? []).map((x) => (x.id === id ? { ...x, handed_at: new Date().toISOString(), handed_to: who } : x)));
    else await load();
  };

  return (
    <div className="grid gap-2">
      {msg && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">{msg}</p>}
      {error && <ErrorCard message={error} />}
      {inside === null && <Spinner label={t("c.loading")} />}
      {inside && inside.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t("c.none")}</p>}
      {inside && inside.length > 0 && (
        <input aria-label={t("sec.search")} placeholder={t("sec.search")} value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} />
      )}
      {inside
        ?.filter((e) => !q.trim() || `${e.name} ${e.mobile} ${e.vehicle_no ?? ""} ${e.from_place ?? ""} ${e.courier_name ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
        .map((e) => (
        <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-card" data-testid="inside-row">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-display font-bold text-foreground">{e.name}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${e.person_type === "staff" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {e.person_type === "staff" ? t("sec.staffTag") : t(`sec.type.${e.entry_type}`)}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {[e.mobile, e.from_place, e.vehicle_no, e.people_count > 1 ? `${e.people_count} ${t("sec.peopleShort")}` : null].filter(Boolean).join(" · ")}
            </p>
            <p className="text-xs text-muted-foreground">{istDisplay(e.in_at)}</p>
            {e.entry_type === "parcel" && (
              e.handed_at ? (
                <p className="text-xs font-semibold text-emerald-700" data-testid="handed">
                  {t("sec.handedTo", { name: e.handed_to ?? "", time: istDisplay(e.handed_at) })}
                </p>
              ) : (
                <HandOver onSave={(who) => void handOver(e.id, who)} />
              )
            )}
          </div>
          <button
            type="button"
            onClick={() => void markOut(e.id)}
            className="shrink-0 rounded-md border border-input bg-background px-4 py-2.5 text-sm font-bold text-foreground active:bg-accent"
          >
            {t("sec.markOut")}
          </button>
        </div>
      ))}
    </div>
  );
}

function HandOver({ onSave }: { onSave: (who: string) => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [who, setWho] = useState("");
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-xs font-bold text-primary underline">
        {t("sec.handOver")}
      </button>
    );
  return (
    <div className="mt-2 flex gap-2">
      <input aria-label={t("sec.receivedBy")} placeholder={t("sec.receivedBy")} value={who} onChange={(e) => setWho(e.target.value)} className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-2 text-sm" />
      <button type="button" onClick={() => onSave(who)} className="rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground">
        {t("c.save")}
      </button>
    </div>
  );
}
