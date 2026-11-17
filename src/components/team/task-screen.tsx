import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/l10n";
import { usePhotoUploading } from "@/components/team/ui";

export const taskInput = "w-full rounded-lg border border-input bg-background px-3 py-3 text-xl font-semibold outline-none focus:ring-2 focus:ring-ring";
export function TaskScreen({ title, back, children, action, error, menu }: { title: string; back: ReactNode; children: ReactNode; action?: ReactNode; error?: string | null; menu?: ReactNode }) {
  const { t } = useLang();
  return <main className="task-screen">
    <header className="flex h-20 shrink-0 items-center gap-3 border-b border-border px-4 pt-[env(safe-area-inset-top)]">
      <Button asChild variant="ghost" size="icon" className="h-12 w-12 shrink-0" aria-label={t("c.back")}>{back}</Button>
      <h1 className="min-w-0 flex-1 break-words text-lg font-bold leading-tight">{title}</h1>{menu}
    </header>
    <section className="task-content"><div className="grid gap-5">{children}{error && <p role="alert" className="break-words text-lg font-semibold text-destructive">{error}</p>}</div></section>
    {action && <footer className="task-action" data-testid="task-action">{action}</footer>}
  </main>;
}
export function BackIcon() { return <ArrowLeft aria-hidden className="h-6 w-6" />; }
export function MainAction({ children, onClick, disabled, danger }: { children: ReactNode; onClick?: () => void; disabled?: boolean; danger?: boolean }) {
  // Every page's main action waits while a photo is still uploading.
  const uploading = usePhotoUploading();
  const { t } = useLang();
  return <Button className="h-16 w-full whitespace-normal text-xl font-bold" variant={danger ? "destructive" : "default"} onClick={onClick} disabled={disabled || uploading}>{uploading ? t("c.photoUploading") : children}</Button>;
}
export function taskHead(title: string, description: string) {
  return { meta: [{ title: `${title} · Sunrich Delivery` }, { name: "description", content: description }, { property: "og:title", content: `${title} · Sunrich Delivery` }, { property: "og:description", content: description }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" }] };
}