import { describe, expect, it } from "vitest";
import { keptValue, type LineRow } from "@/components/team/driver-parts";

const line = (qty: number, value: number): LineRow => ({ id: "a", product_name: "1 Litre", pack_label: null, qty, value });

describe("amount due follows what the customer keeps", () => {
  it("4 packs at ₹440, 1 refused → ₹330", () => {
    expect(keptValue([line(4, 440)], () => 3)).toBe(330);
  });
  it("nothing kept → ₹0", () => {
    expect(keptValue([line(2, 180)], () => 0)).toBe(0);
  });
});
