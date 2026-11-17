import { createContext, useContext, useState, useRef, useEffect, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import QRCode from "react-qr-code";
import { MoreHorizontal, MapPin, Phone, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTeamAuth } from "@/lib/team-auth";
import { useLang } from "@/lib/l10n";
import { queueRpc } from "@/lib/offline";
import { taskCopy, type TaskLabel } from "@/lib/task-copy";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { driverHomeAction, optionalDriverTasks, needsPayment, STOP_DONE_MS } from "@/lib/task-policy";
import { DEFAULT_SETTINGS, getCoords, keptValue, signatureToPath, SignaturePad, type Settings, type StopRow, type LineRow } from "@/components/team/driver-parts";
import { buildUpiUri } from "@/components/team/upi-qr";
import { PhotoInput, Spinner, StatusBadge, Stepper } from "@/components/team/ui";
import { Button } from "@/components/ui/button";
import { TaskScreen, BackIcon, MainAction, taskInput } from "@/components/team/task-screen";
import { openExternal, maxBrightness, startTripMode } from "@/lib/native";

type Trip = { id: string; trip_no: string; status: string; gate_out_at: string | null; driver_started_at: string | null; ended_at: string | null; gate_in_at: string | null; unit_id: string; vehicles: { reg_no: string } | null };
type Goods = { order_line_id: string; delivered: number; short: number; damaged: number; refused: number; empties: number };
type Draft = { goods: Goods[]; otp: string; photo: string | null; signature: string | null; amount: string; reference: string; payPhoto: string | null; splitCash: string; alertId?: string; resolution?: string; collectionDone?: boolean };
const emptyDraft = (): Draft => ({ goods: [], otp: "", photo: null, signature: null, amount: "", reference: "", payPhoto: null, splitCash: "" });
type Workflow = { tripId: string; trip: Trip | null; stops: StopRow[]; lines: Record<string, LineRow[]>; settings: Settings; token: string | null; upi: { id: string; payee: string | null } | null; cash: number; cashiers: { id: string; full_name: string }[]; pendingCash: string | null; form: {odo:string;odoPhoto:string|null;selfie:string|null;checkPhoto:string|null;checks:string[];customer:string}; setForm:(patch:Partial<Workflow["form"]>)=>void; products: { id: string; name: string; left: number; returnable: boolean }[]; loading: boolean; error: string | null; busy: boolean; drafts: Record<string, Draft>; update: (id: string, value: Partial<Draft>) => void; load: () => Promise<void>; write: (rpc: string, args: Record<string, unknown>) => Promise<{ ok: boolean; data: unknown; queued: boolean }>; };
const Context = createContext<Workflow | null>(null);
function useWorkflow() { const v = useContext(Context); if (!v) throw new Error("Trip context unavailable"); return v; }
export function DriverWorkflowProvider({ tripId, children }: { tripId: string; children: ReactNode }) {
  const { t, lang } = useLang();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [stops, setStops] = useState<StopRow[]>([]);
  const [lines, setLines] = useState<Record<string, LineRow[]>>({});
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [token, setToken] = useState<string | null>(null);
  const [upi, setUpi] = useState<Workflow["upi"]>(null);
  const [cash, setCash] = useState(0);
  const [cashiers, setCashiers] = useState<Workflow["cashiers"]>([]);
  const [pendingCash, setPendingCash] = useState<string | null>(null);
  const [products, setProducts] = useState<Workflow["products"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form,setFormState]=useState<Workflow["form"]>({odo:"",odoPhoto:null,selfie:null,checkPhoto:null,checks:[],customer:""});
  const setForm=(patch:Partial<Workflow["form"]>)=>setFormState(v=>({...v,...patch}));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  
  const load = async () => {
    const [tr, st, se, gp, cc, ex, ca, ch, pr, extra, spots] = await Promise.all([
      supabase.from("trips").select("id,trip_no,status,gate_out_at,driver_started_at,ended_at,gate_in_at,unit_id,vehicles(reg_no)").eq("id",tripId).single(),
      supabase.from("trip_stops").select("id,seq,status,fail_reason,arrived_at,do_later_at,orders(id,customer_id,order_no,business_name,customer_name,delivery_address_text,grand_total,amount_paid,payment_mode,payment_method,customer_mobile,delivery_latitude,delivery_longitude,firm_id)").eq("trip_id",tripId).order("seq"),
      supabase.rpc("my_delivery_settings"),
      supabase.from("gate_passes").select("qr_token").eq("trip_id",tripId).order("issued_at",{ascending:false}).limit(1).maybeSingle(),
      supabase.from("trip_collections").select("amount,mode,stop_id").eq("trip_id",tripId),
      supabase.from("trip_expenses").select("amount,approved").eq("trip_id",tripId).eq("paid_from_cash",true),
      supabase.rpc("cashier_list"),
      supabase.from("cash_handovers").select("to_user_id,confirmed_at").eq("trip_id",tripId).is("confirmed_at",null).limit(1).maybeSingle(),
      supabase.from("products").select("id,name,name_hi,name_mr,is_returnable").eq("is_active",true),
      supabase.from("trip_extra_load").select("product_id,qty").eq("trip_id",tripId),
      supabase.from("trip_stops").select("orders(order_lines(product_id,qty))").eq("trip_id",tripId).eq("is_spot_sale",true),
    ]);
    if (tr.error || st.error) { setError(t("c.error")); setLoading(false); return; }
    setTrip(tr.data as unknown as Trip);
    const list = ((st.data ?? []) as unknown as StopRow[]).map(s=>({...s,orders:s.orders?{...s.orders,amount_paid:Math.max(Number(s.orders.amount_paid ?? 0),(cc.data ?? []).filter(c=>c.stop_id===s.id).reduce((a,c)=>a+Number(c.amount),0))}:null}));
    const orderIds = list.flatMap(s => s.orders ? [s.orders.id] : []);
    const lr = orderIds.length ? await supabase.from("order_lines").select("id,order_id,product_id,product_name,pack_label,qty,line_total,deposit_total").in("order_id",orderIds) : { data: [] };
    const dl = list.length ? await supabase.from("delivery_lines").select("order_line_id,delivered_qty").in("stop_id",list.map(s=>s.id)) : { data: [] };
    const delivered = new Map((dl.data ?? []).map(d=>[d.order_line_id,Number(d.delivered_qty)]));
    const map: Record<string,LineRow[]> = {};
    for (const l of lr.data ?? []) {
      (map[l.order_id] ??= []).push({ id:l.id,product_name:l.product_name,pack_label:l.pack_label,qty:Number(l.qty),value:Number(l.line_total)+Number(l.deposit_total),...(delivered.has(l.id)?{kept:delivered.get(l.id) ?? 0}:{}) });
    }
    setTrip(tr.data as unknown as Trip); setStops(list); setLines(map);
    const approvals=await supabase.from("trip_alerts").select("id,stop_id,resolution").eq("trip_id",tripId).eq("alert_type","ask_office");
    setDrafts(current=>{const next={...current};for(const a of approvals.data ?? []){if(a.stop_id&&a.resolution)next[a.stop_id]={...(next[a.stop_id] ?? emptyDraft()),alertId:a.id,resolution:a.resolution};}return next;});
    setSettings({...DEFAULT_SETTINGS,...(se.data as unknown as Settings ?? {})});
    setToken(gp.data?.qr_token ?? null);
    setCash(Math.max(0,(cc.data ?? []).filter(x=>x.mode==="cash").reduce((a,x)=>a+Number(x.amount),0)-(ex.data ?? []).filter(x=>x.approved!==false).reduce((a,x)=>a+Number(x.amount),0)));
    const cashList = (ca.data ?? []) as {id:string;full_name:string}[];
    const pendingTo=ch.data?.to_user_id; setCashiers(cashList); setPendingCash(pendingTo ? cashList.find(x=>x.id===pendingTo)?.full_name ?? "—" : null);
    setProducts((pr.data ?? []).map(p=>({id:p.id,name:(lang==="hi" ? p.name_hi : lang==="mr" ? p.name_mr : p.name)||p.name,returnable:p.is_returnable,left:Math.max(0,Number(extra.data?.find(x=>x.product_id===p.id)?.qty ?? 0)-(spots.data ?? []).flatMap(s=>s.orders?.order_lines ?? []).filter(l=>l.product_id===p.id).reduce((a,l)=>a+Number(l.qty),0))})));
    const firm = list.find(s=>s.orders?.firm_id)?.orders?.firm_id;
    if (firm) { const f=await supabase.from("firms").select("upi_id,upi_payee_name").eq("id",firm).maybeSingle(); setUpi(f.data ? {id:f.data.upi_id ?? "",payee:f.data.upi_payee_name}:null); }
    setLoading(false);
  };
  useLiveRefresh(load,[{table:"trips",filter:`id=eq.${tripId}`},... ["trip_stops","gate_passes","trip_loading","trip_alerts","cash_handovers","trip_collections","trip_expenses"].map(table=>({table,filter:`trip_id=eq.${tripId}`})),{table:"orders"}],tripId,(table,row)=>{
    if(table==="trips"&&row['id']===tripId) setTrip(current=>current?{...current,...row}:current);
    if(table==="trip_stops"&&typeof row['id']==="string") setStops(current=>current.map(s=>s.id===row['id']?{...s,...row}:s));
  });
  useEffect(()=>{
    if (!trip?.driver_started_at || trip.ended_at || !settings.location_tracking_enabled) return;
    let closed=false; let cleanup: (()=>void)|null=null;
    const ping=async()=>{const c=await getCoords(); if(c) await queueRpc("log_location",{p_trip_id:tripId,p_latitude:c.latitude,p_longitude:c.longitude});};
    const timer=window.setInterval(()=>void ping(),30000); void ping();
    void startTripMode(30000,c=>{void queueRpc("log_location",{p_trip_id:tripId,p_latitude:c.latitude,p_longitude:c.longitude});}).then(stop=>{if(closed)stop?.();else cleanup=stop;});
    return()=>{closed=true;cleanup?.();window.clearInterval(timer);};
  },[trip?.driver_started_at,trip?.ended_at,settings.location_tracking_enabled,tripId]);
  const write: Workflow["write"] = async (rpc,args) => {
    setBusy(true);setError(null);
    try { const r=await queueRpc(rpc,args); if(r.error && !r.queued) {setError(/wrong.*otp/i.test(r.error)?taskCopy(lang,"wrongOtp"):t("c.error"));return {ok:false,data:null,queued:false};} await load();return {ok:true,data:r.data,queued:!!r.queued}; }
    catch { setError(t("c.error")); return {ok:false,data:null,queued:false}; } finally {setBusy(false);}
  };
  const update=(id:string,value:Partial<Draft>)=>setDrafts(all=>({...all,[id]:{...(all[id] ?? emptyDraft()),...value}}));
  return <Context.Provider value={{tripId,trip,stops,lines,settings,token,upi,cash,cashiers,pendingCash,form,setForm,products,loading,error,busy,drafts,update,load,write}}>{children}</Context.Provider>;
}

const titleKeys: Record<string,string> = {home:"dr.title",pass:"dr.gatePass",start:"dr.startTrip",next:"dr.nextStop",goods:"dr.allAsOrdered",counts:"dr.somethingDifferent",proof:"dr.deliveryOtp",photo:"dr.proofPhoto",signature:"dr.signature",payment:"dr.toCollect",cash:"dr.modeCash",upi:"dr.modeUpi",bank:"dr.reference",cheque:"dr.modeCheque",split:"dr.modeSplit",udhaar:"dr.udhaar",office:"dr.askOffice",done:"dr.stopDone",stops:"dr.allStopsLeft",end:"dr.endTrip",handover:"dr.handedToCashier",expense:"dr.expenses",pickup:"dr.pickup",spot:"dr.spotSale",customer:"dr.customer",sos:"dr.sos",failed:"dr.markFailed",selfie:"dr.selfie",check:"dr.vehicleCheck"};
export function DriverTaskPage({ step="home", stopId }: {step?:string;stopId?:string | undefined}) {
  const w=useWorkflow();const {tripId,trip,stops,lines,settings,token,upi,busy,error,write,update}=w;
  const {t,lang}=useLang();const copy=(key:TaskLabel)=>taskCopy(lang,key);const {staff}=useTeamAuth();const navigate=useNavigate();
  const pending=stops.filter(s=>s.status==="pending").sort((a,b)=>Number(!!a.do_later_at)-Number(!!b.do_later_at)||a.seq-b.seq);
  const unpaid=stops.filter(s=>["delivered","partial"].includes(s.status)&&needsPayment(s.orders?.payment_mode,Math.max(0,keptValue(lines[s.orders?.id ?? ""] ?? [],l=>l.kept ?? l.qty)-Number(s.orders?.amount_paid ?? 0)))&&!w.drafts[s.id]?.resolution);
  const actionable=[...pending,...unpaid];
  const stop=stops.find(s=>s.id===stopId) ?? (!stopId ? actionable[0]:undefined);
  const draft=stop ? w.drafts[stop.id] ?? emptyDraft():emptyDraft();
  const orderLines=lines[stop?.orders?.id ?? ""] ?? [];
  const goods=draft.goods.length ? draft.goods:orderLines.map(l=>({order_line_id:l.id,delivered:l.qty,short:0,damaged:0,refused:0,empties:0}));
  const due=Math.max(0,keptValue(orderLines,l=>stop?.status==="pending" ? goods.find(g=>g.order_line_id===l.id)?.delivered ?? l.qty:l.kept ?? l.qty)-Number(stop?.orders?.amount_paid ?? 0));
  const [localError,setLocalError]=useState<string|null>(null);
  const [menu,setMenu]=useState(false);
  const {odo,odoPhoto,selfie,checkPhoto,checks}=w.form;
  const setOdo=(odo:string)=>w.setForm({odo});const setOdoPhoto=(odoPhoto:string|null)=>w.setForm({odoPhoto});const setSelfie=(selfie:string|null)=>w.setForm({selfie});const setCheckPhoto=(checkPhoto:string|null)=>w.setForm({checkPhoto});const setChecks=(fn:(v:string[])=>string[])=>w.setForm({checks:fn(checks)});
  const [cashier,setCashier]=useState("");const [handoverAmt,setHandoverAmt]=useState("");
  const [reason,setReason]=useState("");const [note,setNote]=useState("");const [photo,setPhoto]=useState<string|null>(null);
  const [product,setProduct]=useState("");const [qty,setQty]=useState("");const customer=w.form.customer;const setCustomer=(customer:string)=>w.setForm({customer});const [paid,setPaid]=useState(true);const [expenseType,setExpenseType]=useState("");
  const [phone,setPhone]=useState<string|null>(null);const [udhaar,setUdhaar]=useState(false);const [remaining,setRemaining]=useState<number|null>(null);
  const [q,setQ]=useState("");const [found,setFound]=useState<{id:string;name:string}[]>([]);
  const go=(next:string,id=stop?.id)=>navigate({to:"/driver/$tripId/$step",params:{tripId,step:next},search:id ? {stopId:id}:{}});
  const home=()=>navigate({to:"/driver/$tripId",params:{tripId}});
  useEffect(()=>{setLocalError(null);setMenu(false);},[step,stopId]);
  useEffect(()=>{
    if(!stop) return;
    let active=true;
    void supabase.rpc("stop_contact_phone",{p_stop_id:stop.id}).then(r=>{if(active)setPhone(String(r.data ?? stop.orders?.customer_mobile ?? "")||null);});
    void supabase.rpc("stop_udhaar_check",{p_stop_id:stop.id}).then(r=>{const d=(Array.isArray(r.data)?r.data[0]:r.data) as {allowed?:boolean}|null;if(active)setUdhaar(!!d?.allowed);});
    return()=>{active=false;};
  },[stop?.id]);
  useEffect(()=>{
    if(step!=="done")return;
    const timer=window.setTimeout(()=>{const next=actionable.find(s=>s.id!==stopId);if(next)void go("next",next.id);else void home();},STOP_DONE_MS);
    return()=>window.clearTimeout(timer);
  },[step,pending.map(s=>s.id).join(","),stopId]);
  useEffect(()=>{
    if(step!=="pass")return;let disposed=false;let restore:(()=>void)|null=null;
    void maxBrightness().then(fn=>{if(disposed)fn?.();else restore=fn;});
    return()=>{disposed=true;restore?.();};
  },[step]);
  useEffect(()=>{if(step==="pass"&&trip?.gate_out_at&&!trip.driver_started_at)void home();},[step,trip?.gate_out_at,trip?.driver_started_at]);
  const officeLoad=async()=>{
    if(step!=="office"||!stop||draft.resolution)return;
    if(!draft.alertId){const existing=await supabase.from("trip_alerts").select("id,resolution").eq("trip_id",tripId).eq("stop_id",stop.id).eq("alert_type","ask_office").order("raised_at",{ascending:false}).limit(1).maybeSingle();if(existing.data)update(stop.id,{alertId:existing.data.id,...(existing.data.resolution?{resolution:existing.data.resolution}:{})});return;}
    const r=await supabase.rpc("ask_office_status",{p_alert_id:draft.alertId});
    if(r.error)return setLocalError(t("c.error"));
    const d=r.data as {resolution:string|null;deadline:string;now:string}|null;
    if(d){setRemaining(Math.max(0,Math.round((Date.parse(d.deadline)-Date.parse(d.now))/1000)));if(d.resolution)update(stop.id,{resolution:d.resolution});}
  };
  // The provider owns the alert subscription; overlapping channels can unregister
  // identical server bindings when the task changes. Refresh this read on provider loads.
  useEffect(()=>{void officeLoad();},[step,draft.alertId,draft.resolution,w.stops]);
  useEffect(()=>{
    if(step!=="customer"||q.trim().length<3){setFound([]);return;}
    let active=true;const timer=window.setTimeout(()=>{void supabase.rpc("driver_find_customers",{p_trip_id:tripId,p_q:q.trim()}).then(r=>{if(!active)return; if(r.error)setLocalError(t("c.error"));setFound((r.data ?? []).map(c=>({id:c.id,name:c.business_name||c.contact_name||"—"})));});},300);
    return()=>{active=false;window.clearTimeout(timer);};
  },[step,q,tripId]);
  const deliver=async(proof:Partial<Draft>={},failed=false)=>{
    if(!stop||!staff)return false;
    const current={...draft,...proof};
    if(!failed&&settings.proof_photo_required&&!current.photo){setLocalError(t("dr.needPhoto"));return false;}
    if(!failed&&settings.proof_signature_enabled&&settings.proof_signature_required&&!current.signature){setLocalError(t("c.required"));return false;}
    if(!failed&&settings.proof_otp_required&&!current.otp&&!current.photo){setLocalError(t("c.required"));return false;}
    const sign=await signatureToPath(current.signature,staff.id,stop.id);
    const c=await getCoords();
    const r=await write("deliver_stop",{p_stop_id:stop.id,p_lines:failed?orderLines.map(l=>({order_line_id:l.id,delivered:0,short:l.qty,damaged:0,refused:0,empties:0})):goods,p_proof:{...(current.otp?{otp:current.otp}:{}),...(current.photo?{photo_url:current.photo}:{}),...(sign?{signature_url:sign}:{}),...(c?{latitude:c.latitude,longitude:c.longitude}:{})},p_fail_reason:failed?(reason||note||t("dr.markFailed")):null});
    if(r.ok){update(stop.id,{...current,goods});void go(failed||!needsPayment(stop.orders?.payment_mode,due)?"done":"payment",stop.id);}return r.ok;
  };
  const afterGoods=()=>{if(!stop)return;update(stop.id,{goods});if(settings.proof_otp_enabled)void go("proof");else if(settings.proof_photo_enabled)void go("photo");else if(settings.proof_signature_enabled)void go("signature");else void deliver();};
  const afterProof=(proof:Partial<Draft>)=>{if(!stop)return;update(stop.id,proof);if(settings.proof_photo_required&&!proof.photo&&!draft.photo)void go("photo");else if(settings.proof_signature_enabled&&!draft.signature)void go("signature");else void deliver(proof);};
  useEffect(()=>{if(step!=="office"||!draft.resolution)return;const approved=["approved","no_reply:deliver_and_flag"].includes(draft.resolution);if(approved)void go(Number(draft.amount)>0?"cash":"done");else void home();},[step,draft.resolution]);
  const collect=async(mode:string)=>{
    if(!stop)return;
    const amount=Number(draft.amount||due);
    if(!(amount>0)||amount>due){setLocalError(t("dr.partAmountBad"));return;}
    if(amount<due && !["approved","no_reply:deliver_and_flag"].includes(draft.resolution ?? "")){void go("office");return;}
    if(mode==="cheque"&&!draft.payPhoto){setLocalError(t("dr.needPhoto"));return;}
    if(mode==="split"){
      const cash=Number(draft.splitCash);if(!(cash>0&&cash<amount)){setLocalError(t("dr.splitBad"));return;}
      if(!draft.collectionDone){const a=await write("record_collection",{p_stop_id:stop.id,p_mode:"cash",p_amount:cash,p_reference:null,p_photo_url:null});if(!a.ok)return;update(stop.id,{collectionDone:true});}
      const b=await write("record_collection",{p_stop_id:stop.id,p_mode:"upi",p_amount:amount-cash,p_reference:draft.reference||null,p_photo_url:draft.payPhoto});if(!b.ok)return;
    }else{const r=await write("record_collection",{p_stop_id:stop.id,p_mode:mode,p_amount:amount,p_reference:draft.reference||null,p_photo_url:draft.payPhoto});if(!r.ok)return;}
    void go("done");
  };
  const start=async()=>{
    if(settings.require_start_odometer&&!odo){setLocalError(t("dr.needOdo"));return;}if(settings.require_start_odometer_photo&&!odoPhoto){setLocalError(t("dr.needPhoto"));return;}
    if(settings.require_start_selfie&&!selfie){void go("selfie");return;}if(settings.vehicle_check_enabled&&checks.length<settings.vehicle_check_items.length){void go("check");return;}
    const r=await write("start_trip",{p_trip_id:tripId,p_selfie_url:selfie,p_odometer:Number(odo),p_odometer_photo_url:odoPhoto,p_check_photo_url:checkPhoto,p_vehicle_check:settings.vehicle_check_enabled?settings.vehicle_check_items.map(item=>({item,ok:checks.includes(item)})):[]});if(r.ok)void home();
  };
  const end=async()=>{if(actionable.length){setLocalError(t("c.error"));return;}if(settings.require_end_odometer&&!odo){setLocalError(t("dr.needOdo"));return;}if(settings.require_end_odometer_photo&&!odoPhoto){setLocalError(t("dr.needPhoto"));return;}const r=await write("end_trip",{p_trip_id:tripId,p_odometer:Number(odo),p_odometer_photo_url:odoPhoto});if(r.ok)void go("handover");};
  const extraSave=async()=>{
    const c=await getCoords();const gps=c?{p_latitude:c.latitude,p_longitude:c.longitude}:{};let rpc="";let args:Record<string,unknown>={};
    if(step==="expense"){if(!(Number(qty)>0)||settings.expense_bill_photo_required&&!photo){setLocalError(t("c.required"));return;}rpc="add_trip_expense";args={p_trip_id:tripId,p_type:expenseType||settings.expense_types[0]||"other",p_amount:Number(qty),p_bill_photo_url:photo,p_note:note||null};}
    if(step==="pickup"){if(!customer||!product||!(Number(qty)>0)){setLocalError(t("c.required"));return;}rpc="record_pickup";args={p_trip_id:tripId,p_customer_id:customer,p_product_id:product,p_qty:Number(qty),p_photo_url:photo,...gps};}
    if(step==="spot"){if(!customer||!product||!(Number(qty)>0)||Number(qty)>(w.products.find(p=>p.id===product)?.left ?? 0)){setLocalError(t("c.required"));return;}rpc="spot_sale";args={p_trip_id:tripId,p_customer_id:customer,p_lines:[{product_id:product,qty:Number(qty)}],p_paid_now:paid,...gps};}
    if(step==="sos"){rpc="raise_trip_alert";args={p_trip_id:tripId,p_type:"sos",p_note:note||null,...gps};}
    if(rpc){const r=await write(rpc,args);if(r.ok){if(step==="spot"&&Array.isArray(r.data)){const item=r.data[0] as {order_id?:string}|undefined;if(item?.order_id){const saved=await supabase.from("trip_stops").select("id").eq("trip_id",tripId).eq("order_id",item.order_id).maybeSingle();if(saved.data){void go("payment",saved.data.id);return;}}}void home();}}
  };
  const back=<Link to={step==="home"?"/driver":"/driver/$tripId"} params={step==="home"?{}:{tripId}}><BackIcon /></Link>;
  const title=step==="stops"?copy("stops"):step==="bank"?copy("bank"):t(titleKeys[step] ?? "dr.title",{n:stops.length});
  const shell=(body:ReactNode,action?:ReactNode)=> <TaskScreen title={title} back={back} action={action} error={localError||error} menu={step==="home"?<Button variant="ghost" size="icon" aria-label={t("sec.menu")} onClick={()=>setMenu(v=>!v)}><MoreHorizontal /></Button>:undefined}>{body}</TaskScreen>;
  const main=(label:string,fn:()=>void,disabled=false)=> <MainAction onClick={fn} disabled={busy||disabled}>{busy?t("c.loading"):label}</MainAction>;
  const small=(next:string,label:string)=> <Button asChild variant="link" className="justify-start px-0 text-base"><Link to="/driver/$tripId/$step" params={{tripId,step:next}} search={stop?{stopId:stop.id}:{}}>{label}</Link></Button>;
  if(w.loading)return shell(<Spinner />);if(!trip)return shell(<p>{t("c.error")}</p>);
  if(!titleKeys[step])return shell(<p>{t("c.none")}</p>);
  if(["expense","pickup","spot","sos"].includes(step)&&!optionalDriverTasks(settings).includes(step))return shell(<p>{t("c.none")}</p>);
  if(step==="home"){
    const action=driverHomeAction(trip,actionable.length);const keys:Record<string,string>={loading:"dr.loadingNotDone",pass:"dr.showGatePass",start:"dr.startTrip",next:"dr.nextStop",end:"dr.endTrip",handover:"dr.handedToCashier",settled:"dr.settled"};
    return shell(<><div className="border-b border-border pb-5"><p className="text-2xl font-bold">{trip.vehicles?.reg_no}</p><p className="mt-3 text-lg">{t("ld.stops",{n:stops.length})}</p><p className="mt-3 text-3xl font-bold">₹{stops.reduce((a,s)=>a+(s.orders?.payment_mode==="credit"||w.drafts[s.id]?.resolution?0:Math.max(0,keptValue(lines[s.orders?.id ?? ""] ?? [],l=>l.kept ?? l.qty)-Number(s.orders?.amount_paid))),0)}</p></div>{menu&&<nav className="grid gap-1" role="menu">{optionalDriverTasks(settings).map(s=><Button asChild key={s} variant="ghost" role="menuitem" className="h-12 justify-start text-lg"><Link to="/driver/$tripId/$step" params={{tripId,step:s}}>{s==="stops"?copy("stops"):t(titleKeys[s] ?? "dr.title",{n:stops.length})}</Link></Button>)}</nav>}</>,main(action==="loading"?copy("loading"):t(keys[action] ?? "dr.title"),()=>void go(action),["loading","settled"].includes(action)||action==="pass"&&!token));
  }
  if(step==="pass")return shell(token?<div className="mx-auto mt-12 bg-card p-2"><QRCode value={token} size={264} /></div>:<p>{t("dr.waitGateOut")}</p>);
  if(["start","end"].includes(step))return shell(<><label className="grid gap-2 text-lg">{t("dr.odometer")}<input className={taskInput} inputMode="numeric" value={odo} onChange={e=>setOdo(e.target.value.replace(/\D/g,""))}/></label><PhotoInput userId={staff?.id ?? ""} kind={`odo-${step}`} label={t("dr.odometerPhoto")} value={odoPhoto} onChange={setOdoPhoto}/></>,main(t(step==="start"?"dr.startTrip":"dr.endTrip"),()=>void (step==="start"?start():end())));
  if(step==="selfie")return shell(settings.require_start_selfie?<PhotoInput userId={staff?.id ?? ""} kind="selfie" label={t("dr.selfie")} value={selfie} onChange={setSelfie}/>:null,main(t("dr.startTrip"),()=>void start(),settings.require_start_selfie&&!selfie));
  if(step==="check")return shell(settings.vehicle_check_enabled?<>{settings.vehicle_check_items.map(item=><label key={item} className="flex gap-3 text-lg"><input type="checkbox" checked={checks.includes(item)} onChange={e=>setChecks(v=>e.target.checked?[...v,item]:v.filter(x=>x!==item))}/>{t(`dr.fr.${item}`)===`dr.fr.${item}`?item:t(`dr.fr.${item}`)}</label>)}<PhotoInput userId={staff?.id ?? ""} kind="vehicle-check" label={t("dr.vehicleCheckPhoto")} value={checkPhoto} onChange={setCheckPhoto}/></>:null,main(t("dr.startTrip"),()=>void start()));
  if(step==="stops")return shell(<>{stops.filter(s=>s.status!=="cancelled").map(s=><Button asChild variant="outline" key={s.id} className="h-auto min-h-20 justify-start whitespace-normal py-3 text-left text-lg"><Link to="/driver/$tripId/$step" params={{tripId,step:"next"}} search={{stopId:s.id}}><span>{s.orders?.business_name||s.orders?.customer_name}<span className="mt-2 block"><StatusBadge status={s.status}/></span></span></Link></Button>)}</>);
  if(step==="handover")return shell(<>{w.pendingCash?<p className="text-xl">{t("dr.handoverWaiting",{name:w.pendingCash})}</p>:<><p className="text-3xl font-bold">₹{w.cash}</p><input aria-label={t("dr.cashReceived")} className={taskInput} inputMode="decimal" value={handoverAmt||String(w.cash)} onChange={e=>setHandoverAmt(e.target.value)}/><select aria-label={t("dr.cashier")} className={taskInput} value={cashier} onChange={e=>setCashier(e.target.value)}><option value="">{t("dr.cashier")}</option>{w.cashiers.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}</select></>}</>,!w.pendingCash?main(t("dr.handedToCashier"),()=>{void write("record_cash_handover",{p_trip_id:tripId,p_to_user_id:cashier,p_amount:Number(handoverAmt||w.cash),p_note:null}).then(r=>{if(r.ok)void home();});},!cashier||!trip.gate_in_at):undefined);
  if(["expense","pickup","spot","sos"].includes(step))return shell(<>{step==="expense"&&<select className={taskInput} value={expenseType} onChange={e=>setExpenseType(e.target.value)}>{(settings.expense_types.length?settings.expense_types:["other"]).map(x=><option key={x} value={x}>{copy((["diesel","toll","puncture","food","parking","other"].includes(x.toLowerCase())?x.toLowerCase():"other") as TaskLabel)}</option>)}</select>}{["spot","pickup"].includes(step)&&<><select aria-label={t("dr.customer")} className={taskInput} value={customer} onChange={e=>setCustomer(e.target.value)}><option value="">{t("dr.customer")}</option>{stops.flatMap(s=>s.orders?[s.orders]:[]).map(o=><option key={o.id} value={o.customer_id}>{o.business_name||o.customer_name}</option>)}{found.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>{step==="spot"&&small("customer",t("dx.tabSearch"))}<select aria-label={t("dr.pickupProduct")} className={taskInput} value={product} onChange={e=>setProduct(e.target.value)}><option value="">{t("dr.pickupProduct")}</option>{w.products.filter(p=>step==="pickup"?p.returnable:p.left>0).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></>}{step!=="sos"&&<input aria-label={step==="expense"?t("dr.expenseAmount"):t("c.qty")} placeholder={step==="expense"?t("dr.expenseAmount"):t("c.qty")} className={taskInput} inputMode="decimal" value={qty} onChange={e=>setQty(e.target.value)}/>}{["expense","sos"].includes(step)&&<input aria-label={t("c.notes")} placeholder={t("c.notes")} className={taskInput} value={note} onChange={e=>setNote(e.target.value)}/>}{step==="expense"&&<PhotoInput userId={staff?.id ?? ""} kind="expense-bill" label={t("dr.expenseBill")} required={settings.expense_bill_photo_required} value={photo} onChange={setPhoto}/>}{step==="spot"&&<label className="flex gap-3 text-lg"><input type="checkbox" checked={paid} onChange={e=>setPaid(e.target.checked)}/>{t("dr.paidNow")}</label>}</>,main(t(step==="sos"?"dr.sos":"c.submit"),()=>void extraSave()));
  if(step==="customer")return shell(<><input aria-label={t("dx.searchHint")} placeholder={t("dx.searchHint")} className={taskInput} value={q} onChange={e=>setQ(e.target.value)}/>{found.map(c=><Button key={c.id} variant="outline" className="h-14 text-lg" onClick={()=>{setCustomer(c.id);void go("spot");}}>{c.name}</Button>)}</>);
  if(step==="done")return shell(<div role="status" className="flex flex-col items-center gap-6 py-24"><CheckCircle2 className="h-24 w-24 text-primary"/><p className="text-3xl font-bold">{t("dr.stopDone")}</p></div>);
  if(!stop)return shell(<p>{t("c.none")}</p>);
  if(step==="next")return shell(<><h2 className="text-2xl font-bold">{stop.orders?.business_name||stop.orders?.customer_name}</h2><p className="text-lg">{stop.orders?.delivery_address_text||[stop.orders?.business_name,t("dr.customer")].filter(Boolean).join(" · ")}</p><p className="text-lg">{orderLines.map(l=>`${l.product_name} × ${l.qty}`).join(", ")}</p><p className="text-3xl font-bold">₹{needsPayment(stop.orders?.payment_mode,due)?due:0}</p><div className="grid grid-cols-2 gap-3"><Button variant="outline" className="h-14 text-lg" onClick={()=>{const o=stop.orders;void openExternal(o?.delivery_latitude!=null&&o.delivery_longitude!=null?`https://www.google.com/maps/dir/?api=1&destination=${o.delivery_latitude},${o.delivery_longitude}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o?.delivery_address_text ?? "")}`);}}><MapPin/>{t("dr.map")}</Button><Button asChild variant="outline" className="h-14 text-lg" disabled={!phone}><a href={phone?`tel:${phone}`:undefined}><Phone/>{t("dr.call")}</a></Button></div>{stop.status==="pending"&&<div className="flex justify-between">{small("failed",t("dr.markFailed"))}<Button variant="link" className="text-base" onClick={()=>{void write("set_stop_later",{p_stop_id:stop.id,p_later:true}).then(r=>{if(r.ok){const next=pending.find(s=>s.id!==stop.id);if(next)void go("next",next.id);else void home();}});}}>{t("dr.doLater")}</Button></div>}</>,stop.status==="pending"?main(t("dr.reached"),()=>{void write("mark_arrived",{p_stop_id:stop.id}).then(r=>{if(r.ok)void go("goods");});}):needsPayment(stop.orders?.payment_mode,due)?main(t("dr.toCollect"),()=>void go("payment")):undefined);
  if(["goods","counts","proof","photo","signature"].includes(step)&&stop.status!=="pending")return shell(<p className="text-2xl">{t("dr.stopDone")}</p>);
  if(["payment","cash","upi","bank","cheque","split","udhaar","office"].includes(step)&&!needsPayment(stop.orders?.payment_mode,due))return shell(<p className="text-2xl">{t("dr.stopDone")}</p>);
  if(step==="goods")return shell(<>{orderLines.map(l=><div key={l.id} className="flex justify-between gap-3 border-b border-border py-3 text-xl"><span>{l.product_name}</span><strong>{goods.find(g=>g.order_line_id===l.id)?.delivered ?? l.qty}</strong></div>)}{settings.allow_partial_delivery&&small("counts",t("dr.somethingDifferent"))}</>,main(copy("allGiven"),afterGoods));
  if(step==="counts")return shell(<>{orderLines.map(l=>{const g=goods.find(x=>x.order_line_id===l.id);if(!g)return null;return <div key={l.id} className="grid gap-3"><p className="text-xl font-bold">{l.product_name}</p>{(["delivered","damaged","refused","empties"] as const).map(k=><label key={k} className="flex items-center justify-between gap-3 text-base">{t(k==="delivered"?"dr.deliveredQty":`dr.${k}`)}<Stepper value={g[k]} max={k==="empties"?9999:l.qty} onChange={value=>{const changed=goods.map(x=>x.order_line_id===l.id?{...x,[k]:value}:x).map(x=>({...x,short:Math.max(0,(orderLines.find(y=>y.id===x.order_line_id)?.qty ?? 0)-x.delivered-x.damaged-x.refused)}));update(stop.id,{goods:changed});}}/></label>)}</div>;})}</>,main(copy("continue"),()=>{if(goods.some(g=>g.delivered+g.damaged+g.refused>(orderLines.find(l=>l.id===g.order_line_id)?.qty ?? 0)))setLocalError(t("dr.qtyOverflow"));else afterGoods();}));
  if(step==="proof")return shell(<><p className="text-lg">{t("dr.deliveryOtp")}</p><OtpInput value={draft.otp} onChange={otp=>update(stop.id,{otp})}/>{settings.proof_photo_enabled&&small("photo",copy("noOtp"))}</>,main(copy("verify"),()=>afterProof({otp:draft.otp}),draft.otp.length!==4));
  if(step==="photo")return shell(settings.proof_photo_enabled?<PhotoInput userId={staff?.id ?? ""} kind={`proof-${stop.id}`} label={t("dr.proofPhoto")} value={draft.photo} onChange={photo=>update(stop.id,{photo})}/>:<p>{t("c.none")}</p>,main(copy("continue"),()=>afterProof({photo:draft.photo,otp:""}),settings.proof_photo_required&&!draft.photo));
  if(step==="signature")return shell(settings.proof_signature_enabled?<SignaturePad onChange={signature=>update(stop.id,{signature})}/>:null,main(copy("continue"),()=>void deliver(),settings.proof_signature_required&&!draft.signature));
  if(step==="payment")return shell(<><p className="text-3xl font-bold">₹{due}</p><input aria-label={t("dr.toCollect")} className={taskInput} inputMode="decimal" value={draft.amount||String(due)} onChange={e=>update(stop.id,{amount:e.target.value})}/><div className="grid grid-cols-2 gap-3">{["cash","upi","bank","cheque","split",...(udhaar?["udhaar"]:[])].map(mode=><Button asChild variant="outline" key={mode} className="h-14 text-lg"><Link to="/driver/$tripId/$step" params={{tripId,step:mode}} search={{stopId:stop.id}}>{mode==="bank"?copy("bank"):t(titleKeys[mode] ?? "dr.toCollect")}</Link></Button>)}</div>{small("office",copy("notReceived"))}</>);
  if(["cash","upi","bank","cheque","split"].includes(step))return shell(<><p className="text-3xl font-bold">₹{Number(draft.amount||due)}</p>{step==="split"&&<label className="grid gap-2 text-lg">{t("dr.modeCash")}<input className={taskInput} value={draft.splitCash} inputMode="decimal" onChange={e=>update(stop.id,{splitCash:e.target.value})}/></label>}{["upi","split"].includes(step)&&(upi?.id?<div className="mx-auto bg-card p-2"><QRCode value={buildUpiUri(upi.id,upi.payee,step==="split"?Number(draft.amount||due)-Number(draft.splitCash):Number(draft.amount||due),stop.orders?.order_no ?? null)} size={240}/></div>:<p>{t("c.none")}</p>)}{step!=="cash"&&<input className={taskInput} aria-label={t("dr.reference")} placeholder={t("dr.reference")} value={draft.reference} onChange={e=>update(stop.id,{reference:e.target.value})}/>}{step==="cheque"&&<PhotoInput userId={staff?.id ?? ""} kind={`cheque-${stop.id}`} label={t("c.camera")} required value={draft.payPhoto} onChange={payPhoto=>update(stop.id,{payPhoto})}/>}</>,main(copy("received"),()=>void collect(step),["upi","split"].includes(step)&&!upi?.id));
  if(step==="udhaar")return shell(<p className="text-3xl font-bold">₹{due}</p>,main(t("dr.udhaar"),()=>{void supabase.rpc("stop_take_udhaar",{p_stop_id:stop.id,p_amount:due}).then(async r=>{if(r.error){setLocalError(t("dr.udhaarAsk"));return;}if(r.data){await w.load();void go("done");}else void go("office");});},!udhaar));
  if(step==="failed")return shell(<><select className={taskInput} value={reason} onChange={e=>setReason(e.target.value)}><option value="">{t("dr.failNote")}</option>{settings.failed_reasons.map(r=><option key={r} value={r}>{t(({"shop closed":"dr.fr.shopClosed","customer not available":"dr.fr.notAvailable","customer refused":"dr.fr.refused","wrong address":"dr.fr.wrongAddress","no payment":"dr.fr.noPayment","vehicle problem":"dr.fr.vehicle"} as Record<string,string>)[r.toLowerCase()] ?? "dr.failNote")}</option>)}</select><input aria-label={t("dr.failNote")} placeholder={t("dr.failNote")} className={taskInput} value={note} onChange={e=>setNote(e.target.value)}/></>,main(t("dr.markFailed"),()=>void deliver({},true),!reason&&!note));
  if(step==="office"){
    const approved=["approved","no_reply:deliver_and_flag"].includes(draft.resolution ?? "");
    return shell(<><p className="text-3xl font-bold">₹{due}</p>{!draft.alertId?<><input aria-label={t("dr.partAmount")} className={taskInput} placeholder={t("dr.partAmount")} inputMode="decimal" value={draft.amount} onChange={e=>update(stop.id,{amount:e.target.value})}/><input aria-label={t("dr.failNote")} placeholder={t("dr.failNote")} className={taskInput} value={note} onChange={e=>setNote(e.target.value)}/></>:<p className="text-xl" role="status">{draft.resolution?t(approved?"dr.officeApproved":"dr.officeRejected"):`${t("dr.waitingOffice")} ${remaining==null?"":`${Math.floor(remaining/60)}:${String(remaining%60).padStart(2,"0")}`}`}</p>}</>,!draft.alertId?main(t("dr.askOffice"),()=>{const amount=Number(draft.amount||0);if(amount>=due)return setLocalError(t("dr.partAmountBad"));void write("ask_office",{p_trip_id:tripId,p_stop_id:stop.id,p_mode:amount>0?"part":"none",p_amount:amount,p_reason:note||t("dr.rsnLater")}).then(r=>{if(r.ok&&typeof r.data==="string")update(stop.id,{alertId:r.data});});}):draft.resolution?main(copy("continue"),()=>{if(approved)void go(Number(draft.amount)>0?"cash":"done");else void home();}):undefined);
  }
  return shell(<p>{t("c.none")}</p>);
}
function OtpInput({value,onChange}:{value:string;onChange:(v:string)=>void}) {
  const refs=useRef<(HTMLInputElement|null)[]>([]);
  return <div className="grid grid-cols-4 gap-3">{Array.from({length:4},(_,i)=><input key={i} ref={el=>{refs.current[i]=el;}} className="h-16 min-w-0 rounded-lg border border-input bg-background text-center text-3xl font-bold" inputMode="numeric" aria-label={`OTP ${i+1}`} value={value[i] ?? ""} onChange={e=>{const digits=e.target.value.replace(/\D/g,"");if(digits.length>1){onChange(digits.slice(0,4));refs.current[3]?.focus();return;}const next=Array.from({length:4},(_,n)=>value[n] ?? "");next[i]=digits;onChange(next.join(""));if(digits)refs.current[i+1]?.focus();}} onKeyDown={e=>{if(e.key==="Backspace"&&!value[i])refs.current[i-1]?.focus();}}/>)}</div>;
}
