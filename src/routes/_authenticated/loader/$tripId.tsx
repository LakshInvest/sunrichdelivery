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
      { title: "Load vehicle · Sunrich Delivery" },
      { name: "description", content: "Record loading and finish the trip." },
      { property: "og:title", content: "Load vehicle · Sunrich Delivery" },
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
  const [trip, setTrip] = useState<{ trip_no: string; status: string; gate_in_at: string | null; returns_received_at: string | null; vehicles: { reg_no: string } | null } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [passes, setPasses] = useState<GatePass[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diffReason, setDiffReason] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [tripRes, rowsRes, passRes] = await Promise.all([
      supabase.from("trips").select("trip_no, status, gate_in_at, returns_received_at, vehicles(reg_no)").eq("id", tripId).single(),
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
      setMsg(mismatch ? t("ld.flaggedOffice") : t("ld.loadingDone"));
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

  const mismatch = rows.some((r) => Number(drafts[r.product_id]?.qty ?? 0) !== Number(r.planned_qty));

  const saveDrafts = async (): Promise<string | null> => {
    if (mismatch) {
      if (diffReason.trim() === "") return t("ld.diffNeedReason");
      const diff = rows
        .filter((r) => Number(drafts[r.product_id]?.qty ?? 0) !== Number(r.planned_qty))
        .map((r) => `${r.products?.name ?? r.product_id}: plan ${r.planned_qty}, loaded ${drafts[r.product_id]?.qty ?? 0}`)
        .join("; ");
      const f = await queueRpc("flag_load_mismatch", { p_trip_id: tripId, p_note: `${diff} — ${diffReason.trim()}` });
      if (f.error && !f.queued) return f.error;
    }
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
                  {r.loaded_qty != null && <StatusBadge status="loaded" />}
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

        {!done && mismatch && (
          <div className="mt-4 grid gap-1">
            <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("ld.diffReason")}</label>
            <input value={diffReason} onChange={(e) => setDiffReason(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
          </div>
        )}

        {trip.gate_in_at && <ReturnsPanel tripId={tripId} received={trip.returns_received_at !== null} productName={(id) => productName(rows.find((r) => r.product_id === id)?.products ?? null) ?? ""} onDone={() => void fetchAll()} />}

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
          <DockButton onClick={() => void (canFinalize && !mismatch ? finalize() : markDone())} disabled={saving || (mismatch && diffReason.trim() === "") || (canFinalize && shortRow !== undefined && diffReason.trim() === "")}>
            {saving ? t("c.loading") : canFinalize && !mismatch ? t("ld.finalize") : t("ld.loadingDone")}
          </DockButton>
        </ActionDock>
      )}
    </>
  );
}

// loader trip detail route

type Ret = { product_id: string | null; kind: string; expected_qty: number };
const KIND_LABEL: Record<string, string> = { undelivered: "ld.undelivered", damaged: "ld.damagedR", refused: "ld.refusedR", empties: "ld.emptiesR", crates: "ld.cratesR" };

/** Trip back in: expected (from the driver's entries) vs actual → Receive. Differences are flagged to the office. */
function ReturnsPanel({ tripId, received, productName, onDone }: { tripId: string; received: boolean; productName: (id: string) => string; onDone: () => void }) {
  const { t } = useLang();
  const [rows, setRows] = useState<Ret[]>([]);
  const [actual, setActual] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = (r: Ret) => `${r.kind}:${r.product_id ?? ""}`;

  useEffect(() => {
    if (received) return;
    void supabase.rpc("trip_return_expected" as never, { p_trip_id: tripId } as never).then(({ data, error }) => {
      if (error) return setErr(error.message);
      const list = ((data ?? []) as unknown as Ret[]).filter((r) => r.kind === "crates" || r.kind === "undelivered" || Number(r.expected_qty) > 0);
      setRows(list);
      setActual(Object.fromEntries(list.map((r) => [key(r), Number(r.expected_qty)])));
    });
  }, [tripId, received]);

  const receive = async () => {
    setBusy(true);
    setErr(null);
    const lines = rows.map((r) => ({ product_id: r.product_id, kind: r.kind, expected: Number(r.expected_qty), actual: actual[key(r)] ?? 0, name: r.product_id ? productName(r.product_id) : "" }));
    const res = await queueRpc("receive_returns", { p_trip_id: tripId, p_lines: lines, p_note: note || null });
    setBusy(false);
    if (res.error && !res.queued) return setErr(res.error);
    void haptic("success");
    onDone();
  };

  return (
    <div className="mt-6 rounded-xl border border-border bg-card p-4 shadow-card">
      <p className="font-display text-base font-bold text-foreground">{t("ld.returns")}</p>
      {received ? (
        <p className="mt-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">{t("ld.received")}</p>
      ) : (
        <>
          <div className="mt-3 grid gap-3">
            {rows.map((r) => {
              const a = actual[key(r)] ?? 0;
              const diff = a !== Number(r.expected_qty);
              return (
                <div key={key(r)} className={`rounded-lg px-3 py-2 ${diff ? "bg-amber-500/10" : "bg-muted/50"}`}>
                  <p className="text-sm font-semibold text-foreground">
                    {t(KIND_LABEL[r.kind] as never)}{r.product_id ? ` · ${productName(r.product_id)}` : ""}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{t("ld.expected")}: <span className="font-bold text-foreground">{Number(r.expected_qty)}</span></span>
                    <Stepper label={t("ld.actual")} value={a} onChange={(v) => setActual((s) => ({ ...s, [key(r)]: v }))} />
                  </div>
                </div>
              );
            })}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ld.returnsNote")} className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30" />
          {err && <p className="mt-2 text-sm font-medium text-destructive">{err}</p>}
          <button onClick={() => void receive()} disabled={busy || rows.length === 0} className="mt-3 w-full rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground active:opacity-80 disabled:opacity-60">
            {busy ? t("c.loading") : t("ld.receive")}
          </button>
        </>
      )}
    </div>
  );
}
