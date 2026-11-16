import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Truck, Boxes, ShieldCheck, ChevronRight, ArrowLeft, Check, LogOut } from "lucide-react";
import { useTeamAuth } from "@/lib/team-auth";
import { LANGS, useLang } from "@/lib/l10n";
import { BrandLogo, NoRoleScreen, Spinner } from "@/components/team/ui";
import { Button } from "@/components/ui/button";
import { availableRoles, formatStaffMobile, readLastRole, rememberRole } from "@/lib/role-home";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile · Sunrich Delivery" },
      { name: "description", content: "Your Sunrich Delivery profile, language and device." },
      { property: "og:title", content: "Profile · Sunrich Delivery" },
      { property: "og:description", content: "Your Sunrich Delivery profile, language and device." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Profile,
});

function Profile() {
  const { ready, staff, signOut } = useTeamAuth();
  const { t, lang, setLang } = useLang();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ready) return <Spinner label={t("c.loading")} />;
  if (!staff) return <NoRoleScreen />;
  const roles = availableRoles(staff.roles);
  const current = readLastRole(staff.id) ?? (roles.length === 1 ? roles[0]?.code : null);
  const icons = { DRIVER: Truck, LOADER: Boxes, SECURITY: ShieldCheck };
  const initials = staff.fullName.split(" ").slice(0, 2).map((word) => word[0] ?? "").join("").toUpperCase();
  const back = () => {
    const role = roles.find((r) => r.code === current);
    void navigate(role ? { to: role.to } : { to: "/", search: { chooser: true } });
  };
  return (
    <main className="account-page flex flex-col">
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 pb-4 pt-[max(env(safe-area-inset-top),1rem)]">
        <Button variant="ghost" size="icon" onClick={back} aria-label={t("c.back")} className="shrink-0"><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="font-display text-xl font-bold">{t("profile.title")}</h1>
      </header>
      <div className="px-4">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-card">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-primary text-lg font-bold text-primary-foreground">{initials || "—"}</span>
          <div className="min-w-0">
            <p className="break-words font-display text-lg font-bold">{staff.fullName || "—"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{formatStaffMobile(staff.mobile)}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">{staff.roles.map((code) => <span key={code} className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-primary">{t(roles.find((role) => role.code === code)?.key ?? `role.${code}`) === `role.${code}` ? code : t(roles.find((role) => role.code === code)?.key ?? `role.${code}`)}</span>)}</div>
          </div>
        </div>
        {roles.length > 0 && <section className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{t("profile.switchRole")}</h2><Button variant="ghost" size="icon" asChild><Link to="/" search={{ chooser: true }} aria-label={t("home.chooseRole")}><Boxes className="h-4 w-4" /></Link></Button></div>
          <div className="grid gap-1">{roles.map((role) => {
            const Icon = icons[role.code];
            return <Link key={role.code} to={role.to} onClick={() => rememberRole(staff.id, role.code)} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-3 active:bg-secondary" aria-current={role.code === current ? "page" : undefined}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-secondary text-navy"><Icon className="h-5 w-5" strokeWidth={1.75} /></span>
              <span className="min-w-0 text-sm font-semibold">{t(role.key)}</span>
              {role.code === current ? <Check className="h-4 w-4 shrink-0 text-primary" aria-label={t("profile.currentRole")} /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </Link>;
          })}</div>
        </section>}
        <section className="mt-6 border-t border-border pt-5">
          <h2 className="mb-3 text-sm font-semibold">{t("profile.language")}</h2>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1" role="group" aria-label={t("profile.language")}>
            {LANGS.map((l) => <Button key={l.code} variant="ghost" onClick={() => setLang(l.code)} aria-pressed={lang === l.code} className={`h-10 rounded-md ${lang === l.code ? "bg-card text-primary shadow-card hover:bg-card" : "text-muted-foreground"}`}>{l.short}</Button>)}
          </div>
        </section>
        <div className="mt-6 flex items-center gap-3 border-t border-border py-5">
          <BrandLogo className="h-8 w-8 shrink-0 rounded-lg" />
          <div><p className="text-sm font-semibold">Sunrich Delivery</p><p className="mt-0.5 text-xs text-muted-foreground">{t("profile.version", { n: "1.0" })}</p></div>
        </div>
      </div>
      <div className="mt-auto px-4 pt-5"><Button variant="ghost" onClick={() => setConfirm(true)} className="h-12 w-full text-destructive hover:bg-destructive/5 hover:text-destructive"><LogOut className="h-4 w-4" />{t("c.signOut")}</Button></div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] sm:max-w-sm">
          <AlertDialogHeader><AlertDialogTitle>{t("profile.signOutTitle")}</AlertDialogTitle><AlertDialogDescription>{t("profile.signOutConfirm")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("c.cancel")}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); setBusy(true); void signOut().finally(() => setBusy(false)); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{busy ? t("c.loading") : t("c.signOut")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
