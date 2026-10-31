import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { ErrorCard, PhotoInput, Screen, Spinner, StatusBadge } from "@/components/team/ui";
import { useTeamAuth } from "@/lib/team-auth";
import { queueRpc } from "@/lib/offline";

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

function LoadTrip() {
  const { tripId } = Route.useParams();
  const { t, lang } = useLang();
  const { staff } = useTeamAuth();
  const [trip, setTrip] = useState<{ trip_no: string; status: string; vehicles: { reg_no: string } | null } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [passes, setPasses] = useState<GatePass[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { qty: string; crates: string; photo: string | null }>>({});
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
            { qty: x.loaded_qty != null ? String(x.loaded_qty) : "", crates: x.crates_count != null ? String(x.crates_count) : "", photo: null },
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
    else setMsg(t("ld.loadingDone"));
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
    setMsg(fin.queued ? t("c.tryAgainOffline") : t("ld.finalized"));
    await fetchAll();
  };

  const saveDrafts = async (): Promise<string | null> => {
    // save every unsaved row first
    const pending = rows.filter((r) => {
      const d = drafts[r.product_id];
      return d && d.qty !== "" && Number(d.qty) !== Number(r.loaded_qty ?? -1);
    });
    for (const r of pending) {
      const d = drafts[r.product_id];
      if (!d) continue;
      const res = await queueRpc("record_loading", {
        p_trip_id: tripId,
        p_product_id: r.product_id,
        p_loaded_qty: Number(d.qty),
        p_crates: d.crates === "" ? null : Number(d.crates),
        p_photo_url: d.photo,
      });
      if (res.error && !res.queued) return res.error;
    }
    return null;
  };

  const shortRow = useMemo(
    () => rows.find((r) => drafts[r.product_id]?.qty !== "" && Number(drafts[r.product_id]?.qty ?? 0) < Number(r.planned_qty)),
    [rows, drafts],
  );

  if (loading) return <Screen title={t("ld.loadScreen")}><Spinner label={t("c.loading")} /></Screen>;
  if (!trip) return <Screen title={t("ld.loadScreen")}><ErrorCard message={error ?? t("c.error")} onRetry={() => void fetchAll()} /></Screen>;

  const done = trip.status !== "planned" && trip.status !== "loading";

  return (
    <Screen title={t("ld.loadScreen")} right={<StatusBadge status={trip.status} />}>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("ld.trip", { no: trip.trip_no })}
        {trip.vehicles?.reg_no ? ` · ${trip.vehicles.reg_no}` : ""}
      </p>

      <div className="grid gap-3">
        {rows.map((r) => {
          const d = drafts[r.product_id] ?? { qty: "", crates: "", photo: null };
          const short = d.qty !== "" && Number(d.qty) < Number(r.planned_qty);
          return (
            <div key={r.product_id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{productName(r.products)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("ld.planned")}: {r.planned_qty} {r.products?.sell_unit ?? ""}
                  </p>
                </div>
                {r.loaded_qty != null && <StatusBadge status="delivered" />}
              </div>
              {!done && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">{t("ld.enterLoaded")}</label>
                    <input
                      inputMode="numeric"
                      value={d.qty}
                      onChange={(e) =>
                        setDrafts((s) => ({ ...s, [r.product_id]: { ...d, qty: e.target.value.replace(/\D/g, "") } }))
                      }
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-foreground">{t("ld.crates")}</label>
                    <input
                      inputMode="numeric"
                      value={d.crates}
                      onChange={(e) =>
                        setDrafts((s) => ({ ...s, [r.product_id]: { ...d, crates: e.target.value.replace(/\D/g, "") } }))
                      }
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
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

      {!done && (
        <button
          onClick={() => void finalize()}
          disabled={saving || shortRow !== undefined}
          className="mt-6 w-full rounded-lg bg-primary py-3.5 text-base font-semibold text-primary-foreground active:opacity-80 disabled:opacity-50"
        >
          {saving ? t("c.loading") : t("ld.finalize")}
        </button>
      )}

      {passes.length > 0 && (
        <div className="mt-6 rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-bold text-foreground">{t("ld.gatePass")}</p>
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
  );
}

// loader trip detail route
