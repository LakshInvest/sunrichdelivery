import { describe, expect, it } from "vitest";
import { otpExhausted, otpRetrySeconds, loginErrorKey } from "@/lib/staff-otp-policy";

const now = Date.parse("2026-11-16T05:20:00Z");
describe("staff code recovery", () => {
  it("requires 30 seconds between sends", () => {
    expect(otpRetrySeconds({ attempts: 0, max_attempts: 5, locked_until: null, created_at: new Date(now).toISOString() }, now)).toBe(30);
  });
  it("waits until locked_until", () => {
    expect(otpRetrySeconds({ attempts: 5, max_attempts: 5, locked_until: new Date(now + 900_000).toISOString() }, now)).toBe(900);
  });
  it("allows replacement after the old lock expires", () => {
    expect(otpRetrySeconds({ attempts: 5, max_attempts: 5, locked_until: new Date(now - 1).toISOString() }, now)).toBe(0);
  });
  it("treats attempts equal to max_attempts as used up", () => {
    expect(otpExhausted({ attempts: 5, max_attempts: 5, locked_until: null })).toBe(true);
    expect(otpExhausted({ attempts: 4, max_attempts: 5, locked_until: null })).toBe(false);
  });
  it("keeps OTP and PIN lock errors distinct", () => {
    expect(loginErrorKey("otp", "locked")).toBe("err.otp_locked");
    expect(loginErrorKey("pin", "locked")).toBe("err.pin_locked");
  });
});