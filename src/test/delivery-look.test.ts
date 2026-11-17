import { describe, expect, it } from "vitest";
import { cleanLook, lookText } from "@/lib/delivery-look";

describe("delivery look from Command Center", () => {
  it("keeps only public branding fields", () => {
    expect(cleanLook({ login_tagline: "DELIVERY", secret_key: "x", login_show_logo: false })).toEqual({ login_tagline: "DELIVERY", login_show_logo: false });
  });
  it("uses Hindi text when set, else the base text", () => {
    expect(lookText({ pin_title: "Enter PIN", pin_title_hi: "पिन डालें" }, "pin_title", "hi", "x")).toBe("पिन डालें");
    expect(lookText({ pin_title: "Enter PIN" }, "pin_title", "mr", "x")).toBe("Enter PIN");
    expect(lookText({}, "pin_title", "hi", "fallback")).toBe("fallback");
  });
});
