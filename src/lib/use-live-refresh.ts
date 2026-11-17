import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { REFRESH_FALLBACK_MS } from "@/lib/task-policy";

export type LiveTable = { table: string; filter?: string };
type RefreshSource = "initial" | "realtime" | "subscribed" | "fallback" | "focus" | "online" | "visible";
/** Credential-free timing evidence for support and browser QA. */
function trace(scope: string, source: RefreshSource, table?: string, status?: string) {
  window.dispatchEvent(new CustomEvent("sunrich:live-refresh", { detail: { scope, source, table, status, at: performance.now() } }));
}
/** One scoped channel per mounted screen; foreground/network and polling also recover missed events. */
export function useLiveRefresh(load: () => void | Promise<void>, tables: LiveTable[], scope: string, onChange?: (table: string, row: Record<string, unknown>) => void) {
  const callback = useRef(load);
  callback.current = load;
  const change = useRef(onChange);
  change.current = onChange;
  const key = JSON.stringify(tables);
  useEffect(() => {
    let active = true;
    let running = false;
    let again = false;
    const refresh = async () => {
      if (!active) return;
      if (running) { again = true; return; }
      running = true;
      try { await callback.current(); } finally {
        running = false;
        if (again && active) { again = false; void refresh(); }
      }
    };
    const channel = supabase.channel(`tasks:${scope}:${Math.random().toString(36).slice(2)}`);
    for (const row of JSON.parse(key) as LiveTable[]) {
      channel.on("postgres_changes", { event: "*", schema: "public", ...row }, (payload) => {
        trace(scope, "realtime", row.table);
        change.current?.(row.table, payload.new as Record<string, unknown>);
        void refresh();
      });
    }
    channel.subscribe((status) => { trace(scope, "subscribed", undefined, status); if (status === "SUBSCRIBED") void refresh(); });
    const recover = (source: RefreshSource) => { trace(scope, source); void refresh(); };
    const foreground = () => { if (document.visibilityState === "visible") recover("visible"); };
    const focus = () => recover("focus");
    const online = () => recover("online");
    trace(scope, "initial");
    void refresh();
    const timer = window.setInterval(() => recover("fallback"), REFRESH_FALLBACK_MS);
    window.addEventListener("focus", focus);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", foreground);
      void supabase.removeChannel(channel);
    };
  }, [key, scope]);
}