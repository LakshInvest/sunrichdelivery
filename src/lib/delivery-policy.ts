export const DELIVERY_DEFAULTS = { arrival_distance_limit_m: 300, office_emergency_number: null as string | null, crates_at_customer_enabled: false, expired_returns_enabled: false };
export function distanceMetres(lat: number, lng: number, targetLat: number | null, targetLng: number | null): number | null {
  if (targetLat == null || targetLng == null) return null;
  const rad = (v: number) => v * Math.PI / 180;
  const a = Math.sin(rad(targetLat-lat)/2)**2 + Math.cos(rad(lat))*Math.cos(rad(targetLat))*Math.sin(rad(targetLng-lng)/2)**2;
  return Math.round(6371000*2*Math.asin(Math.min(1,Math.sqrt(a))));
}
export function expectedCrates(loaded: number, left: number, pickedUp: number) { return Math.max(0, loaded-left+pickedUp); }
export function splitCollection(amount: number, currentBill: number) { return { current: Math.min(amount,currentBill), old: Math.max(0,amount-currentBill) }; }
export function tripKm(start: number | null, end: number | null) { return start == null || end == null ? 0 : Math.max(0,end-start); }
export const arrivalReasons = ["wrong_address","different_place","gps","other"] as const;
export const goodsReasons = ["short","damaged","refused","other"] as const;