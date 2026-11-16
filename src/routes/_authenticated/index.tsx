import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTeamAuth } from "@/lib/team-auth";
import { useLang } from "@/lib/l10n";
import { CashToConfirm } from "@/components/team/cash-handover";
import { AvatarLink, NoRoleScreen, Spinner, SyncBadge } from "@/components/team/ui";
import { Truck, Boxes, ShieldCheck, ChevronRight } from "lucide-react";
import { availableRoles, preferredRole, readLastRole, rememberRole } from "@/lib/role-home";
import { RoleCount, useRoleCounts } from "@/components/team/role-counts";
import whiteLogo from "@/assets/sunrich-logo-white.png.asset.json";

export const Route = createFileRoute("/_authenticated/")({
  validateSearch: (search: Record<string, unknown>): { chooser?: boolean } =>
    search['chooser'] === true || search['chooser'] === "true" ? { chooser: true } : {},
  head: () => ({
    meta: [
      { title: "Home · Sunrich Delivery" },
      { name: "description", content: "Your Sunrich Delivery home screen." },
      { property: "og:title", content: "Home · Sunrich Delivery" },
      { property: "og:description", content: "Your Sunrich Delivery home screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

const ROLE_ICONS = { DRIVER: Truck, LOADER: Boxes, SECURITY: ShieldCheck };

function Home() {
  const { ready, staff } = useTeamAuth();
  const { t } = useLang();
  const { chooser } = Route.useSearch();
  const navigate = useNavigate();
  const counts = useRoleCounts(staff);
  useEffect(() => {
    if (!ready || !staff) return;
    const role = preferredRole(staff.roles, readLastRole(staff.id), chooser);
    if (role) {
      rememberRole(staff.id, role.code);
      void navigate({ to: role.to, replace: true });
    }
  }, [ready, staff, chooser, navigate]);

  if (!ready) return <Spinner label={t("c.loading")} />;

  if (!staff) return <NoRoleScreen />;

  const cards = availableRoles(staff.roles);
  const isCashier = staff.permissions.includes("finance:create");
  if (cards.length === 0 && !isCashier) return <NoRoleScreen />;

  return (
    <main className="account-page">
      <header className="bg-navy px-5 pb-6 pt-[max(env(safe-area-inset-top),1.25rem)] text-primary-foreground">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0"><img src={whiteLogo.url} alt="Sunrich" className="h-7 w-auto object-contain" /><p className="mt-1 text-xs font-semibold">Sunrich Delivery</p></div>
          <AvatarLink />
        </div>
        <h1 className="mt-5 font-display text-2xl font-bold">{t("home.greeting", { name: staff.fullName.split(" ")[0] ?? staff.fullName })}</h1>
      </header>
      <div className="px-4 py-5">
        <SyncBadge />
        <div className="grid gap-3">
          {cards.map((c) => {
            const Icon = ROLE_ICONS[c.code];
            return (
            <Link
              key={c.code}
              to={c.to}
              onClick={() => rememberRole(staff.id, c.code)}
              className="grid grid-cols-[auto_minmax(0,1fr)_5.5rem] items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-card active:bg-secondary"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-secondary text-navy">
                <Icon className="h-6 w-6" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-base font-bold text-foreground">{t(c.key)}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{t(`${c.key}Sub`)}</span>
              </span>
              <span className="min-w-0 text-right"><RoleCount code={c.code} count={counts[c.code]} /><ChevronRight className="ml-auto mt-1 h-4 w-4 text-muted-foreground" aria-hidden /></span>
            </Link>
            );
          })}
        </div>
        <div className="mt-5"><CashToConfirm /></div>
      </div>
    </main>
  );
}
