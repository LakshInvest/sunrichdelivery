import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, Info, Languages, LogOut, Repeat, Check, type LucideIcon } from "lucide-react";
import { useTeamAuth } from "@/lib/team-auth";
import { LANGS, useLang } from "@/lib/l10n";
import { BrandLogo, NoRoleScreen, Spinner } from "@/components/team/ui";
import { BottomNav, type TabRole } from "@/components/team/role-home";
import { availableRoles, formatStaffMobile, readLastRole } from "@/lib/role-home";
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

const tabRole: Record<string, TabRole> = { DRIVER: "driver", LOADER: "loader", SECURITY: "security" };

function MenuItemRow({ icon: Icon, label, onClick, danger, open }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean; open?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition active:bg-secondary/5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${danger ? "bg-destructive/10" : "bg-secondary/10"}`}>
        <Icon className={`h-5 w-5 ${danger ? "text-destructive" : "text-secondary"}`} aria-hidden />
      </span>
      <span className={`flex-1 truncate text-[15px] font-medium ${danger ? "text-destructive" : "text-foreground"}`}>{label}</span>
      {!danger && <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition ${open ? "rotate-90" : ""}`} aria-hidden />}
    </button>
  );
}

function Profile() {
  const { ready, staff, signOut } = useTeamAuth();
  const { t, lang, setLang } = useLang();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"lang" | "about" | null>(null);
  if (!ready) return <Spinner label={t("c.loading")} />;
  if (!staff) return <NoRoleScreen />;
  const roles = availableRoles(staff.roles);
  const current = readLastRole(staff.id) ?? (roles.length === 1 ? roles[0]?.code : null);
  const currentRole = roles.find((r) => r.code === current);
  const name = staff.fullName || "—";
  return (
    <main className="home-screen">
      <div className="home-scroll">
        <header className="sticky top-0 z-30 bg-background/95 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md">
          <h1 className="text-2xl font-bold tracking-tight text-primary">{t("profile.title")}</h1>
        </header>
        <div className="px-4">
          <section className="overflow-hidden rounded-2xl bg-card shadow-sm" data-testid="profile-card">
            <div className="bg-primary px-5 py-6">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-primary-foreground/40 bg-primary-foreground/20 text-xl font-bold text-primary-foreground">{name.charAt(0).toUpperCase()}</div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-lg font-bold leading-tight text-primary-foreground">{name}</p>
                  <p className="text-sm text-primary-foreground/75">{formatStaffMobile(staff.mobile)}</p>
                  {currentRole && <p className="mt-1 text-sm font-semibold text-aqua">{t(`role.${currentRole.code}`)}</p>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 px-5 py-3">
              {staff.roles.map((code) => <span key={code} className="chip bg-secondary/15 text-primary">{t(`role.${code}`) === `role.${code}` ? code.charAt(0) + code.slice(1).toLowerCase() : t(`role.${code}`)}</span>)}
            </div>
          </section>
          <section className="mt-4 divide-y divide-border rounded-2xl bg-card shadow-sm">
            {roles.length > 0 && <MenuItemRow icon={Repeat} label={t("profile.switchRole")} onClick={() => void navigate({ to: "/", search: { chooser: true } })} />}
            <MenuItemRow icon={Languages} label={t("profile.language")} open={panel === "lang"} onClick={() => setPanel(panel === "lang" ? null : "lang")} />
            {panel === "lang" && <div className="grid gap-1 p-2" role="group" aria-label={t("profile.language")}>
              {LANGS.map((l) => <button key={l.code} type="button" onClick={() => setLang(l.code)} aria-pressed={lang === l.code} className={`flex min-h-12 items-center justify-between rounded-xl px-4 text-base font-semibold ${lang === l.code ? "bg-secondary/10 text-primary" : "text-foreground"}`}>{l.label}{lang === l.code && <Check className="h-5 w-5 text-secondary" aria-hidden />}</button>)}
            </div>}
            <MenuItemRow icon={Info} label={t("profile.about")} open={panel === "about"} onClick={() => setPanel(panel === "about" ? null : "about")} />
            {panel === "about" && <div className="flex items-center gap-3 px-4 py-4">
              <BrandLogo className="h-10 w-10 shrink-0 rounded-xl" />
              <div className="min-w-0"><p className="text-sm font-semibold">Sunrich Delivery · {t("profile.version", { n: "1.0" })}</p><p className="mt-0.5 text-sm text-muted-foreground">{t("profile.aboutText")}</p></div>
            </div>}
            <MenuItemRow icon={LogOut} label={t("c.signOut")} danger onClick={() => setConfirm(true)} />
          </section>
        </div>
      </div>
      {currentRole && <BottomNav role={tabRole[currentRole.code] ?? "driver"} active="profile" />}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-sm">
          <AlertDialogHeader><AlertDialogTitle>{t("profile.signOutTitle")}</AlertDialogTitle><AlertDialogDescription>{t("profile.signOutConfirm")}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={busy}>{t("c.cancel")}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); setBusy(true); void signOut().finally(() => setBusy(false)); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{busy ? t("c.loading") : t("c.signOut")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
