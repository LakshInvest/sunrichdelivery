import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, Trash2, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { isNative, chooseNativeProfilePhoto, onProfilePhotoRestored, haptic } from "@/lib/native";
import { fileToDataUrl, photoUrl } from "@/lib/photo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { profileCopy } from "@/lib/profile-copy";
import { staffInitials } from "@/lib/profile-policy";

const VIEW = 280; // crop circle size on screen
const OUT = 512; // saved square size

/** Both native sources, browser picks and restored Android results enter the same cropper. */
export function ProfilePhoto({ name }: { name: string }) {
  const { t, lang } = useLang(); const c = profileCopy(lang);
  const { staff, refresh } = useTeamAuth();
  const input = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState(false); const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [src, setSrc] = useState<HTMLImageElement | null>(null);
  useEffect(() => { let ok = true; void photoUrl(staff?.photo).then((u) => ok && setUrl(u)); return () => { ok = false; }; }, [staff?.photo]);
  const load = async (f: File | null | undefined) => {
    if (!f) return;
    const img = new Image(); img.src = await fileToDataUrl(f);
    await img.decode(); setSrc(img);
  };
  useEffect(() => {
    let stop: (() => void) | undefined; let alive = true;
    void onProfilePhotoRestored((file) => { void load(file).catch(() => setError(c.photoFailed)); }).then((cleanup) => { if (alive) stop = cleanup; else cleanup(); }).catch(() => {});
    return () => { alive = false; stop?.(); };
  }, [c.photoFailed]);
  const choose = async (source: "camera" | "gallery") => {
    setSheet(false); setError(null);
    if (!isNative()) { (source === "camera" ? cameraInput : input).current?.click(); return; }
    setBusy(true);
    try { await load(await chooseNativeProfilePhoto(source)); } catch { setError(c.photoFailed); } finally { setBusy(false); }
  };
  const removePhoto = async () => {
    setBusy(true); setError(null);
    try { const r = await supabase.rpc("remove_my_photo"); if (r.error) throw r.error; setUrl(null); await refresh(); setRemove(false); }
    catch { setError(c.failed); } finally { setBusy(false); }
  };
  return <>
    <Button variant="ghost" type="button" disabled={busy} onClick={() => setSheet(true)} aria-label={t("pf.change")} data-testid="profile-photo" className="relative h-16 w-16 shrink-0 rounded-full p-0">
      <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-primary-foreground/40 bg-primary-foreground/20 text-xl font-bold text-primary-foreground">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : staffInitials(name)}
      </span>
      <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-aqua text-primary shadow"><Camera className="h-4 w-4" aria-hidden /></span>
    </Button>
    <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => { void load(e.target.files?.[0]).catch(() => setError(c.photoFailed)); e.target.value = ""; }} />
    <input ref={cameraInput} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => { void load(e.target.files?.[0]).catch(() => setError(c.photoFailed)); e.target.value = ""; }} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Sheet open={sheet} onOpenChange={setSheet}><SheetContent side="bottom" aria-describedby={undefined} className="mx-auto max-w-md rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <SheetTitle>{t("pf.change")}</SheetTitle>
      <div className="mt-4 grid gap-2">
        <Button variant="outline" className="h-14 justify-start text-lg" onClick={() => void choose("camera")}><Camera />{c.camera}</Button>
        <Button variant="outline" className="h-14 justify-start text-lg" onClick={() => void choose("gallery")}><ImagePlus />{c.gallery}</Button>
        {staff?.photo && <Button variant="ghost" className="h-14 justify-start text-lg text-destructive" onClick={() => { setSheet(false); setRemove(true); }}><Trash2 />{c.remove}</Button>}
      </div>
    </SheetContent></Sheet>
    <AlertDialog open={remove} onOpenChange={(next) => { if (!busy) setRemove(next); }}><AlertDialogContent>
      <AlertDialogTitle>{c.confirm}</AlertDialogTitle><AlertDialogDescription>{c.remove}</AlertDialogDescription>
      <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("c.cancel")}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void removePhoto(); }}>{busy ? t("c.loading") : c.remove}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent></AlertDialog>
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
    c.width = size; c.height = size;
    const k = size / VIEW, ctx = c.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--card").trim(); ctx.fillRect(0, 0, size, size);
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
        <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="mt-2 w-full accent-secondary" />
      </label>
      <Button variant="outline" type="button" onClick={() => setRot((r) => (r + 90) % 360)} className="min-h-12"><RotateCw className="h-5 w-5" aria-hidden />{t("pf.rotate")}</Button>
      {tech && <div className="w-full max-w-xs">
        <p className="text-sm font-semibold text-destructive">{t("c.photoFailed")}</p>
        <Button variant="link" type="button" onClick={() => setShowTech((v) => !v)} className="mt-1 text-xs text-secondary">ℹ {t("c.techDetails")}</Button>
        {showTech && <p className="mt-1 break-all rounded-xl bg-muted p-2 text-xs text-muted-foreground">{tech}</p>}
      </div>}
    </div>
    <footer className="grid grid-cols-2 gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Button variant="outline" type="button" onClick={onClose} disabled={busy} className="min-h-14">{t("c.cancel")}</Button>
      <Button type="button" onClick={() => void save()} disabled={busy} className="min-h-14">{busy ? t("c.photoUploading") : t("pf.save")}</Button>
    </footer>
  </div>;
}
