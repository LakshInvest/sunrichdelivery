import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { queueRpc } from "@/lib/offline";
import { friendlyError } from "@/lib/friendly-error";
import { Banknote } from "lucide-react";

const inputCls = "rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus:border-aqua focus:ring-2 focus:ring-aqua/30";

/** Driver: hand the trip cash to a cashier; the cashier's confirmation settles the trip. */
export function CashHandoverPanel({ tripId, amount }: { tripId: string; amount: number }) {
  const { t } = useLang();
  const [cashiers, setCashiers] = useState<{ id: string; full_name: string }[]>([]);
  const [to, setTo] = useState("");
  const [amt, setAmt] = useState(String(amount));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, h] = await Promise.all([
      supabase.rpc("cashier_list" as never),
      supabase.from("cash_handovers").select("id, confirmed_at, to_user_id").eq("trip_id", tripId).is("confirmed_at", null).maybeSingle(),
    ]);
    const list = ((c.data ?? []) as unknown as { id: string; full_name: string }[]);
    setCashiers(list);
    const row = h.data as { to_user_id: string } | null;
    setPending(row ? list.find((x) => x.id === row.to_user_id)?.full_name ?? "—" : null);
  }, [tripId]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setAmt(String(amount)), [amount]);

  const send = async () => {
    if (!to) return setErr(t("dr.pickCashier"));
    setBusy(true);
    setErr(null);
    const res = await queueRpc("record_cash_handover", { p_to_user_id: to, p_amount: Number(amt || 0), p_trip_id: tripId, p_note: note || null });
    setBusy(false);
    if (res.error && !res.queued) return setErr(friendlyError(res.error, t));
    await load();
  };

  if (pending)
    return (
      <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-foreground" data-testid="handover-waiting">
        {t("dr.handoverWaiting", { name: pending })}
      </p>
    );

  return (
    <div className="mt-3 grid gap-2">
      <select value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} aria-label={t("dr.cashier")}>
        <option value="">{t("dr.cashier")}</option>
        {cashiers.map((c) => (
          <option key={c.id} value={c.id}>{c.full_name}</option>
        ))}
      </select>
      <input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={t("dr.cashReceived")} className={inputCls} />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("dr.settleNote")} className={inputCls} />
      {err && <p className="text-sm text-destructive">{err}</p>}
      <button onClick={() => void send()} disabled={busy} className="rounded-lg bg-primary py-4 text-base font-bold text-primary-foreground disabled:opacity-50">
        {t("dr.handedToCashier")}
      </button>
    </div>
  );
}

type Row = { id: string; amount: number; note: string | null; from_name: string | null; trip_no: string | null };

/** Cashier: cash handed to me, waiting for my confirmation. Renders nothing when empty. */
export function CashToConfirm() {
  const { t } = useLang();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await supabase.rpc("my_cash_to_confirm" as never);
    setRows((r.data ?? []) as unknown as Row[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const confirm = async (id: string) => {
    setBusy(id);
    setErr(null);
    const res = await queueRpc("confirm_cash_handover", { p_id: id });
    setBusy(null);
    if (res.error && !res.queued) return setErr(friendlyError(res.error, t));
    await load();
  };
  if (rows.length === 0 && !err) return null;
  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-card" data-testid="cash-to-confirm">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground">
        <Banknote className="h-4 w-4" aria-hidden /> {t("cash.toConfirm")}
      </p>
      {err && <p className="mb-2 text-sm text-destructive">{err}</p>}
      <div className="grid gap-2">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary p-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-lg font-bold text-foreground">₹{Number(r.amount)}</p>
              <p className="break-words text-xs text-muted-foreground">
                {[r.from_name, r.trip_no, r.note].filter(Boolean).join(" · ")}
              </p>
            </div>
            <button onClick={() => void confirm(r.id)} disabled={busy === r.id} className="rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50">
              {t("cash.confirm")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
