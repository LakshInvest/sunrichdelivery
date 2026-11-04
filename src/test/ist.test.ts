import { describe, expect, it, vi, afterEach } from "vitest";
import { istToday, istDayStart, istDayEnd, istDisplay } from "@/lib/ist";

afterEach(() => {
  vi.useRealTimers();
});

describe("istToday", () => {
  it("returns the IST date, not UTC, between midnight and 5:30 AM IST", () => {
    // 2026-11-01T20:00:00Z = 2026-11-02 01:30 IST — UTC says Nov 1, IST says Nov 2
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T20:00:00Z"));
    expect(istToday()).toBe("2026-11-02");
  });

  it("returns the IST date just after midnight IST", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T18:31:00Z")); // 00:01 IST Nov 2
    expect(istToday()).toBe("2026-11-02");
  });

  it("matches the UTC date during the rest of the day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T06:00:00Z")); // 11:30 IST Nov 2
    expect(istToday()).toBe("2026-11-02");
  });
});

describe("istDayStart / istDayEnd", () => {
  it("builds +05:30 day boundaries", () => {
    expect(istDayStart("2026-11-02")).toBe("2026-11-02T00:00:00+05:30");
    expect(istDayEnd("2026-11-02")).toBe("2026-11-02T23:59:59.999+05:30");
  });
});

describe("istDisplay", () => {
  it("renders an instant in Asia/Kolkata and shows a dash for null", () => {
    const s = istDisplay("2026-11-01T20:30:00Z");
    expect(s).toContain("Nov");
    expect(s).toContain("02:00"); // 20:30 UTC = 02:00 IST next day
    expect(istDisplay(null)).toBe("—");
  });
});

describe("istDisplay format", () => {
  it("shows dates as 02 Nov 2026, 02:00 am in IST", () => {
    expect(istDisplay("2026-11-01T20:30:00Z")).toBe("02 Nov 2026, 02:00 am");
    expect(istDisplay("2026-11-02T09:00:00Z")).toBe("02 Nov 2026, 02:30 pm");
  });
});
