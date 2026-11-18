import { describe, expect, it } from "vitest";
import { validStaffName } from "@/lib/profile-policy";

describe("own staff name", () => {
  it("requires at least two letters, including Hindi", () => {
    expect(validStaffName("A")).toBe(false);
    expect(validStaffName("1 !")).toBe(false);
    expect(validStaffName("  AB  ")).toBe(true);
    expect(validStaffName("राम")).toBe(true);
  });
});