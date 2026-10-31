// Offline-first queue for staff RPC mutations. When the phone is offline (or a
// call fails with a network error) the call is stored locally and replayed when
// connectivity returns. UI reads pendingCount()/subscribe() for the sync badge.
import { supabase } from "@/integrations/supabase/client";

type QueuedCall = { id: string; rpc: string; args: Record<string, unknown>; createdAt: number };

const KEY = "sunrich_rpc_queue";
const listeners = new Set<() => void>();

function read(): QueuedCall[] {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as QueuedCall[];
  } catch {
    return [];
  }
}

function write(q: QueuedCall[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    // ignore storage failures
  }
  listeners.forEach((fn) => fn());
}

export function pendingCount(): number {
  return typeof window === "undefined" ? 0 : read().length;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("fetch failed") ||
    msg.includes("Load failed") ||
    msg.includes("timeout")
  );
}

export type QueueResult = { data?: unknown; error?: string; queued?: boolean };

/** Call a DB RPC by name with automatic offline queueing. */
export async function queueRpc(name: string, args: Record<string, unknown>): Promise<QueueResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    enqueue(name, args);
    return { queued: true };
  }
  try {
    const { data, error } = await supabase.rpc(name as never, args as never);
    if (error) {
      if (isNetworkError(new Error(error.message))) {
        enqueue(name, args);
        return { queued: true };
      }
      return { error: error.message };
    }
    return { data };
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(name, args);
      return { queued: true };
    }
    throw err;
  }
}

function enqueue(name: string, args: Record<string, unknown>) {
  const q = read();
  q.push({ id: crypto.randomUUID(), rpc: name, args, createdAt: Date.now() });
  write(q);
}

/** Replay every queued call, in order. Returns how many succeeded. */
export async function replayQueue(): Promise<{ ok: number; failed: number }> {
  const q = read();
  if (q.length === 0) return { ok: 0, failed: 0 };
  let ok = 0;
  const remaining: QueuedCall[] = [];
  for (const item of q) {
    try {
      const { error } = await supabase.rpc(item.rpc as never, item.args as never);
      if (error) {
        if (isNetworkError(new Error(error.message))) {
          remaining.push(item); // still offline — keep for later
        } else {
          console.warn("[offline] replay failed permanently", item.rpc, error.message);
        }
      } else {
        ok += 1;
      }
    } catch (err) {
      if (isNetworkError(err)) remaining.push(item);
      else console.warn("[offline] replay threw", item.rpc, err);
    }
  }
  write(remaining);
  return { ok, failed: q.length - remaining.length - ok };
}

export function installReplayListeners() {
  if (typeof window === "undefined") return () => {};
  const onOnline = () => {
    void replayQueue();
  };
  window.addEventListener("online", onOnline);
  const timer = window.setInterval(() => {
    if (navigator.onLine && pendingCount() > 0) void replayQueue();
  }, 30_000);
  if (navigator.onLine && pendingCount() > 0) void replayQueue();
  return () => {
    window.removeEventListener("online", onOnline);
    window.clearInterval(timer);
  };
}
