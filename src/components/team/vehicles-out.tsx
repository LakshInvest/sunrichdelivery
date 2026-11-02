import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { queueRpc } from "@/lib/offline";
import { friendlyError } from "@/lib/friendly-error";
import { Truck } from "lucide-react";

type Row = { trip_id: string; trip_no: string; reg_no: string | null; driver: string | null; gate_out_at: string };

const time = (s: string) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(s));

/** Security backup when the driver's phone is off: mark a vehicle in without a scan (saved as manual). */
export function VehiclesOutList({ refreshKey, onArrived }: { refreshKey: number; onArrived: () => void }) {
  const { t } = useLang();
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await supabase.rpc("gate_vehicles_out" as never);
    setRows((r.data ?? []) as unknown as Row[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const arrive = async (id: string) => {
    setBusy(true);
    setErr(null);
    const res = await queueRpc("gate_in", { p_trip_id: id, p_manual: true });
    setBusy(false);
    if (res.error && !res.queued) return setErr(friendlyError(res.error, t));
    setOpen(null);
    await load();
    onArrived();
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card" data-testid="vehicles-out">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground">
        <Truck className="h-4 w-4" aria-hidden /> {t("sec.vehiclesOut")}
      </p>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("c.none")}</p>}
      <div className="grid gap-2">
        {rows.map((r) => (
          <div key={r.trip_id} className="rounded-lg bg-secondary p-3">
            <button type="button" onClick={() => setOpen(open === r.trip_id ? null : r.trip_id)} className="w-full text-left">
              <p className="font-display text-base font-bold text-foreground">{r.reg_no ?? r.trip_no}</p>
              <p className="break-words text-xs text-muted-foreground">{[r.driver, r.trip_no, time(r.gate_out_at)].filter(Boolean).join(" · ")}</p>
            </button>
            {open === r.trip_id && (
              <div className="mt-2 grid gap-2">
                <p className="text-xs text-muted-foreground">{t("sec.markArrivedHint")}</p>
                {err && <p className="text-sm text-destructive">{err}</p>}
                <button type="button" onClick={() => void arrive(r.trip_id)} disabled={busy} className="rounded-lg bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
                  {t("sec.markArrived")}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
