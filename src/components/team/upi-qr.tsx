// UPI deep-link QR, generated on device from the firm's UPI ID, payee name,
// amount and order number — the same scheme the customer app uses. Pure SVG,
// no uploaded image is involved.
import QRCode from "react-qr-code";

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
  return (
    <div className="mx-auto rounded-lg bg-white p-2">
      <QRCode value={buildUpiUri(pa, pn, amount, tn)} size={140} bgColor="#FFFFFF" fgColor="#000000" />
    </div>
  );
}
