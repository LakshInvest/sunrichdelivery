import { createFileRoute } from "@tanstack/react-router";
import { useTeamAuth } from "@/lib/team-auth";
import { useLang } from "@/lib/l10n";
import { getDeviceLabel } from "@/lib/device";
import { BrandLogo, LanguageChips, Screen, Spinner, useSignOut } from "@/components/team/ui";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({
    meta: [
      { title: "Profile · Sunrich Team" },
      { name: "description", content: "Your Sunrich Team profile, language and device." },
      { property: "og:title", content: "Profile · Sunrich Team" },
      { property: "og:description", content: "Your Sunrich Team profile, language and device." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Profile,
});

function Profile() {
  const { ready, staff, signOut } = useTeamAuth();
  const { t } = useLang();
  const signOutFn = useSignOut();

  if (!ready) return <Spinner label={t("c.loading")} />;
  if (!staff) {
    return (
      <Screen title={t("profile.title")}>
        <p className="text-sm text-muted-foreground">{t("home.noRoles")}</p>
      </Screen>
    );
  }

  const initials = staff.fullName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

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
        onClick={() => void signOutFn().then(() => signOut())}
        className="mt-8 w-full rounded-lg border border-destructive/40 bg-card py-3.5 text-sm font-bold text-destructive shadow-card active:bg-destructive/10"
      >
        {t("c.signOut")}
      </button>
    </Screen>
  );
}
