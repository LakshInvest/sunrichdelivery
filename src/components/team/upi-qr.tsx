// UPI deep-link QR, generated on device from the firm's UPI ID, payee name,
// amount and order number — the same scheme the customer app uses. Pure SVG,
// no uploaded image is involved.
import { useState } from "react";
import QRCode from "react-qr-code";
import { useLang } from "@/lib/l10n";

export function buildUpiUri(pa: string, pn: string | null, amount: number | null, tn: string | null): string {
  const params = [`pa=${encodeURIComponent(pa)}`];
  if (pn) params.push(`pn=${encodeURIComponent(pn)}`);
  if (amount != null && amount > 0) params.push(`am=${amount.toFixed(2)}`);
  if (tn) params.push(`tn=${encodeURIComponent(tn)}`);
  params.push("cu=INR");
  return `upi://pay?${params.join("&")}`;
}

export function UpiQrCode({
  pa,
  pn,
  amount,
  tn,
}: {
  pa: string;
  pn: string | null;
  amount: number | null;
  tn: string | null;
}) {
  const { t } = useLang();
  const [big, setBig] = useState(false);
  const uri = buildUpiUri(pa, pn, amount, tn);
  return (
    <>
      <button type="button" onClick={() => setBig(true)} aria-label={t("dr.qrBig")} className="mx-auto block rounded-lg bg-white p-2">
        <QRCode value={uri} size={140} bgColor="#FFFFFF" fgColor="#000000" />
        <span className="mt-1 block text-center text-xs font-semibold text-navy">🔍 {t("dr.qrBig")}</span>
      </button>
      {big && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-6" onClick={() => setBig(false)}>
          <QRCode value={uri} size={Math.min(typeof window !== "undefined" ? window.innerWidth - 48 : 320, 420)} bgColor="#FFFFFF" fgColor="#000000" />
          {amount != null && amount > 0 && <p className="text-3xl font-extrabold text-navy">₹{amount}</p>}
          {pn && <p className="text-sm font-semibold text-navy">{pn}</p>}
          <button type="button" onClick={() => setBig(false)} className="mt-2 w-full max-w-xs rounded-lg bg-navy py-3 text-base font-bold text-primary-foreground">{t("dr.qrClose")}</button>
        </div>
      )}
    </>
  );
}
