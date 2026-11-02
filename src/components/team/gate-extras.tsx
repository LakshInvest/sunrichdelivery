import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { istDayEnd, istDayStart, istDisplay, istToday } from "@/lib/ist";
import { haptic } from "@/lib/native";
import { useTeamAuth } from "@/lib/team-auth";
import { DockButton, ErrorCard, PhotoInput, Spinner } from "@/components/team/ui";
import { Field, inputCls } from "@/components/team/gate-entry";

const PROBLEMS = ["vehicle", "person", "material", "safety", "other"] as const;

export function ProblemPanel({ onDone }: { onDone: () => void }) {
  const { t } = useLang();
  const { staff } = useTeamAuth();
  const [type, setType] = useState<(typeof PROBLEMS)[number]>("vehicle");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    if (!note.trim()) return setError(t("sec.problemNote"));
    setBusy(true);
    const r = await supabase.rpc("gate_report_problem", { p_type: type, p_note: note, p_photo: photo ?? "" });
    setBusy(false);
    if (r.error) return setError(r.error.message);
    void haptic("success");
    onDone();
  };

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {PROBLEMS.map((x) => (
          <button
            key={x}
            type="button"
            role="radio"
            aria-checked={type === x}
            onClick={() => setType(x)}
            className={`rounded-full border px-3 py-2 text-sm font-bold ${type === x ? "border-destructive bg-destructive text-destructive-foreground" : "border-input bg-card text-foreground"}`}
          >
            {t(`sec.prob.${x}`)}
          </button>
        ))}
      </div>
      <Field label={t("sec.problemNote")}>
        <textarea aria-label={t("sec.problemNote")} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
      </Field>
      {staff && <PhotoInput userId={staff.id} kind="gate-problem" label={t("sec.photo")} value={photo} onChange={setPhoto} />}
      {error && <ErrorCard message={error} />}
      <DockButton onClick={() => void send()} disabled={busy}>
        {busy ? t("c.loading") : t("sec.sendProblem")}
      </DockButton>
    </div>
  );
}

type RegRow = { at: string; kind: string; title: string; detail: string | null; by_name: string | null };
const KINDS = ["", "entry", "vehicle", "material", "problem", "guard"] as const;

export function RegisterPanel() {
  const { t } = useLang();
  const [day, setDay] = useState(istToday());
  const [kind, setKind] = useState<(typeof KINDS)[number]>("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RegRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const r = await supabase.rpc("gate_register", { p_from: istDayStart(day), p_to: istDayEnd(day), p_kind: kind });
    if (r.error) setError(r.error.message);
    setRows((r.data ?? []) as RegRow[]);
  }, [day, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = (rows ?? []).filter((r) => !q.trim() || `${r.title} ${r.detail ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <input type="date" aria-label={t("sec.date")} value={day} onChange={(e) => setDay(e.target.value)} className={inputCls} />
        <select aria-label={t("sec.filter")} value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])} className={inputCls}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`sec.reg.${k || "all"}`)}
            </option>
          ))}
        </select>
      </div>
      <input aria-label={t("sec.search")} placeholder={t("sec.search")} value={q} onChange={(e) => setQ(e.target.value)} className={inputCls} />
      {error && <ErrorCard message={error} />}
      {rows === null && <Spinner label={t("c.loading")} />}
      {rows && shown.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t("c.none")}</p>}
      {shown.map((r, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-3 text-sm shadow-card" data-testid="reg-row">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-display font-bold text-foreground">{r.title}</span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">{t(`sec.kind.${r.kind}`)}</span>
          </div>
          {r.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">{r.detail}</p>}
          <p className="text-xs text-muted-foreground">
            {istDisplay(r.at)}
            {r.by_name ? ` · ${r.by_name}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ChangeGuardPanel() {
  const { t } = useLang();
  const { staff, signOut } = useTeamAuth();
  const [mobile, setMobile] = useState("");
  const [pin, setPin] = useState("");
  const [selfie, setSelfie] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    if (mobile.length !== 10 || pin.length !== 4) return setError(t("sec.guardFill"));
    if (!selfie) return setError(t("sec.err.selfie_required"));
    setBusy(true);
    const r = await supabase.rpc("gate_change_guard", { p_mobile: mobile, p_pin: pin, p_selfie: selfie });
    setBusy(false);
    if (r.error) {
      const m = r.error.message;
      const k = ["wrong_pin", "guard_not_found", "not_a_guard", "same_guard", "selfie_required"].find((x) => m.includes(x));
      return setError(k ? t(`sec.err.${k}`) : m);
    }
    void haptic("success");
    setDone((r.data as { name?: string } | null)?.name ?? "");
  };

  if (done !== null)
    return (
      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
        <p className="font-display text-lg font-bold text-foreground">{t("sec.guardDone", { name: done })}</p>
        <p className="text-sm text-muted-foreground">{t("sec.guardSignIn")}</p>
        <DockButton onClick={() => void signOut()}>{t("sec.signOutNow")}</DockButton>
      </div>
    );

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-card">
      <p className="text-sm text-muted-foreground">{t("sec.guardSub")}</p>
      <Field label={t("sec.newGuardMobile")}>
        <div className="flex gap-2">
          <span className="grid place-items-center rounded-md border border-input bg-muted px-3 text-base font-semibold text-foreground">+91</span>
          <input
            inputMode="numeric"
            aria-label={t("sec.newGuardMobile")}
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
            className={`${inputCls} min-w-0 flex-1`}
          />
        </div>
      </Field>
      <Field label={t("sec.newGuardPin")}>
        <input
          type="password"
          inputMode="numeric"
          aria-label={t("sec.newGuardPin")}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          className={`${inputCls} text-center tracking-[0.5em]`}
        />
      </Field>
      {staff && <PhotoInput userId={staff.id} kind="guard-selfie" required label={t("sec.selfie")} value={selfie} onChange={setSelfie} />}
      {error && <ErrorCard message={error} />}
      <DockButton onClick={() => void go()} disabled={busy}>
        {busy ? t("c.loading") : t("sec.changeGuard")}
      </DockButton>
    </div>
  );
}
