// These snapshots are display/draft data only. Every replay still authorizes on the server.
export function readTripCache<T>(userId: string, tripId: string): T | null {
  try { return JSON.parse(localStorage.getItem(`sunrich:trip:${userId}:${tripId}`) ?? 'null') as T | null; } catch { return null; }
}
export function saveTripCache(userId: string, tripId: string, data: unknown) {
  localStorage.setItem(`sunrich:trip:${userId}:${tripId}`,JSON.stringify(data));
}
export function saveDisplayStaff(userId: string, data: unknown) { localStorage.setItem(`sunrich:staff:${userId}`,JSON.stringify(data)); }
export function readDisplayStaff<T>(userId: string): T | null { try { return JSON.parse(localStorage.getItem(`sunrich:staff:${userId}`) ?? 'null') as T|null; } catch { return null; } }