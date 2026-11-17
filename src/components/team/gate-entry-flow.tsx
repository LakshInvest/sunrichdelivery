import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Package, Phone, Search, Truck, UserRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { openExternal } from "@/lib/native";
import { TaskScreen, MainAction, BackIcon, taskInput } from "@/components/team/task-screen";
import { PhotoImg, PhotoInput, Spinner } from "@/components/team/ui";
import { EmptyState } from "@/components/team/role-home";

/** Guard Entry: Kaun aaya → details → Kisse milna hai → Approval → Andar. Uses Command Center gate_* functions only. */
type Kind = "person" | "vehicle" | "parcel";
type Check = { blocked: boolean; block?: { reason?: string } | null; staff: boolean; staff_details?: { id: string; name: string } | null; pre_invited: boolean; invite?: { id: string; name?: string; host_id?: string; purpose?: string } | null; known?: { name?: string; from_place?: string; photo_path?: string } | null };
type Staff = { id: string; full_name: string; mobile: string | null; photo_url: string | null; role_code: string | null };
type Req = { id: string; status: string; reason?: string | null; by_name?: string | null; approval_mode?: string | null; host_id?: string | null };
export type GateDraft = { kind: Kind; mobile: string; name: string; from_place: string; photo_path: string; meet_user_id: string; purpose: string; vehicle_type: string; vehicle_no: string; supplier: string; challan_photo_path: string; courier_name: string; parcel_count: number; check: Check | null; request_id: string };
export const blankGate: GateDraft = { kind: "person", mobile: "", name: "", from_place: "", photo_path: "", meet_user_id: "", purpose: "", vehicle_type: "supplier", vehicle_no: "", supplier: "", challan_photo_path: "", courier_name: "", parcel_count: 1, check: null, request_id: "" };

const rpc = (name: string, args?: Record<string, unknown>) => supabase.rpc(name as never, args as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const W: Record<string, [string, string, string]> = {
  who: ["Who came?", "कौन आया?", "कोण आले?"], person: ["Person", "व्यक्ति", "व्यक्ती"], vehicle: ["Vehicle", "गाड़ी", "गाडी"], parcel: ["Parcel", "पार्सल", "पार्सल"],
  ownTrip: ["Own Sunrich trip vehicles: use SCAN", "अपनी Sunrich ट्रिप गाड़ी: SCAN करें", "आपली Sunrich ट्रिप गाडी: SCAN करा"],
  mobile: ["Mobile number", "मोबाइल नंबर", "मोबाइल नंबर"], checking: ["Checking…", "जाँच हो रही है…", "तपासत आहे…"],
  staffTag: ["STAFF", "स्टाफ", "स्टाफ"], in: ["In", "अंदर", "आत"], name: ["Name", "नाम", "नाव"], from: ["Coming from", "कहाँ से", "कुठून"],
  photo: ["Photo", "फोटो", "फोटो"], meet: ["Whom to meet?", "किससे मिलना है?", "कोणाला भेटायचे?"], forWhom: ["For whom?", "किसके लिए?", "कोणासाठी?"],
  search: ["Search", "खोजें", "शोधा"], purpose: ["Purpose", "काम", "काम"], next: ["Continue", "आगे", "पुढे"], askApproval: ["Ask for approval", "अनुमति माँगें", "परवानगी मागा"],
  blocked: ["Not allowed in", "अंदर नहीं", "आत नाही"], back: ["Back to gate", "गेट पर वापस", "गेटवर परत"],
  invited: ["Invited earlier ✅", "पहले से बुलाया ✅", "आधीच बोलावले ✅"], asking: ["Asking {n}…", "{n} से पूछ रहे हैं…", "{n} यांना विचारत आहोत…"],
  call: ["📞 Call", "📞 कॉल", "📞 कॉल"], phoneYes: ["Said yes on phone", "फ़ोन पे हाँ बोला", "फोनवर हो म्हणाले"], whoYes: ["Who said yes?", "किसने हाँ बोला?", "कोण हो म्हणाले?"],
  note: ["Note (required)", "नोट (ज़रूरी)", "नोट (आवश्यक)"], save: ["Save", "सेव करें", "सेव करा"], approvedBy: ["Approved by {n}", "{n} ने मंज़ूरी दी", "{n} यांनी मंजुरी दिली"],
  rejected: ["Rejected", "मना कर दिया", "नाकारले"], sendBack: ["Send back", "वापस भेजो", "परत पाठवा"], waitLeft: ["Waiting · {n}", "इंतज़ार · {n}", "वाट · {n}"],
  vType: ["Type", "प्रकार", "प्रकार"], supplier: ["Supplier", "सप्लायर", "पुरवठादार"], transporter: ["Transporter", "ट्रांसपोर्टर", "ट्रान्सपोर्टर"], other: ["Other", "अन्य", "इतर"],
  vehicleNo: ["Vehicle number", "गाड़ी नंबर", "गाडी नंबर"], driverMobile: ["Driver mobile", "ड्राइवर मोबाइल", "ड्रायव्हर मोबाइल"], driverName: ["Driver name", "ड्राइवर का नाम", "ड्रायव्हरचे नाव"],
  driverPhoto: ["Driver photo", "ड्राइवर फोटो", "ड्रायव्हर फोटो"], supplierName: ["Supplier name", "सप्लायर का नाम", "पुरवठादाराचे नाव"], challan: ["Challan photo", "चालान फोटो", "चलन फोटो"],
  courier: ["Courier", "कूरियर", "कुरिअर"], parcelPhoto: ["Parcel photo", "पार्सल फोटो", "पार्सल फोटो"], kept: ["Kept it", "रख लिया", "ठेवले"], count: ["Parcels", "पार्सल गिनती", "पार्सल संख्या"],
  p_meeting: ["Meeting", "मीटिंग", "मीटिंग"], p_delivery: ["Deliver goods", "माल देना", "माल देणे"], p_interview: ["Interview", "इंटरव्यू", "मुलाखत"], p_service: ["Service", "सर्विस", "सर्व्हिस"], p_other: ["Other", "अन्य", "इतर"],
  needName: ["Enter the name", "नाम लिखें", "नाव लिहा"], needPhoto: ["Take the photo", "फोटो लें", "फोटो घ्या"], needHost: ["Pick a person", "व्यक्ति चुनें", "व्यक्ती निवडा"], needVehicle: ["Enter vehicle number like MH24AB1234", "गाड़ी नंबर MH24AB1234 जैसा लिखें", "गाडी नंबर MH24AB1234 असा लिहा"],
  needChallan: ["Take the challan photo", "चालान फोटो लें", "चलन फोटो घ्या"], already: ["Already inside", "पहले से अंदर है", "आधीच आत आहे"], err: ["Something went wrong. Try again.", "कुछ गड़बड़ हुई। दोबारा करें।", "काहीतरी चुकले. पुन्हा करा."],
};
const PURPOSES = ["p_meeting", "p_delivery", "p_interview", "p_service", "p_other"];
const chip = (on: boolean) => `inline-flex h-12 items-center rounded-full whitespace-nowrap px-5 text-base font-semibold ${on ? "bg-primary text-primary-foreground" : "bg-card text-primary shadow-card"}`;

export function GateEntry({ step, draft, update, photoRule, refresh }: { step: string; draft: GateDraft; update: (d: Partial<GateDraft>) => void; photoRule: string; refresh: () => Promise<void> }) {
  const { lang, t } = useLang();
  const i = lang === "hi" ? 1 : lang === "mr" ? 2 : 0;
  const w = (k: string, n?: string) => (W[k]?.[i] ?? k).replace("{n}", n ?? "");
  const { staff } = useTeamAuth();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dir, setDir] = useState<Staff[]>([]);
  const [q, setQ] = useState("");
  const [req, setReq] = useState<Req | null>(null);
  const [recips, setRecips] = useState<{ id: string; full_name: string; mobile: string | null; is_host: boolean }[]>([]);
  const [waitMin, setWaitMin] = useState(3);
  const [now, setNow] = useState(Date.now());
  const started = useRef(Date.now());
  const [phoneBy, setPhoneBy] = useState("");
  const [phoneNote, setPhoneNote] = useState("");
  const [couriers, setCouriers] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const go = (s: string) => navigate({ to: "/security/$step", params: { step: s } });
  const home = () => navigate({ to: "/security" });
  const finish = async () => { update(blankGate); await refresh(); void home(); };
  useEffect(() => setErr(null), [step]);
  const friendly = (m: string) => /already_inside/.test(m) ? w("already") : /photo_required/.test(m) ? w("needPhoto") : /addressee_required|bad_host/.test(m) ? w("needHost") : w("err");

  useEffect(() => {
    if (!["e-host", "e-wait"].includes(step) || dir.length) return;
    void rpc("gate_staff_directory").then((r) => setDir((r.data as Staff[] | null) ?? []));
  }, [step]);
  useEffect(() => {
    if (step !== "e-parcel" && step !== "e-vehicle") return;
    void supabase.from("gate_entries").select("courier_name,from_place,entry_type").in("entry_type", ["parcel", "supplier"]).order("in_at", { ascending: false }).limit(200).then(({ data }) => {
      const rows = (data ?? []) as { courier_name: string | null; from_place: string | null; entry_type: string }[];
      setCouriers([...new Set(rows.filter((r) => r.entry_type === "parcel" && r.courier_name).map((r) => r.courier_name!))].slice(0, 8));
      setSuppliers([...new Set(rows.filter((r) => r.entry_type === "supplier" && r.from_place).map((r) => r.from_place!))]);
    });
  }, [step]);

  /** gate_check right after mobile / vehicle number. Blocked always wins. */
  const check = async (mobile: string, vehicle?: string) => {
    setChecking(true); setErr(null);
    const r = await rpc("gate_check", { p_mobile: mobile ? `+91${mobile}` : null, p_vehicle_no: vehicle || null });
    setChecking(false);
    if (r.error) { setErr(w("err")); return null; }
    const c = r.data as Check; update({ check: c });
    if (c.blocked) { void go("e-blocked"); return null; }
    if (c.known) update({ name: draft.name || c.known.name || "", from_place: draft.from_place || c.known.from_place || "", photo_path: draft.photo_path || c.known.photo_path || "" });
    return c;
  };
  const onMobile = async (v: string) => {
    const mobile = v.replace(/\D/g, "").slice(0, 10); update({ mobile, check: null });
    if (mobile.length !== 10) return;
    const c = await check(mobile, draft.kind === "vehicle" ? draft.vehicle_no : undefined);
    if (!c) return;
    if (c.pre_invited && draft.kind === "person") void go("e-invite");
  };
  const staffIn = async () => {
    setBusy(true); const r = await rpc("gate_entry_in", { p: { mobile: draft.mobile, entry_type: "visitor" } }); setBusy(false);
    if (r.error) return setErr(friendly(r.error.message)); await finish();
  };
  const admitInvite = async () => {
    if (!draft.check?.invite) return; setBusy(true);
    const r = await rpc("gate_admit_pre_invite", { p_invite_id: draft.check.invite.id, p_details: { name: draft.name || draft.check.invite.name, mobile: `+91${draft.mobile}`, photo_path: draft.photo_path || null } }); setBusy(false);
    if (r.error) return setErr(friendly(r.error.message)); await finish();
  };
  const details = () => {
    const et = draft.kind === "parcel" ? "parcel" : draft.kind === "vehicle" ? draft.vehicle_type : "visitor";
    return { name: draft.name.trim() || (draft.kind === "parcel" ? draft.courier_name : ""), mobile: draft.mobile ? `+91${draft.mobile}` : null, vehicle_no: draft.kind === "vehicle" ? draft.vehicle_no : null, entry_type: et, from_place: draft.kind === "vehicle" && et === "supplier" ? draft.supplier : draft.from_place || null, purpose: draft.purpose ? w(draft.purpose) : null, photo_path: draft.photo_path || null, meet_user_id: draft.kind !== "parcel" ? draft.meet_user_id || null : null, addressee_id: draft.kind === "parcel" ? draft.meet_user_id || null : null, people_count: 1, parcel_count: draft.kind === "parcel" ? draft.parcel_count : null, courier_name: draft.kind === "parcel" ? draft.courier_name || null : null, challan_photo_path: draft.challan_photo_path || null };
  };
  /** The Approval step: every non-staff, non-invited entry asks first. */
  const askApproval = async () => {
    setBusy(true); setErr(null);
    const r = await rpc("gate_request_approval", { p_details: details(), p_host_id: draft.meet_user_id || null }); setBusy(false);
    if (r.error) { if (/blocked/.test(r.error.message)) { void go("e-blocked"); return; } return setErr(friendly(r.error.message)); }
    update({ request_id: String(r.data) }); started.current = Date.now(); setReq(null); void go("e-wait");
  };

  // Waiting page: realtime on the request row + 10 s status fallback.
  const loadStatus = async () => {
    if (!draft.request_id) return;
    const r = await rpc("gate_request_status", { p_request_id: draft.request_id });
    if (!r.error && r.data) setReq(r.data as Req);
  };
  useEffect(() => {
    if (step !== "e-wait" || !draft.request_id) return;
    void loadStatus();
    void rpc("gate_request_recipients", { p_request_id: draft.request_id }).then((r) => setRecips((r.data as typeof recips | null) ?? []));
    void supabase.from("delivery_settings").select("gate_approval_wait_minutes" as never).limit(1).maybeSingle().then(({ data }) => { const m = Number((data as { gate_approval_wait_minutes?: number } | null)?.gate_approval_wait_minutes); if (m > 0) setWaitMin(m); });
    const ch = supabase.channel(`gate-req-${draft.request_id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "gate_approval_requests", filter: `id=eq.${draft.request_id}` }, () => void loadStatus()).subscribe();
    const poll = window.setInterval(() => void loadStatus(), 10000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { supabase.removeChannel(ch); window.clearInterval(poll); window.clearInterval(tick); };
  }, [step, draft.request_id]);
  const admit = async () => {
    setBusy(true); const r = await rpc("gate_admit_request", { p_request_id: draft.request_id }); setBusy(false);
    if (r.error) return setErr(friendly(r.error.message)); await finish();
  };
  const phoneApprove = async () => {
    if (!phoneBy || !phoneNote.trim()) return setErr(w("note"));
    setBusy(true); const r = await rpc("gate_mark_phone_approved", { p_request_id: draft.request_id, p_approved_by_user_id: phoneBy, p_note: phoneNote.trim() }); setBusy(false);
    if (r.error) return setErr(w("err")); setReq(r.data as Req); void go("e-wait");
  };

  const shell = (title: string, body: ReactNode, action?: ReactNode, backTo = "/security") => <TaskScreen title={title} back={<Link to={backTo}><BackIcon /></Link>} error={err} action={action}>{body}</TaskScreen>;
  const main = (label: string, fn: () => void, disabled = false) => <MainAction onClick={fn} disabled={busy || checking || disabled}>{busy || checking ? t("c.loading") : label}</MainAction>;
  const mobileField = (label: string) => <label className="grid gap-2 text-lg font-semibold">{label}<div className="flex items-center gap-2"><span className="text-xl font-bold text-muted-foreground">+91</span><input aria-label={label} inputMode="numeric" autoComplete="tel" className={taskInput} value={draft.mobile} onChange={(e) => void onMobile(e.target.value)} /></div>{checking && <span className="text-sm text-muted-foreground">{w("checking")}</span>}</label>;
  const field = (label: string, value: string, set: (v: string) => void, extra: Record<string, string> = {}) => <label className="grid gap-2 text-lg font-semibold">{label}<input aria-label={label} className={taskInput} value={value} onChange={(e) => set(e.target.value)} {...extra} /></label>;
  const host = dir.find((s) => s.id === (draft.meet_user_id || req?.host_id));

  if (step === "entry") return shell(w("who"), <div className="grid gap-3">
    {([["person", UserRound], ["vehicle", Truck], ["parcel", Package]] as const).map(([k, Icon]) => <button key={k} type="button" data-testid={`entry-${k}`} onClick={() => { update({ ...blankGate, kind: k }); void go(k === "person" ? "e-person" : k === "vehicle" ? "e-vehicle" : "e-parcel"); }} className="home-card flex min-h-24 items-center gap-4 p-5 text-left text-2xl font-bold text-primary active:scale-[0.99]"><span className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary/15"><Icon className="h-8 w-8 text-secondary" aria-hidden /></span>{w(k)}</button>)}
    <p className="text-base text-muted-foreground">{w("ownTrip")}</p></div>);

  if (step === "e-blocked") return <main className="task-screen bg-destructive text-destructive-foreground"><div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center" role="alert"><p className="text-5xl">⛔</p><p className="text-3xl font-bold">{w("blocked")}</p><p className="text-xl">{draft.check?.block?.reason ?? ""}</p></div><div className="p-4"><MainAction onClick={() => { update(blankGate); void home(); }}>{w("back")}</MainAction></div></main>;

  if (step === "e-invite") return shell(w("invited"), <div className="home-card grid gap-2 border-2 border-success p-5"><p className="text-2xl font-bold text-success">{w("invited")}</p><p className="text-xl font-semibold">{draft.check?.invite?.name ?? draft.name}</p>{draft.check?.invite?.purpose && <p className="text-lg">{draft.check.invite.purpose}</p>}{draft.check?.invite?.host_id && <p className="text-lg">{dir.find((s) => s.id === draft.check?.invite?.host_id)?.full_name}</p>}</div>, main(w("in"), () => void admitInvite()));

  if (step === "e-person") {
    const c = draft.check;
    if (c?.staff) return shell(w("person"), <>{mobileField(w("mobile"))}<div className="home-card flex items-center gap-4 p-5"><span className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/15 text-2xl font-bold text-primary">{c.staff_details?.name?.charAt(0)}</span><div><p className="text-2xl font-bold">{c.staff_details?.name}</p><span className="chip bg-primary text-primary-foreground">{w("staffTag")}</span></div></div></>, main(w("in"), () => void staffIn()));
    const ready = draft.mobile.length === 10 && !!c;
    return shell(w("person"), <>{mobileField(w("mobile"))}{ready && <>{field(w("name"), draft.name, (name) => update({ name }))}{field(w("from"), draft.from_place, (from_place) => update({ from_place }))}{photoRule !== "off" && <PhotoInput userId={staff?.id ?? ""} kind="gate-visitor" required={photoRule === "required"} label={w("photo")} value={draft.photo_path || null} onChange={(p) => update({ photo_path: p ?? "" })} />}</>}</>,
      main(w("next"), () => { if (!draft.name.trim()) return setErr(w("needName")); if (photoRule === "required" && !draft.photo_path) return setErr(w("needPhoto")); void go("e-host"); }, !ready));
  }

  if (step === "e-vehicle") {
    const plate = /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(draft.vehicle_no);
    return shell(w("vehicle"), <>
      <div><p className="mb-2 text-lg font-semibold">{w("vType")}</p><div className="flex flex-wrap gap-2">{["supplier", "transporter", "other"].map((v) => <button key={v} type="button" className={chip(draft.vehicle_type === v)} aria-pressed={draft.vehicle_type === v} onClick={() => update({ vehicle_type: v })}>{w(v)}</button>)}</div></div>
      {field(w("vehicleNo"), draft.vehicle_no, (v) => update({ vehicle_no: v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) }), { placeholder: "MH24AB1234", autoCapitalize: "characters" })}
      {plate && mobileField(w("driverMobile"))}
      {plate && draft.mobile.length === 10 && draft.check && <>{field(w("driverName"), draft.name, (name) => update({ name }))}{!draft.check.known?.photo_path && <PhotoInput userId={staff?.id ?? ""} kind="gate-driver" label={w("driverPhoto")} value={draft.photo_path || null} onChange={(p) => update({ photo_path: p ?? "" })} />}
        {draft.vehicle_type === "supplier" && <>{field(w("supplierName"), draft.supplier, (supplier) => update({ supplier }), { list: "gate-suppliers" })}<datalist id="gate-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist><PhotoInput userId={staff?.id ?? ""} kind="gate-challan" required label={w("challan")} value={draft.challan_photo_path || null} onChange={(p) => update({ challan_photo_path: p ?? "" })} /></>}</>}
    </>, main(w("askApproval"), () => { if (!plate) return setErr(w("needVehicle")); if (!draft.name.trim()) return setErr(w("needName")); if (draft.vehicle_type === "supplier" && !draft.challan_photo_path) return setErr(w("needChallan")); void askApproval(); }, !(plate && draft.mobile.length === 10 && draft.check)));
  }

  if (step === "e-parcel") return shell(w("parcel"), <>
    <div><p className="mb-2 text-lg font-semibold">{w("courier")}</p>{couriers.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{couriers.map((c) => <button key={c} type="button" className={chip(draft.courier_name === c)} onClick={() => update({ courier_name: c })}>{c}</button>)}</div>}<input aria-label={w("courier")} className={taskInput} value={draft.courier_name} onChange={(e) => update({ courier_name: e.target.value })} /></div>
    <label className="grid gap-2 text-lg font-semibold">{w("count")}<input aria-label={w("count")} inputMode="numeric" className={taskInput} value={draft.parcel_count} onChange={(e) => update({ parcel_count: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) })} /></label>
    <PhotoInput userId={staff?.id ?? ""} kind="gate-parcel" label={w("parcelPhoto")} value={draft.photo_path || null} onChange={(p) => update({ photo_path: p ?? "" })} />
  </>, main(w("next"), () => { if (!draft.courier_name.trim()) return setErr(w("needName")); void go("e-host"); }));

  if (step === "e-host") {
    const list = dir.filter((s) => `${s.full_name} ${s.mobile ?? ""} ${s.role_code ?? ""}`.toLowerCase().includes(q.toLowerCase()));
    const back = draft.kind === "parcel" ? "/security/e-parcel" : "/security/e-person";
    return shell(draft.kind === "parcel" ? w("forWhom") : w("meet"), <>
      <label className="relative"><Search className="absolute left-3 top-4 h-5 w-5 text-muted-foreground" aria-hidden /><input aria-label={w("search")} placeholder={w("search")} className={`${taskInput} pl-10`} value={q} onChange={(e) => setQ(e.target.value)} /></label>
      {!dir.length ? <Spinner /> : !list.length ? <EmptyState icon={UserRound} text={t("c.none")} /> : <div className="grid gap-2">{list.map((s) => <button key={s.id} type="button" aria-pressed={draft.meet_user_id === s.id} onClick={() => update({ meet_user_id: s.id })} className={`home-card flex min-h-16 items-center gap-3 p-3 text-left ${draft.meet_user_id === s.id ? "ring-2 ring-primary" : ""}`}>{s.photo_url ? <PhotoImg path={s.photo_url} className="h-12 w-12 rounded-full object-cover" /> : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-lg font-bold text-primary">{s.full_name.charAt(0)}</span>}<span className="min-w-0 flex-1"><span className="block truncate text-lg font-semibold">{s.full_name}</span>{s.role_code && <span className="block text-sm text-muted-foreground">{t(`role.${s.role_code}`) === `role.${s.role_code}` ? s.role_code.charAt(0) + s.role_code.slice(1).toLowerCase() : t(`role.${s.role_code}`)}</span>}</span></button>)}</div>}
    </>, main(draft.kind === "parcel" ? w("askApproval") : w("next"), () => { if (!draft.meet_user_id) return setErr(w("needHost")); if (draft.kind === "parcel") void askApproval(); else void go("e-purpose"); }, !draft.meet_user_id), back);
  }

  if (step === "e-purpose") return shell(w("purpose"), <div className="flex flex-wrap gap-2">{PURPOSES.map((p) => <button key={p} type="button" className={chip(draft.purpose === p)} aria-pressed={draft.purpose === p} onClick={() => update({ purpose: p })}>{w(p)}</button>)}</div>, main(w("askApproval"), () => void askApproval(), !draft.purpose), "/security/e-host");

  if (step === "e-wait") {
    const status = req?.status ?? "pending";
    const left = Math.max(0, waitMin * 60 - Math.floor((now - started.current) / 1000));
    const hostName = host?.full_name ?? recips.find((r) => r.is_host)?.full_name ?? recips[0]?.full_name ?? "";
    const hostMobile = recips.find((r) => r.is_host)?.mobile ?? recips[0]?.mobile;
    const card = <div className="home-card flex items-center gap-4 p-4">{draft.photo_path ? <PhotoImg path={draft.photo_path} className="h-16 w-16 rounded-2xl object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/15 text-2xl font-bold text-primary">{(draft.name || draft.courier_name).charAt(0)}</span>}<div className="min-w-0"><p className="truncate text-xl font-bold">{draft.name || draft.courier_name}</p><p className="truncate text-base text-muted-foreground">{draft.vehicle_no || (draft.mobile ? `+91 ${draft.mobile}` : "")}</p></div></div>;
    if (status === "approved") return shell(w("in"), <>{card}<div className="home-card border-2 border-success p-5 text-center" role="status"><p className="text-4xl">✅</p><p className="text-2xl font-bold text-success">{w("approvedBy", req?.by_name ?? "")}</p></div></>, main(draft.kind === "parcel" ? w("kept") : w("in"), () => void admit()));
    if (status === "rejected") return shell(w("rejected"), <>{card}<div className="home-card border-2 border-destructive p-5 text-center" role="alert"><p className="text-4xl">❌</p><p className="text-2xl font-bold text-destructive">{w("rejected")}</p>{req?.reason && <p className="mt-2 text-lg">{req.reason}</p>}</div></>, main(w("sendBack"), () => void finish()));
    return shell(w("askApproval"), <>{card}
      <div className="home-card grid gap-2 p-5 text-center" role="status"><Spinner /><p className="text-xl font-bold">{w("asking", hostName)}</p><p className="text-lg text-muted-foreground">{w("waitLeft", `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`)}</p></div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={!hostMobile} onClick={() => hostMobile && void openExternal(`tel:${hostMobile}`)} className="home-card flex min-h-14 items-center justify-center gap-2 text-lg font-semibold text-primary disabled:opacity-50"><Phone className="h-5 w-5" aria-hidden />{w("call")}</button>
        <Link to="/security/$step" params={{ step: "e-phone" }} className="home-card flex min-h-14 items-center justify-center text-center text-lg font-semibold text-primary">{w("phoneYes")}</Link>
      </div></>);
  }

  if (step === "e-phone") return shell(w("phoneYes"), <>
    <p className="text-lg font-semibold">{w("whoYes")}</p>
    {!recips.length ? <EmptyState icon={UserRound} text={t("c.none")} /> : <div className="grid gap-2">{recips.map((r) => <button key={r.id} type="button" aria-pressed={phoneBy === r.id} onClick={() => setPhoneBy(r.id)} className={`home-card min-h-14 p-3 text-left text-lg font-semibold ${phoneBy === r.id ? "ring-2 ring-primary" : ""}`}>{r.full_name}</button>)}</div>}
    <label className="grid gap-2 text-lg font-semibold">{w("note")}<textarea aria-label={w("note")} className={`${taskInput} min-h-24`} value={phoneNote} onChange={(e) => setPhoneNote(e.target.value)} /></label>
  </>, main(w("save"), () => void phoneApprove(), !phoneBy || !phoneNote.trim()), "/security/e-wait");

  return shell(w("who"), <p>{t("c.none")}</p>);
}
