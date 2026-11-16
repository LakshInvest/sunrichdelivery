import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { istToday } from "@/lib/ist";
import { useLang } from "@/lib/l10n";
import type { Staff } from "@/lib/team-auth";

export function useRoleCounts(staff: Staff | null) {
  const [counts, setCounts] = useState<Record<string, { n: number; stops?: number }>>({});
  useEffect(() => {
    if (!staff) return;
    let alive = true;
    const load = async () => {
      const values: Record<string, { n: number; stops?: number }> = {};
      await Promise.all(staff.roles.map(async (code) => {
        if (code === "SECURITY") {
          const r = await supabase.from("trips").select("id", { count: "exact", head: true }).not("gate_out_at", "is", null).is("gate_in_at", null).neq("status", "cancelled");
          if (!r.error) values[code] = { n: r.count ?? 0 };
        } else if (code === "LOADER") {
          const r = await supabase.from("trips").select("id", { count: "exact", head: true }).in("status", ["planned", "loading"]);
          if (!r.error) values[code] = { n: r.count ?? 0 };
        } else if (code === "DRIVER") {
          const r = await supabase.from("trips").select("id, trip_stops(count)").eq("driver_user_id", staff.id).eq("trip_date", istToday()).neq("status", "cancelled");
          if (!r.error) values[code] = { n: r.data?.length ?? 0, stops: (r.data ?? []).reduce((sum, row) => sum + (row.trip_stops?.[0]?.count ?? 0), 0) };
        }
      }));
      if (alive) setCounts(values);
    };
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    window.addEventListener("focus", load);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("focus", load); };
  }, [staff]);
  return counts;
}

export function RoleCount({ code, count }: { code: string; count?: { n: number; stops?: number } }) {
  const { t } = useLang();
  return <span className="block text-xs font-semibold leading-relaxed text-primary" aria-live="polite">{count ? t(`home.count${code}`, { n: count.n, stops: count.stops ?? 0 }) : "—"}</span>;
}