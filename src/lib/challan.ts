// Delivery challan PDF for one stop. Built in the browser; jsPDF is loaded only when tapped.
// Labels and product names are English. Customer name, address and notes may be Hindi/Marathi:
// those are drawn with Noto Sans Devanagari through a canvas (the browser shapes matras and
// conjuncts correctly) and placed in the PDF as sharp images, so nothing is ever dropped.
import { supabase } from "@/integrations/supabase/client";
import { sharePdf } from "@/lib/native";
import deva400 from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff2?url";
import deva700 from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff2?url";
import type { jsPDF as JsPDF } from "jspdf";

export type ChallanLine = { product_name: string | null; pack_label?: string | null | undefined; qty: number; kept?: number | undefined; value?: number | null | undefined };
export type ChallanInput = {
  orderNo: string;
  firmId?: string | null | undefined;
  customer: string;
  address?: string | null | undefined;
  phone?: string | null | undefined;
  note?: string | null | undefined;
  tripNo?: string | null | undefined;
  lines: ChallanLine[];
};

const FAMILY = "ChallanDeva";
let fontReady: Promise<void> | null = null;
function loadFont(): Promise<void> {
  fontReady ??= (async () => {
    for (const [url, weight] of [[deva400, "400"], [deva700, "700"]] as const) {
      const f = new FontFace(FAMILY, `url(${url})`, { weight });
      document.fonts.add(await f.load());
    }
  })().catch((e) => { fontReady = null; throw e; });
  return fontReady;
}

const isAscii = (s: string) => /^[\x20-\x7E]*$/.test(s);
const money = (n: number) => `Rs ${n.toFixed(2)}`;
const PT_TO_MM = 0.3528;
const SCALE = 8; // canvas px per mm → crisp print

type Opts = { size?: number; bold?: boolean; align?: "left" | "center" | "right"; maxW?: number };

/** Writes text at (x, baseline y). Returns the height used in mm. */
function put(doc: JsPDF, raw: string, x: number, y: number, o: Opts = {}): number {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  const size = o.size ?? 9;
  const lineH = size * PT_TO_MM * 1.35;
  if (!text) return 0;
  doc.setFont("helvetica", o.bold ? "bold" : "normal").setFontSize(size);
  if (isAscii(text)) {
    const lines = o.maxW ? (doc.splitTextToSize(text, o.maxW) as string[]) : [text];
    doc.text(lines, x, y, { align: o.align ?? "left" });
    return lines.length * lineH;
  }
  // Devanagari / mixed text → canvas image with the embedded Noto font.
  const pxFont = size * PT_TO_MM * SCALE;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = `${o.bold ? 700 : 400} ${pxFont}px ${FAMILY}, Helvetica, Arial, sans-serif`;
  ctx.font = font;
  const maxPx = (o.maxW ?? 200) * SCALE;
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(" ")) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxPx && cur) { lines.push(cur); cur = w; } else cur = t;
  }
  if (cur) lines.push(cur);
  const linePx = lineH * SCALE;
  const widthPx = Math.ceil(Math.min(maxPx, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 4);
  c.width = widthPx;
  c.height = Math.ceil(linePx * lines.length + pxFont * 0.5);
  ctx.font = font;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  lines.forEach((l, i) => ctx.fillText(l, 0, pxFont + i * linePx));
  const wMm = c.width / SCALE;
  const hMm = c.height / SCALE;
  const left = o.align === "center" ? x - wMm / 2 : o.align === "right" ? x - wMm : x;
  doc.addImage(c.toDataURL("image/png"), "PNG", left, y - pxFont / SCALE, wMm, hMm);
  return lines.length * lineH;
}

export async function makeChallan(c: ChallanInput): Promise<void> {
  const [{ jsPDF }] = await Promise.all([import("jspdf"), loadFont()]);
  let firm = "Sunrich";
  let gstin = "";
  if (c.firmId) {
    const { data } = await supabase.from("firms").select("*").eq("id", c.firmId).maybeSingle();
    const f = data as { name?: string; legal_name?: string; gstin?: string } | null;
    firm = (f?.legal_name || f?.name || firm).trim();
    gstin = (f?.gstin ?? "").trim();
  }
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const W = doc.internal.pageSize.getWidth();
  const inner = W - 20;
  let y = 14;
  y += put(doc, firm, W / 2, y, { size: 14, bold: true, align: "center", maxW: inner });
  if (gstin) y += put(doc, `GSTIN ${gstin}`, W / 2, y, { size: 8, align: "center" });
  y += 2;
  y += put(doc, "DELIVERY CHALLAN", W / 2, y, { size: 11, bold: true, align: "center" }) + 3;
  const date = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  put(doc, `Order: ${c.orderNo}`, 10, y);
  y += put(doc, date, W - 10, y, { align: "right" });
  if (c.tripNo) y += put(doc, `Trip: ${c.tripNo}`, 10, y);
  y += put(doc, `To: ${c.customer || "-"}`, 10, y, { maxW: inner, bold: true });
  if (c.address) y += put(doc, c.address, 10, y, { maxW: inner });
  if (c.phone) y += put(doc, `Phone: ${c.phone}`, 10, y);
  if (c.note) y += put(doc, `Note: ${c.note}`, 10, y, { maxW: inner });
  y += 3;
  put(doc, "Item", 10, y, { bold: true });
  put(doc, "Qty", W - 45, y, { bold: true, align: "right" });
  put(doc, "Amount", W - 10, y, { bold: true, align: "right" });
  y += 2; doc.line(10, y, W - 10, y); y += 5;
  let total = 0;
  for (const l of c.lines) {
    const q = l.kept ?? l.qty;
    const amt = l.qty > 0 ? (Number(l.value ?? 0) * q) / l.qty : 0;
    total += amt;
    const h = put(doc, `${l.product_name || "Item"}${l.pack_label ? ` (${l.pack_label})` : ""}`, 10, y, { maxW: W - 65 });
    put(doc, String(q), W - 45, y, { align: "right" });
    put(doc, money(amt), W - 10, y, { align: "right" });
    y += Math.max(h, 4.5) + 1.5;
    if (y > 185) { doc.addPage(); y = 14; }
  }
  doc.line(10, y, W - 10, y); y += 5;
  put(doc, "Total", 10, y, { bold: true });
  put(doc, money(Math.round(total * 100) / 100), W - 10, y, { bold: true, align: "right" });
  y += 18;
  put(doc, "Receiver's signature", 10, y, { size: 8 });
  put(doc, "Driver", W - 10, y, { size: 8, align: "right" });
  const name = `challan-${c.orderNo.replace(/[^\w-]+/g, "_") || "stop"}.pdf`;
  const shared = await sharePdf(name, doc.output("datauristring"));
  if (!shared) doc.save(name);
}
