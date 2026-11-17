import { useEffect, useRef, useState } from "react";
import { Camera, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { isNative, takeNativePhoto, haptic } from "@/lib/native";
import { fileToDataUrl, photoUrl } from "@/lib/photo";

const VIEW = 280; // crop circle size on screen
const OUT = 512; // saved square size

/** Profile avatar: tap → front camera → crop (zoom, move, rotate, round preview) → save. Applied at once. */
export function ProfilePhoto({ name }: { name: string }) {
  const { t } = useLang();
  const { staff, refresh } = useTeamAuth();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [src, setSrc] = useState<HTMLImageElement | null>(null);
  useEffect(() => { let ok = true; void photoUrl(staff?.photo).then((u) => ok && setUrl(u)); return () => { ok = false; }; }, [staff?.photo]);
  const load = async (f: File | null | undefined) => {
    if (!f) return;
    const img = new Image(); img.src = await fileToDataUrl(f);
    await img.decode().catch(() => {}); setSrc(img);
  };
  const open = () => { if (isNative()) void takeNativePhoto(true).then((f) => (f ? load(f) : input.current?.click())); else input.current?.click(); };
  return <>
    <button type="button" onClick={open} aria-label={t("pf.change")} data-testid="profile-photo" className="relative h-16 w-16 shrink-0">
      <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-primary-foreground/40 bg-primary-foreground/20 text-xl font-bold text-primary-foreground">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
      </span>
      <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-aqua text-primary shadow"><Camera className="h-4 w-4" aria-hidden /></span>
    </button>
    <input ref={input} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
    {src && staff && <Cropper img={src} userId={staff.id} onClose={() => setSrc(null)} onSaved={async () => { setSrc(null); await refresh(); }} />}
  </>;
}

function Cropper({ img, userId, onClose, onSaved }: { img: HTMLImageElement; userId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useLang();
  const cv = useRef<HTMLCanvasElement>(null);
  const base = VIEW / Math.min(img.width || 1, img.height || 1);
  const [zoom, setZoom] = useState(1); const [rot, setRot] = useState(0); const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false); const [tech, setTech] = useState<string | null>(null); const [showTech, setShowTech] = useState(false);
  const draw = (c: HTMLCanvasElement, size: number) => {
    const k = size / VIEW, ctx = c.getContext("2d")!; c.width = size; c.height = size;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, size, size);
    ctx.translate(size / 2 + pos.x * k, size / 2 + pos.y * k); ctx.rotate((rot * Math.PI) / 180);
    const s = base * zoom * k; ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
  };
  useEffect(() => { if (cv.current) draw(cv.current, VIEW); });
  const save = async () => {
    setBusy(true); setTech(null);
    let size = 0;
    try {
      const c = document.createElement("canvas"); draw(c, OUT);
      const enc = (q: number) => new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("encode failed"))), "image/jpeg", q));
      let blob = await enc(0.85);
      for (const q of [0.75, 0.65, 0.55, 0.45]) { if (blob.size <= 150 * 1024) break; blob = await enc(q); }
      size = blob.size;
      const path = `team/${userId}/profile-${Date.now()}.jpg`;
      const up = await supabase.storage.from("operations").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (up.error) throw up.error;
      const r = await supabase.rpc("set_my_photo" as never, { p_path: path } as never);
      if (r.error) throw r.error;
      void haptic("success"); await onSaved();
    } catch (e) {
      setTech(`profile · image/jpeg · ${Math.round(size / 1024)} KB · ${e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)}`);
    } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-[60] flex flex-col bg-background" role="dialog" aria-label={t("pf.adjust")}>
    <header className="bg-primary px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]"><h2 className="text-lg font-bold text-primary-foreground">{t("pf.adjust")}</h2></header>
    <div className="flex flex-1 flex-col items-center gap-5 overflow-y-auto p-5">
      <canvas ref={cv} width={VIEW} height={VIEW} data-testid="crop-canvas" className="touch-none rounded-full shadow-card ring-4 ring-aqua"
        style={{ width: VIEW, height: VIEW }}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }; }}
        onPointerMove={(e) => { if (drag.current) setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); }}
        onPointerUp={() => { drag.current = null; }} />
      <label className="w-full max-w-xs text-sm font-semibold text-foreground">{t("pf.zoom")}
        <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="mt-2 w-full accent-[hsl(var(--secondary))]" />
      </label>
      <button type="button" onClick={() => setRot((r) => (r + 90) % 360)} className="flex min-h-12 items-center gap-2 rounded-xl border border-secondary/40 px-5 font-semibold text-primary"><RotateCw className="h-5 w-5" aria-hidden />{t("pf.rotate")}</button>
      {tech && <div className="w-full max-w-xs">
        <p className="text-sm font-semibold text-destructive">{t("c.photoFailed")}</p>
        <button type="button" onClick={() => setShowTech((v) => !v)} className="mt-1 text-xs font-semibold text-secondary">ℹ {t("c.techDetails")}</button>
        {showTech && <p className="mt-1 break-all rounded-xl bg-muted p-2 text-xs text-muted-foreground">{tech}</p>}
      </div>}
    </div>
    <footer className="grid grid-cols-2 gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button type="button" onClick={onClose} disabled={busy} className="min-h-14 rounded-2xl border border-primary/30 font-bold text-primary">{t("c.cancel")}</button>
      <button type="button" onClick={() => void save()} disabled={busy} className="min-h-14 rounded-2xl bg-primary font-bold text-primary-foreground disabled:opacity-60">{busy ? t("c.photoUploading") : t("pf.save")}</button>
    </footer>
  </div>;
}
