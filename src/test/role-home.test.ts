import { describe, expect, it } from "vitest";
import { formatStaffMobile, preferredRole, readLastRole, rememberRole } from "@/lib/role-home";

describe("Role home selection", () => {
  it("opens the only delivery role directly", () => {
    expect(preferredRole(["DRIVER"], null)?.to).toBe("/driver");
  });
  it("remembers the last role separately for each staff member", () => {
    rememberRole("qa-one", "SECURITY");
    rememberRole("qa-two", "LOADER");
    expect(preferredRole(["DRIVER", "SECURITY"], readLastRole("qa-one"))?.to).toBe("/security");
    expect(readLastRole("qa-two")).toBe("LOADER");
  });
  it("keeps the chooser reachable from Profile even with one role", () => {
    expect(preferredRole(["DRIVER"], "DRIVER", true)).toBeUndefined();
  });
  it("does not open a role that has been removed", () => {
    expect(preferredRole(["DRIVER", "LOADER"], "SECURITY")).toBeUndefined();
  });
  it("formats the requested Indian mobile number", () => {
    expect(formatStaffMobile("+918698340766")).toBe("+91 86983 40766");
  });
});