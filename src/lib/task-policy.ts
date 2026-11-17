export const REFRESH_FALLBACK_MS = 15_000;
export const STOP_DONE_MS = 1_000;
export function driverHomeAction(trip: { status: string; gate_out_at: string | null; driver_started_at: string | null; ended_at: string | null }, pending: number) {
  if (["planned", "loading"].includes(trip.status)) return "loading";
  if (trip.status === "settled") return "settled";
  if (trip.status === "returned") return "handover";
  if (!trip.gate_out_at || trip.ended_at) return "pass";
  if (!trip.driver_started_at) return "start";
  return pending > 0 ? "next" : "end";
}
export function optionalDriverTasks(s: { expenses_enabled: boolean; allow_pickup_only?: boolean; allow_spot_sale: boolean; sos_enabled: boolean }) {
  return ["stops", ...(s.expenses_enabled ? ["expense"] : []), ...(s.allow_pickup_only ? ["pickup"] : []), ...(s.allow_spot_sale ? ["spot"] : []), ...(s.sos_enabled ? ["sos"] : [])];
}
export function needsPayment(mode: string | null | undefined, due: number) { return mode !== "credit" && due > 0; }