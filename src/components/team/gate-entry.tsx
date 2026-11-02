import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { istDisplay } from "@/lib/ist";
import { haptic } from "@/lib/native";
import { DockButton, ErrorCard, Spinner } from "@/components/team/ui";

type Found = { mobile: string; found: boolean; name?: string; is_staff?: boolean; inside?: boolean };
type Entry = { id: string; mobile: string; name: string; person_type: string; purpose: string | null; vehicle_no: string | null; in_at: string };

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30";

/** Gate Entry + "Inside now" exit list. Mobile is searched as +91 + last 10 digits. */
export function GateEntryPanel() {
  const { t } = useLang();
  const [mobile, setMobile] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inside, setInside] = useState<Entry[] | null>(null);

  const load = useCallback(async () => {
    const r = await supabase
      .from("gate_entries")
      .select("id, mobile, name, person_type, purpose, vehicle_no, in_at")
      .is("out_at", null)
      .order("in_at", { ascending: false });
    if (r.error) setError(r.error.message);
    setInside((r.data ?? []) as Entry[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const find = async () => {
    setMsg(null);
    setError(null);
    if (mobile.length !== 10) return setError(t("sec.mobile"));
    setBusy(true);
    const r = await supabase.rpc("gate_find_person", { p_mobile: mobile });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    const f = r.data as unknown as Found;
    setFound(f);
    setName(f.name ?? "");
    if (f.inside) setError(t("sec.alreadyInside"));
  };

  const markIn = async () => {
    setMsg(null);
    setError(null);
    if (!name.trim()) return setError(t("sec.name"));
    setBusy(true);
    const r = await supabase.rpc("gate_entry_in", { p_mobile: mobile, p_name: name, p_purpose: purpose, p_vehicle: vehicle });
    setBusy(false);
    if (r.error) return setError(r.error.message.includes("already_inside") ? t("sec.alreadyInside") : r.error.message);
    void haptic("success");
    setMsg(t("sec.entryDone"));
    setMobile("");
    setFound(null);
    setName("");
    setPurpose("");
    setVehicle("");
    await load();
  };

  const markOut = async (id: string) => {
    setError(null);
    const r = await supabase.rpc("gate_entry_out", { p_entry_id: id });
    if (r.error) return setError(r.error.message);
    void haptic("success");
    setMsg(t("sec.exitDone"));
    await load();
  };

  return (
    <div className="grid gap-3">
      <div className="rounded-xl border border-border bg-card p-4 shadow-card">
        <p className="font-display text-base font-bold text-foreground">{t("sec.entryTitle")}</p>
        <label className="mb-1 mt-3 block text-sm font-medium text-foreground">{t("sec.mobile")}</label>
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

        {found && !found.inside && (
          <div className="mt-3 grid gap-3">
            <div className="flex items-center gap-2">
              {found.is_staff ? (
                <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">{t("sec.staffTag")}</span>
              ) : (
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-muted-foreground">
                  {found.found ? t("sec.visitorTag") : t("sec.newPerson")}
                </span>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">{t("sec.name")}</label>
              <input aria-label={t("sec.name")} value={name} onChange={(e) => setName(e.target.value)} readOnly={!!found.is_staff} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">{t("sec.purpose")}</label>
              <input aria-label={t("sec.purpose")} value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">{t("sec.vehicleNo")}</label>
              <input aria-label={t("sec.vehicleNo")} value={vehicle} onChange={(e) => setVehicle(e.target.value)} className={`${inputCls} uppercase`} />
            </div>
            <DockButton onClick={() => void markIn()} disabled={busy}>
              {busy ? t("c.loading") : t("sec.markIn")}
            </DockButton>
          </div>
        )}
      </div>

      {msg && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">{msg}</p>}
      {error && <ErrorCard message={error} />}

      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {t("sec.inside")} {inside ? `(${inside.length})` : ""}
      </p>
      {inside === null && <Spinner label={t("c.loading")} />}
      {inside && inside.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t("c.none")}</p>}
      {inside?.map((e) => (
        <div key={e.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-card" data-testid="inside-row">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-display font-bold text-foreground">{e.name}</span>
              {e.person_type === "staff" && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">{t("sec.staffTag")}</span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {e.mobile}
              {e.vehicle_no ? ` · ${e.vehicle_no}` : ""}
              {e.purpose ? ` · ${e.purpose}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">{istDisplay(e.in_at)}</p>
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
