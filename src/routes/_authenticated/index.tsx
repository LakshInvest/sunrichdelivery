import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTeamAuth } from "@/lib/team-auth";
import { useLang } from "@/lib/l10n";
import { BrandLogo, LanguageChips, Screen, Spinner, SyncBadge } from "@/components/team/ui";
import { Truck, Boxes, ShieldCheck, ChevronRight, UserRound } from "lucide-react";

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

type RoleCard = { to: "/driver" | "/loader" | "/security"; titleKey: string; icon: ReactNode };

const ROLE_CARDS: Record<string, RoleCard> = {
  DRIVER: { to: "/driver", titleKey: "home.driverCard", icon: <Truck className="h-7 w-7" /> },
  LOADER: { to: "/loader", titleKey: "home.loaderCard", icon: <Boxes className="h-7 w-7" /> },
  SECURITY: { to: "/security", titleKey: "home.securityCard", icon: <ShieldCheck className="h-7 w-7" /> },
};

const TILE_TONES = ["bg-aqua-soft text-navy", "bg-primary text-primary-foreground", "bg-emerald-500/15 text-emerald-700"];

function Home() {
  const { ready, staff, signOut } = useTeamAuth();
  const { t } = useLang();

  if (!ready) return <Spinner label={t("c.loading")} />;

  if (!staff) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6">
        <BrandLogo />
        <p className="text-center text-sm text-muted-foreground">{t("home.noRoles")}</p>
        <button onClick={() => void signOut()} className="rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-soft">
          {t("c.signOut")}
        </button>
      </main>
    );
  }

  const cards = staff.roles
    .map((r) => ROLE_CARDS[r])
    .filter((c): c is (typeof ROLE_CARDS)[string] => Boolean(c));
  const initials = staff.fullName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <Screen
      title={t("home.greeting", { name: staff.fullName.split(" ")[0] ?? staff.fullName })}
      right={
        <Link
          to="/profile"
          aria-label={t("home.profile")}
          className="grid h-11 w-11 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground shadow-soft"
        >
          {initials || <UserRound className="h-5 w-5" />}
        </Link>
      }
    >
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <SyncBadge />
        <div className="flex-1" />
        <LanguageChips />
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-5 text-center shadow-card">
          <p className="text-sm text-muted-foreground">{t("home.noRoles")}</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {cards.map((c, i) => (
            <Link
              key={c.titleKey}
              to={c.to}
              className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-card transition-transform active:scale-[0.99]"
            >
              <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl ${TILE_TONES[i % TILE_TONES.length]}`}>
                {c.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-display text-lg font-bold text-foreground">{t(c.titleKey)}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{t(`${c.titleKey}Sub`)}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            </Link>
          ))}
        </div>
      )}

      <button
        onClick={() => void signOut()}
        className="mt-8 w-full rounded-lg border border-input bg-card py-3.5 text-sm font-semibold text-foreground shadow-card active:bg-accent"
      >
        {t("c.signOut")}
      </button>
    </Screen>
  );
}
