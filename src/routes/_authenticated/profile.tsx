import { createFileRoute, Link } from "@tanstack/react-router";
import { Truck, Boxes, ShieldCheck, ChevronRight } from "lucide-react";
import { useTeamAuth } from "@/lib/team-auth";
import { useLang } from "@/lib/l10n";
import { getDeviceLabel } from "@/lib/device";
import { BrandLogo, LanguageChips, NoRoleScreen, Screen, Spinner } from "@/components/team/ui";

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
  const { t } = useLang();

  if (!ready) return <Spinner label={t("c.loading")} />;
  if (!staff) return <NoRoleScreen />;

  const initials = staff.fullName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  const ROLE_LINKS = {
    DRIVER: { to: "/driver" as const, key: "home.driverCard", icon: <Truck className="h-5 w-5" /> },
    LOADER: { to: "/loader" as const, key: "home.loaderCard", icon: <Boxes className="h-5 w-5" /> },
    SECURITY: { to: "/security" as const, key: "home.securityCard", icon: <ShieldCheck className="h-5 w-5" /> },
  };
  const roleLinks = staff.roles
    .map((r) => ROLE_LINKS[r as keyof typeof ROLE_LINKS])
    .filter((x): x is (typeof ROLE_LINKS)["DRIVER"] | (typeof ROLE_LINKS)["LOADER"] | (typeof ROLE_LINKS)["SECURITY"] => Boolean(x));

  const rows: [string, string][] = [
    [t("profile.name"), staff.fullName || "—"],
    [t("profile.mobile"), staff.mobile || "—"],
    [t("profile.roles"), staff.roles.join(" · ") || "—"],
    [t("profile.device"), getDeviceLabel()],
  ];

  return (
    <Screen title={t("profile.title")}>
      <div className="mb-5 flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-card">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-primary text-lg font-bold text-primary-foreground">
          {initials || "—"}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold text-foreground">{staff.fullName || "—"}</p>
          <p className="text-sm text-muted-foreground">{staff.mobile}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        {rows.map(([k, v], i) => (
          <div key={k} className={`flex items-center justify-between gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-border" : ""}`}>
            <span className="text-sm text-muted-foreground">{k}</span>
            <span className="truncate text-sm font-semibold text-foreground">{v}</span>
          </div>
        ))}
      </div>

      {roleLinks.length > 1 && (
        <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <p className="px-4 pt-3 text-sm font-medium text-foreground">{t("profile.switchRole")}</p>
          {roleLinks.map((r) => (
            <Link key={r.to} to={r.to} className="flex items-center gap-3 px-4 py-3.5 active:bg-accent">
              <span className="text-navy">{r.icon}</span>
              <span className="flex-1 text-sm font-semibold text-foreground">{t(r.key)}</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          ))}
        </div>
      )}

      <div className="mt-4 rounded-xl border border-border bg-card p-4 shadow-card">
        <p className="mb-2 text-sm font-medium text-foreground">{t("profile.language")}</p>
        <LanguageChips />
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card p-4 text-sm shadow-card">
        <BrandLogo className="h-6" />
        <span className="text-xs text-muted-foreground">
          {t("profile.appVersion")}: {typeof window !== "undefined" ? "1.0" : "1.0"}
        </span>
      </div>

      <button
        onClick={() => void signOut()}
        className="mt-8 w-full rounded-lg border border-destructive/40 bg-card py-3.5 text-sm font-bold text-destructive shadow-card active:bg-destructive/10"
      >
        {t("c.signOut")}
      </button>
    </Screen>
  );
}
