import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useTeamAuth } from "@/lib/team-auth";
import { useLang } from "@/lib/l10n";
import { LanguageChips, Screen, Spinner, SyncBadge } from "@/components/team/ui";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({
    meta: [
      { title: "Home · Sunrich Team" },
      { name: "description", content: "Your Sunrich Team home screen." },
      { property: "og:title", content: "Home · Sunrich Team" },
      { property: "og:description", content: "Your Sunrich Team home screen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Home,
});

type RoleCard = { to: "/driver" | "/loader" | "/security"; title: string; sub: string; icon: string };

const ROLE_CARDS: Record<string, Omit<RoleCard, "title" | "sub"> & { key: string }> = {
  DRIVER: { to: "/driver", key: "home.driverCard", icon: "truck" },
  LOADER: { to: "/loader", key: "home.loaderCard", icon: "boxes" },
  SECURITY: { to: "/security", key: "home.securityCard", icon: "shield" },
};

function Home() {
  const { ready, staff, signOut } = useTeamAuth();
  const { t } = useLang();

  if (!ready) return <Spinner label={t("c.loading")} />;

  if (!staff) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6">
        <p className="text-center text-sm text-muted-foreground">{t("home.noRoles")}</p>
        <button onClick={() => void signOut()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          {t("c.signOut")}
        </button>
      </main>
    );
  }

  const cards = staff.roles
    .map((r) => ROLE_CARDS[r])
    .filter((c): c is (typeof ROLE_CARDS)[string] => Boolean(c));

  return (
    <Screen
      title={t("home.greeting", { name: staff.fullName.split(" ")[0] })}
      right={<LanguageChips />}
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SyncBadge />
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {staff.roles.join(" · ")}
        </span>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-5 text-center">
          <p className="text-sm text-muted-foreground">{t("home.noRoles")}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {cards.map((c) => (
            <Link
              key={c.key}
              to={c.to}
              className="flex items-center justify-between rounded-xl border border-border bg-card p-5 transition-colors active:bg-accent"
            >
              <div>
                <p className="text-base font-semibold text-foreground">{t(c.key)}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{t(`${c.key}Sub`)}</p>
              </div>
              <span aria-hidden className="text-xl text-muted-foreground">›</span>
            </Link>
          ))}
        </div>
      )}

      <button
        onClick={() => void signOut()}
        className="mt-8 w-full rounded-lg border border-input bg-background py-3 text-sm font-semibold text-foreground active:bg-accent"
      >
        {t("c.signOut")}
      </button>
    </Screen>
  );
}
