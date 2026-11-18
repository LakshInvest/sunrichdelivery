import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useTeamAuth } from "@/lib/team-auth";
import { useLang } from "@/lib/l10n";
import { profileCopy } from "@/lib/profile-copy";
import { validStaffName } from "@/lib/profile-policy";

export function ProfileName({ name }: { name: string }) {
  const { refresh } = useTeamAuth();
  const { lang, t } = useLang(); const c = profileCopy(lang);
  const [open, setOpen] = useState(false); const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const save = async () => {
    if (!validStaffName(value)) return;
    setBusy(true); setError(false);
    try { const r = await supabase.rpc("set_my_name", { p_name: value.trim() }); if (r.error) throw r.error; await refresh(); setOpen(false); }
    catch { setError(true); } finally { setBusy(false); }
  };
  return <>
    <div className="flex items-center gap-1"><p className="min-w-0 flex-1 break-words text-lg font-bold leading-tight text-primary-foreground">{name}</p><Button variant="ghost" size="icon" aria-label={c.name} title={c.name} className="shrink-0 text-primary-foreground" onClick={() => { setValue(name); setError(false); setOpen(true); }}><Pencil /></Button></div>
    <Sheet open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}><SheetContent side="bottom" aria-describedby={undefined} className="mx-auto max-w-md rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <SheetTitle>{c.name}</SheetTitle>
      <form className="mt-5 grid gap-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="grid gap-2 font-semibold">{c.label}<input aria-label={c.label} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="name" className="h-14 rounded-xl border border-border bg-card px-4 text-lg" /></label>
        {!validStaffName(value) && <p className="text-sm text-destructive">{c.short}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{c.failed}</p>}
        <Button type="submit" className="h-14 text-lg" disabled={busy || !validStaffName(value)}>{busy ? t("c.loading") : t("pf.save")}</Button>
      </form>
    </SheetContent></Sheet>
  </>;
}