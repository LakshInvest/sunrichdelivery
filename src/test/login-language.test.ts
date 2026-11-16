import { describe, expect, it } from "vitest";
import { phoneLoginLanguage } from "@/lib/login-appearance";
describe("login phone language", () => {
  it("uses a supported phone language", () => {
    expect(phoneLoginLanguage(["mr-IN", "en-US"])).toBe("mr");
    expect(phoneLoginLanguage(["en-IN"])).toBe("en");
  });
  it("falls back to Hindi for unsupported phone languages", () => {
    expect(phoneLoginLanguage(["ta-IN"])).toBe("hi");
    expect(phoneLoginLanguage([])).toBe("hi");
  });
});