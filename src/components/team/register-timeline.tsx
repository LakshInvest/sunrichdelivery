import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ClipboardList, Truck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { istDisplay, istToday, istDayStart, istDayEnd } from "@/lib/ist";
import { EmptyState } from "@/components/team/role-home";
import { PhotoImg, Spinner } from "@/components/team/ui";

type Row = { at: string; kind: string; title: string; detail: string | null; by_name: string | null; entry_id: string | null; entry_type: string | null; vehicle_no: string | null; photo_path: string | null };
export type RegFilter = "all" | "person" | "vehicle" | "parcel" | "trip";
export const FILTERS: RegFilter[] = ["all", "person", "vehicle", "parcel", "trip"];

/** Which filter chip a register row belongs to. */
export function rowGroup(r: Pick<Row, "entry_type" | "vehicle_no">): Exclude<RegFilter, "all"> {
  if (r.entry_type === "trip") return "trip";
  if (r.entry_type === "parcel") return "parcel";
  if (r.entry_type === "vehicle" || r.entry_type === "supplier" || r.vehicle_no) return "vehicle";
  return "person";
}

export function RegisterTimeline({ insideIds }: { insideIds: string[] }) {
  const { t } = useLang();
  const [day, setDay] = useState(istToday());
  const [f, setF] = useState<RegFilter>("all");
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    setRows(null);
    const r = await supabase.rpc("gate_register_timeline" as never, { p_from: istDayStart(day), p_to: istDayEnd(day) } as never);
    setRows(((r.data ?? []) as unknown) as Row[]);
  }, [day]);
  useEffect(() => { void load(); }, [load]);
  const shown = (rows ?? []).filter((r) => f === "all" || rowGroup(r) === f);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 [&>*]:min-w-0">
      <input type="date" aria-label={t("sec.date")} value={day} max={istToday()} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-12 w-full min-w-0 rounded-2xl border border-border bg-card px-4 text-base" />
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((k) => (
          <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)} className={`h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold ${f === k ? "bg-primary text-primary-foreground" : "bg-card text-foreground border border-border"}`}>{t(`sec.rf.${k}`)}</button>
        ))}
      </div>
      {rows === null && <Spinner label={t("c.loading")} />}
      {rows && !shown.length && <EmptyState icon={ClipboardList} text={t("sec.regEmpty")} />}
      {shown.map((r, i) => {
        const g = rowGroup(r); const out = r.kind.endsWith("_out");
        const body = (
          <div className="home-card flex items-center gap-3 p-3" data-testid="reg-row">
            <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-sm font-bold">{istDisplay(r.at, { hour: "numeric", minute: "2-digit" })}</span>
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted">{r.photo_path ? <PhotoImg path={r.photo_path} className="h-full w-full object-cover" /> : g === "trip" || g === "vehicle" ? <Truck className="m-3 h-6 w-6 text-muted-foreground" /> : <Users className="m-3 h-6 w-6 text-muted-foreground" />}</div>
            <div className="min-w-0 flex-1"><p className="truncate font-bold">{r.vehicle_no && g !== "person" ? r.vehicle_no : r.title}</p><p className="truncate text-sm text-muted-foreground">{[g === "trip" ? r.title : null, r.by_name].filter(Boolean).join(" · ")}</p></div>
            <span className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${out ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>{t(out ? "sec.kind.entry_out" : "sec.kind.entry_in")}</span>
          </div>);
        return r.entry_id && insideIds.includes(r.entry_id) ? <Link key={i} to="/security/$step" params={{ step: "out" }} search={{ entryId: r.entry_id }}>{body}</Link> : <div key={i}>{body}</div>;
      })}
    </div>
  );
}
