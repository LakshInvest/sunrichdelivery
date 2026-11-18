export const APP_VERSION = '1.0';
export const SYNC_REPORT_INTERVAL = 120_000;
type Entry = { rpc: string; createdAt: number };
type Photo = { createdAt?: number };
export function syncReportPayload(tripId: string, entries: Entry[], photos: Photo[]) {
  const times = [...entries.map(e => e.createdAt), ...photos.flatMap(p => p.createdAt == null ? [] : [p.createdAt])];
  const kinds = entries.map(e => /collection|payment/.test(e.rpc) ? 'payment' : /deliver|arrival/.test(e.rpc) ? 'delivery' : e.rpc);
  if (photos.length) kinds.push('photo');
  return {
    p_trip_id: tripId,
    p_pending: entries.length + photos.length,
    p_oldest: times.length ? new Date(Math.min(...times)).toISOString() : null,
    p_kinds: [...new Set(kinds)],
    p_app_version: APP_VERSION,
  };
}