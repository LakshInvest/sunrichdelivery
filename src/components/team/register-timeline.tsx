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

/** "TRP/261117/0002" → "Trip 2". */
export function shortTrip(no: string) { const n = Number((no.split("/").pop() ?? "").replace(/\D/g, "")); return n ? `Trip ${n}` : (no.split("/").pop() ?? no); }

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
      <div className="relative"><div className="flex gap-2 overflow-x-auto pb-1 pr-10 [scrollbar-width:none]">
        {FILTERS.map((k) => (
          <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)} className={`h-10 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold ${f === k ? "bg-primary text-primary-foreground" : "bg-card text-foreground border border-border"}`}>{t(`sec.rf.${k}`)}</button>
        ))}
      </div><span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" /></div>
      {rows === null && <Spinner label={t("c.loading")} />}
      {rows && !shown.length && <EmptyState icon={ClipboardList} text={t("sec.regEmpty")} />}
      {shown.map((r, i) => {
        const g = rowGroup(r); const out = r.kind.endsWith("_out");
        const manual = g !== "trip" || /manual/.test(r.detail ?? "");
        const name = r.vehicle_no && g !== "person" ? (g === "trip" ? `${shortTrip(r.title)} · ${r.vehicle_no}` : r.vehicle_no) : r.title;
        const initials = (r.title || "").split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
        const Icon = g === "trip" || g === "vehicle" ? Truck : Users;
        const body = (
          <div className="home-card flex items-center gap-3 p-3" data-testid="reg-row">
            <span className="grid w-16 shrink-0 justify-items-start gap-1"><span className="whitespace-nowrap text-sm font-bold">{istDisplay(r.at, { hour: "numeric", minute: "2-digit" })}</span><span className={`chip ${out ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>{t(out ? "sec.kind.entry_out" : "sec.kind.entry_in")}</span></span>
            <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-secondary/10 text-primary">{r.photo_path ? <PhotoImg path={r.photo_path} className="h-full w-full object-cover" /> : g === "person" && initials ? <span className="text-base font-bold">{initials}</span> : <Icon className="h-5 w-5" aria-hidden />}</div>
            <div className="min-w-0 flex-1"><p className="text-base font-bold leading-snug [overflow-wrap:anywhere]">{name}</p><p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground"><span className="truncate">{g === "trip" ? (r.detail ?? "").replace(/ · manual$/, "") || r.by_name : r.by_name}</span><span className="chip bg-muted text-muted-foreground">{manual ? t("sec.tagManual") : "QR"}</span></p></div>
          </div>);
        return r.entry_id && insideIds.includes(r.entry_id) ? <Link key={i} to="/security/$step" params={{ step: "out" }} search={{ entryId: r.entry_id }}>{body}</Link> : <div key={i}>{body}</div>;
      })}
    </div>
  );
}
