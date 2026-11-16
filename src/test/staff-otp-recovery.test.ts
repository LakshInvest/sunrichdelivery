import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as Array<{ table: string; op: string; value?: unknown }>, exhausted: true, lock: "2026-11-16T05:19:00Z" }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  const builder = { inputValidator: () => builder, middleware: () => builder, handler: (fn: (arg: unknown) => unknown) => fn };
  return builder;
} }));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: (table: string) => {
    let op = "select";
    const row = () => table === "user_profiles"
      ? { id: "qa", full_name: "QA", email: "qa@example.test", is_active: true }
      : { id: "old", code_hash: "invalid", attempts: state.exhausted ? 5 : 0, max_attempts: 5, locked_until: state.lock, created_at: "2026-11-16T05:00:00Z", expires_at: "2026-11-16T05:10:00Z" };
    const q = {
      select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q, gte: () => q,
      update: (value: unknown) => { op = "update"; state.calls.push({ table, op, value }); return q; },
      insert: (value: unknown) => { op = "insert"; state.calls.push({ table, op, value }); return q; },
      maybeSingle: async () => ({ data: row(), error: null }),
      single: async () => ({ data: op === "insert" ? { id: "new" } : row(), error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, count: 0, error: null }).then(resolve),
    };
    return q;
  },
} }));
import { staffRequestOtp, staffVerifyOtp } from "@/lib/staff-login.functions";

describe("server OTP replacement", () => {
  beforeEach(() => {
    state.calls.length = 0;
    state.exhausted = true;
    state.lock = "2026-11-16T05:19:00Z";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T05:20:00Z"));
    vi.stubEnv("AISENSY_API_KEY", "test-key");
    vi.stubEnv("AISENSY_OTP_CAMPAIGN", "test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
  });
  it("closes the used-up code before storing a new one after lock expiry", async () => {
    const result = await (staffRequestOtp as unknown as (arg: unknown) => Promise<{ ok: boolean }>)({ data: { mobile: "9999900013" } });
    expect(result.ok).toBe(true);
    expect(state.calls.map((c) => c.op)).toEqual(["update", "insert"]);
    expect(state.calls[0]?.value).toEqual({ consumed_at: "2026-11-16T05:20:00.000Z" });
  });
  it("never restarts a lock when verifying an already used-up code", async () => {
    const result = await (staffVerifyOtp as unknown as (arg: unknown) => Promise<{ code: string; retryAfterSeconds: number }>)({ data: { mobile: "9999900013", code: "0000" } });
    expect(result.code).toBe("otp_locked");
    expect(result.retryAfterSeconds).toBe(0);
    expect(state.calls).toEqual([]);
  });
  it("refuses replacement until the active lock ends", async () => {
    state.lock = "2026-11-16T05:35:00Z";
    const result = await (staffRequestOtp as unknown as (arg: unknown) => Promise<{ code: string; retryAfterSeconds: number }>)({ data: { mobile: "9999900013" } });
    expect(result.code).toBe("otp_locked");
    expect(result.retryAfterSeconds).toBe(900);
    expect(state.calls).toEqual([]);
  });
});