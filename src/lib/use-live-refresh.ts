import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { REFRESH_FALLBACK_MS } from "@/lib/task-policy";

export type LiveTable = { table: string; filter?: string };
/** One scoped channel per mounted screen; foreground/network and polling also recover missed events. */
export function useLiveRefresh(load: () => void | Promise<void>, tables: LiveTable[], scope: string) {
  const callback = useRef(load);
  callback.current = load;
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
      channel.on("postgres_changes", { event: "*", schema: "public", ...row }, () => void refresh());
    }
    channel.subscribe((status) => { if (status === "SUBSCRIBED") void refresh(); });
    const foreground = () => { if (document.visibilityState === "visible") void refresh(); };
    const recover = () => void refresh();
    void refresh();
    const timer = window.setInterval(recover, REFRESH_FALLBACK_MS);
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      document.removeEventListener("visibilitychange", foreground);
      void supabase.removeChannel(channel);
    };
  }, [key, scope]);
}