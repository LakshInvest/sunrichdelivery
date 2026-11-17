import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ handlers: [] as ((p: { new: Record<string, unknown> }) => void)[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  channel: () => { const channel = { on: (_: string, __: unknown, cb: (p: { new: Record<string, unknown> }) => void) => { mock.handlers.push(cb); return channel; }, subscribe: () => channel }; return channel; },
  removeChannel: vi.fn(),
} }));
import { useLiveRefresh } from "@/lib/use-live-refresh";
afterEach(() => { cleanup(); mock.handlers = []; vi.useRealTimers(); });
describe("live task refresh", () => {
  it("patches the filtered trip immediately on realtime, without waiting for polling", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => {}); const patch = vi.fn();
    renderHook(() => useLiveRefresh(load, [{ table: "trips", filter: "id=eq.qa-trip" }], "qa-trip", patch));
    await act(async () => {});
    await act(async () => { mock.handlers[0]?.({ new: { id: "qa-trip", gate_out_at: "2026-11-17" } }); });
    expect(patch).toHaveBeenCalledWith("trips", { id: "qa-trip", gate_out_at: "2026-11-17" });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("keeps recovery at fifteen seconds, not heavier polling", async () => {
    vi.useFakeTimers(); const load = vi.fn(async () => {});
    renderHook(() => useLiveRefresh(load, [{ table: "trips" }], "qa-trip"));
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(14999); }); expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); }); expect(load).toHaveBeenCalledTimes(2);
  });
  it("keeps role-home recovery at its existing thirty seconds while applying realtime immediately", async () => {
    vi.useFakeTimers(); const load = vi.fn(async () => {});
    renderHook(() => useLiveRefresh(load, [{ table: "trips" }], "role-counts", undefined, 30000));
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { mock.handlers[0]?.({ new: { id: "qa-trip", status: "loaded" } }); });
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(15000); });
    expect(load).toHaveBeenCalledTimes(3);
  });
});