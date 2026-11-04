// Delivery challan PDF for one stop. Built in the browser; jsPDF is loaded only when tapped.
import { supabase } from "@/integrations/supabase/client";
import { sharePdf } from "@/lib/native";

export type ChallanLine = { product_name: string | null; pack_label?: string | null; qty: number; kept?: number; value?: number | null };
export type ChallanInput = {
  orderNo: string;
  firmId?: string | null | undefined;
  customer: string;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  tripNo?: string | null;
  lines: ChallanLine[];
};

const money = (n: number) => `Rs ${n.toFixed(2)}`;
// jsPDF's built-in font is Latin only; drop other characters rather than print boxes.
const latin = (s: string | null | undefined) => (s ?? "").replace(/[^\x20-\x7E]/g, "").trim();

export async function makeChallan(c: ChallanInput): Promise<void> {
  const { jsPDF } = await import("jspdf");
  let firm = "Sunrich";
  let gstin = "";
  if (c.firmId) {
    const { data } = await supabase.from("firms").select("*").eq("id", c.firmId).maybeSingle();
    const f = data as { name?: string; legal_name?: string; gstin?: string } | null;
    firm = latin(f?.legal_name || f?.name) || firm;
    gstin = latin(f?.gstin);
  }
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const W = doc.internal.pageSize.getWidth();
  let y = 14;
  doc.setFont("helvetica", "bold").setFontSize(14).text(firm, W / 2, y, { align: "center" });
  y += 5;
  if (gstin) { doc.setFont("helvetica", "normal").setFontSize(8).text(`GSTIN ${gstin}`, W / 2, y, { align: "center" }); y += 5; }
  doc.setFont("helvetica", "bold").setFontSize(11).text("DELIVERY CHALLAN", W / 2, y, { align: "center" });
  y += 8;
  doc.setFont("helvetica", "normal").setFontSize(9);
  const date = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  doc.text(`Order: ${latin(c.orderNo)}`, 10, y);
  doc.text(date, W - 10, y, { align: "right" });
  y += 5;
  if (c.tripNo) { doc.text(`Trip: ${latin(c.tripNo)}`, 10, y); y += 5; }
  doc.text(`To: ${latin(c.customer) || "-"}`, 10, y); y += 5;
  const addr = latin(c.address);
  if (addr) { const a = doc.splitTextToSize(addr, W - 20) as string[]; doc.text(a, 10, y); y += a.length * 4.5; }
  if (c.phone) { doc.text(`Phone: ${latin(c.phone)}`, 10, y); y += 5; }
  y += 3;
  doc.setFont("helvetica", "bold");
  doc.text("Item", 10, y); doc.text("Qty", W - 45, y, { align: "right" }); doc.text("Amount", W - 10, y, { align: "right" });
  y += 2; doc.line(10, y, W - 10, y); y += 5;
  doc.setFont("helvetica", "normal");
  let total = 0;
  for (const l of c.lines) {
    const q = l.kept ?? l.qty;
    const amt = l.qty > 0 ? (Number(l.value ?? 0) * q) / l.qty : 0;
    total += amt;
    const name = (doc.splitTextToSize(`${latin(l.product_name) || "Item"}${l.pack_label ? ` (${latin(l.pack_label)})` : ""}`, W - 65) as string[]);
    doc.text(name, 10, y);
    doc.text(String(q), W - 45, y, { align: "right" });
    doc.text(money(amt), W - 10, y, { align: "right" });
    y += name.length * 4.5 + 1.5;
    if (y > 185) { doc.addPage(); y = 14; }
  }
  doc.line(10, y, W - 10, y); y += 5;
  doc.setFont("helvetica", "bold").text("Total", 10, y).text(money(Math.round(total * 100) / 100), W - 10, y, { align: "right" });
  y += 18;
  doc.setFont("helvetica", "normal").setFontSize(8);
  doc.text("Receiver's signature", 10, y);
  doc.text("Driver", W - 10, y, { align: "right" });
  const name = `challan-${latin(c.orderNo).replace(/[^\w-]+/g, "_") || "stop"}.pdf`;
  const shared = await sharePdf(name, doc.output("datauristring"));
  if (!shared) doc.save(name);
}
