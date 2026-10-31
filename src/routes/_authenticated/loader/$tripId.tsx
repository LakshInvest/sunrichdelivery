import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { ErrorCard, PhotoInput, Screen, Spinner, StatusBadge, ActionDock, DockButton, Stepper } from "@/components/team/ui";
import { useTeamAuth } from "@/lib/team-auth";
import { queueRpc } from "@/lib/offline";
import { haptic } from "@/lib/native";

export const Route = createFileRoute("/_authenticated/loader/$tripId")({
  head: () => ({
    meta: [
      { title: "Load vehicle · Sunrich Team" },
      { name: "description", content: "Record loading and finish the trip." },
      { property: "og:title", content: "Load vehicle · Sunrich Team" },
      { property: "og:description", content: "Record loading and finish the trip." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoadTrip,
});

type Row = {
  product_id: string;
  planned_qty: number;
  loaded_qty: number | null;
  crates_count: number | null;
  products: { name: string; name_hi: string | null; name_mr: string | null; code: string; sell_unit: string } | null;
};

type GatePass = { id: string; pass_no: string; qr_token: string };
type Draft = { qty: number; crates: number; photo: string | null };

function LoadTrip() {
  const { tripId } = Route.useParams();
  const { t, lang } = useLang();
  const { staff } = useTeamAuth();
  const [trip, setTrip] = useState<{ trip_no: string; status: string; vehicles: { reg_no: string } | null } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [passes, setPasses] = useState<GatePass[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tripRes, rowsRes, passRes] = await Promise.all([
      supabase.from("trips").select("trip_no, status, vehicles(reg_no)").eq("id", tripId).single(),
      supabase
        .from("trip_loading")
        .select("product_id, planned_qty, loaded_qty, crates_count, products(name, name_hi, name_mr, code, sell_unit)")
        .eq("trip_id", tripId),
      supabase.from("gate_passes").select("id, pass_no, qr_token").eq("trip_id", tripId),
    ]);
    if (tripRes.error || rowsRes.error) {
      setError(tripRes.error?.message ?? rowsRes.error?.message ?? t("c.error"));
      setRows([]);
    } else {
      setTrip(tripRes.data as never);
      const r = (rowsRes.data ?? []) as Row[];
      setRows(r);
      setDrafts(
        Object.fromEntries(
          r.map((x) => [
            x.product_id,
            { qty: x.loaded_qty ?? 0, crates: x.crates_count ?? 0, photo: null },
          ]),
        ),
      );
    }
    if (!passRes.error) setPasses((passRes.data ?? []) as GatePass[]);
    setLoading(false);
  }, [tripId, t]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const productName = (p: Row["products"]) =>
    lang === "hi" ? p?.name_hi || p?.name : lang === "mr" ? p?.name_mr || p?.name : p?.name;

  // Finalizing creates invoices, so only dispatch supervisors (dispatch approve/edit) may do it.
  // A plain loader just records counts and marks loading done.
  const canFinalize = (staff?.permissions ?? []).some((p) => p === "dispatch:approve" || p === "dispatch:edit");

  const markDone = async () => {
    if (!staff || saving) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    const res = await saveDrafts();
    setSaving(false);
    if (res) setError(res);
    else {
      void haptic("success");
      setMsg(t("ld.loadingDone"));
    }
    await fetchAll();
  };

  const finalize = async () => {
    if (!staff || saving) return;
    setSaving(true);
    setError(null);
    setMsg(null);
    const res = await saveDrafts();
    if (res) {
      setSaving(false);
      setError(res);
      return;
    }
    const fin = await queueRpc("finalize_loading", { p_trip_id: tripId });
    setSaving(false);
    if (fin.error && !fin.queued) {
      setError(fin.error);
      return;
    }
    if (!fin.queued) void haptic("success");
    setMsg(fin.queued ? t("c.tryAgainOffline") : t("ld.finalized"));
    await fetchAll();
  };

  const saveDrafts = async (): Promise<string | null> => {
    // save every unsaved row first
    const pending = rows.filter((r) => {
      const d = drafts[r.product_id];
      return d && d.qty > 0 && d.qty !== Number(r.loaded_qty ?? -1);
    });
    for (const r of pending) {
      const d = drafts[r.product_id];
      if (!d) continue;
      const res = await queueRpc("record_loading", {
        p_trip_id: tripId,
        p_product_id: r.product_id,
        p_loaded_qty: d.qty,
        p_crates: d.crates > 0 ? d.crates : null,
        p_photo_url: d.photo,
      });
      if (res.error && !res.queued) return res.error;
    }
    return null;
  };

  const shortRow = useMemo(
    () => rows.find((r) => Number(drafts[r.product_id]?.qty ?? 0) < Number(r.planned_qty)),
    [rows, drafts],
  );

  if (loading) return <Screen title={t("ld.loadScreen")}><Spinner label={t("c.loading")} /></Screen>;
  if (!trip) return <Screen title={t("ld.loadScreen")}><ErrorCard message={error ?? t("c.error")} onRetry={() => void fetchAll()} /></Screen>;

  const done = trip.status !== "planned" && trip.status !== "loading";

  return (
    <>
      <Screen title={t("ld.loadScreen")} right={<StatusBadge status={trip.status} />}>
        <p className="mb-5 text-sm text-muted-foreground">
          {t("ld.trip", { no: trip.trip_no })}
          {trip.vehicles?.reg_no ? ` · ${trip.vehicles.reg_no}` : ""}
        </p>

        <div className="grid gap-3">
          {rows.map((r) => {
            const d = drafts[r.product_id] ?? { qty: 0, crates: 0, photo: null };
            const short = d.qty < r.planned_qty;
            return (
              <div key={r.product_id} className="rounded-xl border border-border bg-card p-4 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-base font-bold text-foreground">{productName(r.products)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("ld.planned")}: <span className="font-bold text-foreground">{r.planned_qty}</span> {r.products?.sell_unit ?? ""}
                    </p>
                  </div>
                  {r.loaded_qty != null && <StatusBadge status="delivered" />}
                </div>
                {!done && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
                    <Stepper label={t("ld.enterLoaded")} value={d.qty} onChange={(v) => setDrafts((s) => ({ ...s, [r.product_id]: { ...d, qty: v } }))} />
                    <Stepper label={t("ld.crates")} value={d.crates} onChange={(v) => setDrafts((s) => ({ ...s, [r.product_id]: { ...d, crates: v } }))} />
                  </div>
                )}
                {short && !done && (
                  <p className="mt-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                    {t("ld.shortNote")}
                  </p>
                )}
                {!done && (
                  <div className="mt-3">
                    <PhotoInput
                      userId={staff?.id ?? "anon"}
                      kind={`load-${r.product_id}`}
                      label={t("c.camera")}
                      value={d.photo}
                      onChange={(path) => setDrafts((s) => ({ ...s, [r.product_id]: { ...d, photo: path } }))}
                    />
                  </div>
                )}
              </div>
            );
          })}
          {rows.length === 0 && <p className="text-sm text-muted-foreground">{t("c.none")}</p>}
        </div>

        {msg && <p className="mt-4 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">{msg}</p>}
        {error && <div className="mt-4"><ErrorCard message={error} /></div>}

        {passes.length > 0 && (
          <div className="mt-6 rounded-xl border border-border bg-card p-4 shadow-card">
            <p className="font-display text-base font-bold text-foreground">{t("ld.gatePass")}</p>
            {passes.map((p) => (
              <div key={p.id} className="mt-2">
                <p className="text-sm text-foreground">
                  {t("ld.gatePassNo")}: <span className="font-semibold">{p.pass_no}</span>
                </p>
                <p className="mt-1 break-all rounded-lg bg-muted px-2 py-1.5 font-mono text-xs text-muted-foreground">
                  {p.qr_token}
                </p>
              </div>
            ))}
          </div>
        )}
      </Screen>

      {!done && (
        <ActionDock>
          <DockButton onClick={() => void (canFinalize ? finalize() : markDone())} disabled={saving || (canFinalize && shortRow !== undefined)}>
            {saving ? t("c.loading") : canFinalize ? t("ld.finalize") : t("ld.loadingDone")}
          </DockButton>
        </ActionDock>
      )}
    </>
  );
}

// loader trip detail route
