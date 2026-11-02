// Offline-first queue for staff actions. Every action gets a one-time op id and
// runs through the `run_op` RPC, which records the id — so a replay or retry of
// the same action is done only once. Photos taken offline are kept locally under
// their final storage path and uploaded first when the network returns.
import { supabase } from "@/integrations/supabase/client";

type QueuedCall = { id: string; rpc: string; args: Record<string, unknown>; createdAt: number };
type QueuedPhoto = { path: string; dataUrl: string; type: string };

const KEY = "sunrich_rpc_queue";
const PKEY = "sunrich_photo_queue";
const listeners = new Set<() => void>();

function readJson<T>(key: string): T[] {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}
const read = () => readJson<QueuedCall>(KEY);
const readPhotos = () => readJson<QueuedPhoto>(PKEY);

function writeJson(key: string, v: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // ignore storage failures
  }
  listeners.forEach((fn) => fn());
}

export function pendingCount(): number {
  return typeof window === "undefined" ? 0 : read().length + readPhotos().length;
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err ?? "");
  return (
    msg.includes("Failed to fetch") ||
    msg.includes("NetworkError") ||
    msg.includes("fetch failed") ||
    msg.includes("Load failed") ||
    msg.includes("network") ||
    msg.includes("timeout")
  );
}

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export type QueueResult = { data?: unknown; error?: string; queued?: boolean };

async function runOp(id: string, name: string, args: Record<string, unknown>) {
  return supabase.rpc("run_op" as never, { p_op_id: id, p_rpc: name, p_args: args } as never);
}

/** Call a staff action with automatic offline queueing and once-only replay. */
export async function queueRpc(name: string, args: Record<string, unknown>): Promise<QueueResult> {
  const id = crypto.randomUUID();
  if (isOffline()) {
    enqueue(id, name, args);
    return { queued: true };
  }
  try {
    const { data, error } = await runOp(id, name, args);
    if (error) {
      if (isNetworkError(error)) {
        enqueue(id, name, args);
        return { queued: true };
      }
      return { error: error.message };
    }
    return { data };
  } catch (err) {
    if (isNetworkError(err)) {
      enqueue(id, name, args);
      return { queued: true };
    }
    throw err;
  }
}

function enqueue(id: string, name: string, args: Record<string, unknown>) {
  const q = read();
  const sig = JSON.stringify([name, args]);
  // The same action tapped twice while offline is kept once.
  if (q.some((x) => JSON.stringify([x.rpc, x.args]) === sig)) return;
  q.push({ id, rpc: name, args, createdAt: Date.now() });
  writeJson(KEY, q);
}

/** Keep a photo locally under its final path; uploaded by replayQueue. */
export function queuePhoto(path: string, dataUrl: string, type: string) {
  const q = readPhotos().filter((p) => p.path !== path);
  q.push({ path, dataUrl, type });
  writeJson(PKEY, q);
}

export function queuedPhotoData(path: string): string | null {
  if (typeof window === "undefined") return null;
  return readPhotos().find((p) => p.path === path)?.dataUrl ?? null;
}

let replaying = false;

/** Upload queued photos, then replay every queued action in order. */
export async function replayQueue(): Promise<{ ok: number; failed: number }> {
  if (replaying) return { ok: 0, failed: 0 };
  replaying = true;
  try {
    for (const ph of readPhotos()) {
      try {
        const blob = await (await fetch(ph.dataUrl)).blob();
        const { error } = await supabase.storage.from("operations").upload(ph.path, blob, { contentType: ph.type, upsert: true });
        if (error && isNetworkError(error)) return { ok: 0, failed: 0 };
        writeJson(PKEY, readPhotos().filter((p) => p.path !== ph.path));
      } catch (err) {
        if (isNetworkError(err)) return { ok: 0, failed: 0 };
      }
    }
    let ok = 0;
    let failed = 0;
    for (const item of read()) {
      try {
        const { error } = await runOp(item.id, item.rpc, item.args);
        if (error && isNetworkError(error)) break; // still offline — keep the rest
        if (error) {
          failed += 1;
          console.warn("[offline] replay failed permanently", item.rpc, error.message);
        } else ok += 1;
      } catch (err) {
        if (isNetworkError(err)) break;
        failed += 1;
      }
      writeJson(KEY, read().filter((x) => x.id !== item.id));
    }
    return { ok, failed };
  } finally {
    replaying = false;
  }
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
