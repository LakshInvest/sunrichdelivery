import { describe, expect, it } from "vitest";
import { driverHomeAction, optionalDriverTasks, needsPayment, REFRESH_FALLBACK_MS, STOP_DONE_MS } from "@/lib/task-policy";
import { DEFAULT_SETTINGS } from "@/components/team/driver-parts";
const trip = { status: "in_progress", gate_out_at: "2026-11-17", driver_started_at: null, ended_at: null };
describe("one-task workflow rules", () => {
  it("switches from pass to start after the guard gates out", () => {
    expect(driverHomeAction({ ...trip, gate_out_at: null }, 2)).toBe("pass");
    expect(driverHomeAction(trip, 2)).toBe("start");
  });
  it("keeps loading disabled and shows next/end according to pending stops", () => {
    expect(driverHomeAction({ ...trip, status: "loading" }, 2)).toBe("loading");
    expect(driverHomeAction({ ...trip, driver_started_at: "now" }, 2)).toBe("next");
    expect(driverHomeAction({ ...trip, driver_started_at: "now" }, 0)).toBe("end");
  });
  it("hides every disabled optional task", () => {
    expect(optionalDriverTasks({ expenses_enabled: false, allow_pickup_only: false, allow_spot_sale: false, sos_enabled: false })).toEqual(["stops"]);
  });
  it("credit skips payment even with an unpaid balance", () => { expect(needsPayment("credit", 200)).toBe(false); expect(needsPayment("cod", 200)).toBe(true); });
  it("uses a 15 second recovery refresh", () => expect(REFRESH_FALLBACK_MS).toBe(15000));
  it("advances done after one second", () => expect(STOP_DONE_MS).toBe(1000));
  it("signature defaults off", () => expect(DEFAULT_SETTINGS.proof_signature_enabled).toBe(false));
});