// Full-screen gate pass QR for the driver to show at the plant gate.
// The QR value is the trip's existing gate-pass token.
import { useEffect } from "react";
import QRCode from "react-qr-code";
import { X } from "lucide-react";
import { useLang } from "@/lib/l10n";
import { maxBrightness } from "@/lib/native";

export function GatePassScreen({
  token,
  tripNo,
  vehicle,
  driver,
  items,
  onClose,
}: {
  token: string;
  tripNo: string;
  vehicle: string;
  driver: string;
  items: number;
  onClose: () => void;
}) {
  const { t } = useLang();
  useEffect(() => {
    let restore: (() => void) | null = null;
    void maxBrightness().then((r) => (restore = r));
    return () => restore?.();
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-card px-6 pb-[max(env(safe-area-inset-bottom),1rem)] pt-[max(env(safe-area-inset-top),1rem)]"
      role="dialog"
      aria-label={t("dr.gatePass")}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("c.close")}
        className="absolute right-4 top-[max(env(safe-area-inset-top),1rem)] grid h-12 w-12 place-items-center rounded-full bg-muted text-foreground"
      >
        <X className="h-6 w-6" />
      </button>
      <p className="mb-1 font-display text-2xl font-bold text-foreground">{t("dr.gatePass")}</p>
      <p className="mb-5 text-center text-sm text-muted-foreground">{t("dr.showGatePass")}</p>
      <div className="rounded-2xl bg-[#FFFFFF] p-4">
        <QRCode value={token} size={260} level="M" bgColor="#FFFFFF" fgColor="#000000" />
      </div>
      <div className="mt-5 grid w-full max-w-xs gap-1 text-center">
        <p className="font-display text-2xl font-bold text-foreground">{tripNo}</p>
        <p className="text-lg font-semibold text-foreground">{vehicle}</p>
        <p className="text-sm text-muted-foreground">
          {t("dr.driver")}: {driver} · {t("dr.items")}: {items}
        </p>
      </div>
    </div>
  );
}
