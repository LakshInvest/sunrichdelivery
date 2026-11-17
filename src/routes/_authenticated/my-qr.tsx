import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import QRCode from "react-qr-code";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { TaskScreen, BackIcon } from "@/components/team/task-screen";
import { Spinner, PhotoImg } from "@/components/team/ui";

export const Route = createFileRoute("/_authenticated/my-qr")({
  head: () => ({ meta: [
    { title: "My QR · Sunrich Delivery" },
    { name: "description", content: "Your changing staff QR for the Sunrich gate." },
    { property: "og:title", content: "My QR · Sunrich Delivery" },
    { property: "og:description", content: "Your changing staff QR for the Sunrich gate." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: MyQr,
});

/** Signed staff QR from the server; refreshed every 60s so screenshots expire. */
function MyQr() {
  const { t } = useLang(); const { staff } = useTeamAuth();
  const [code, setCode] = useState<string | null>(null); const [left, setLeft] = useState(60); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const get = async () => { const r = await supabase.rpc("my_staff_qr" as never); if (!alive) return; if (r.error) setErr(t("c.error")); else { setErr(null); setCode(r.data as unknown as string); setLeft(60); } };
    void get();
    const tick = setInterval(() => setLeft((n) => { if (n <= 1) { void get(); return 60; } return n - 1; }), 1000);
    return () => { alive = false; clearInterval(tick); };
  }, [t]);
  return <TaskScreen title={t("qr.mine")} back={<Link to="/profile"><BackIcon /></Link>} error={err}>
    <div className="home-card grid justify-items-center gap-4 p-6 text-center">
      {staff?.photo && <div className="h-20 w-20 overflow-hidden rounded-full"><PhotoImg path={staff.photo} className="h-full w-full object-cover" /></div>}
      <p className="text-xl font-bold">{staff?.fullName ?? ""}</p>
      {code ? <div className="rounded-2xl bg-card p-3"><QRCode value={code} size={240} aria-label={t("qr.mine")} /></div> : <Spinner />}
      <p className="text-base font-semibold text-secondary">{t("qr.refresh", { n: left })}</p>
      <p className="text-base text-muted-foreground">{t("qr.help")}</p>
    </div>
  </TaskScreen>;
}
