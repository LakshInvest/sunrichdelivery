import { createContext, useContext, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/lib/l10n";
import { useTeamAuth } from "@/lib/team-auth";
import { queueRpc } from "@/lib/offline";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { TaskScreen, MainAction, BackIcon, taskInput } from "@/components/team/task-screen";
import { Button } from "@/components/ui/button";
import { Stepper, Spinner } from "@/components/team/ui";
import { EmptyState } from "@/components/team/role-home";
import { Undo2 } from "lucide-react";
import { istDisplay } from "@/lib/ist";
type Prod={name:string;name_hi:string|null;name_mr:string|null;pack_label:string|null;pack_label_hi:string|null;pack_label_mr:string|null;sell_unit:string|null};
type Row={product_id:string;planned_qty:number;loaded_qty:number|null;crates_count:number|null;products:Prod|null};
type Ret={product_id:string|null;kind:string;expected_qty:number};
type Trip={trip_no:string;status:string;gate_in_at:string|null;returns_received_at:string|null;loaded_at:string|null;driver_started_at:string|null;trip_date:string;hired_driver_name:string|null;vehicles:{reg_no:string}|null;driver:{full_name:string}|null};
type State={tripId:string;trip:Trip|null;rows:Row[];returns:Ret[];draft:Record<string,number>;setDraft:(v:Record<string,number>)=>void;reason:string;setReason:(v:string)=>void;loading:boolean;error:string|null;setError:(v:string|null)=>void;busy:boolean;save:(returns:boolean)=>Promise<boolean>};
const Ctx=createContext<State|null>(null);
export const CRATES="__crates";
/** Reason chips shown under the list as soon as a count differs from the plan. */
export const REASONS=["stock","full","order","other"] as const;
export function LoaderWorkflowProvider({tripId,children}:{tripId:string;children:ReactNode}){
 const {t}=useLang();const {staff}=useTeamAuth();const [trip,setTrip]=useState<Trip|null>(null);const [rows,setRows]=useState<Row[]>([]);const [returns,setReturns]=useState<Ret[]>([]);const [draft,setDraft]=useState<Record<string,number>>({});const [reason,setReason]=useState("");const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
 const load=async()=>{const [tr,ro]=await Promise.all([supabase.from("trips").select("trip_no,status,gate_in_at,returns_received_at,loaded_at,driver_started_at,trip_date,hired_driver_name,vehicles(reg_no),driver:user_profiles!trips_driver_user_id_fkey(full_name)").eq("id",tripId).single(),supabase.from("trip_loading").select("product_id,planned_qty,loaded_qty,crates_count,products(name,name_hi,name_mr,pack_label,pack_label_hi,pack_label_mr,sell_unit)").eq("trip_id",tripId)]);if(tr.error||ro.error){setError(t("c.error"));setLoading(false);return;}setTrip(tr.data as unknown as Trip);setRows((ro.data ?? []) as unknown as Row[]);if(tr.data.gate_in_at){const r=await supabase.rpc("trip_return_expected",{p_trip_id:tripId});if(r.error)setError(t("c.error"));else setReturns((r.data ?? []) as unknown as Ret[]);}setLoading(false);};
 useLiveRefresh(load,[{table:"trips",filter:`id=eq.${tripId}`},...["trip_loading","trip_stops","trip_returns","gate_passes"].map(table=>({table,filter:`trip_id=eq.${tripId}`}))],`loader:${tripId}`);
 const call=async(name:string,args:Record<string,unknown>)=>{const r=await queueRpc(name,args);if(r.error&&!r.queued){setError(t("c.error"));return false;}return true;};
 const save=async(isReturns:boolean)=>{setBusy(true);setError(null);try{
  if(isReturns){const diff=returns.some(r=>Number(draft[`${r.kind}:${r.product_id}`] ?? r.expected_qty)!==Number(r.expected_qty));if(diff&&!reason.trim()){setError(t("ld.diffNeedReason"));return false;}if(!await call("receive_returns",{p_trip_id:tripId,p_lines:returns.map(r=>({product_id:r.product_id,kind:r.kind,expected:Number(r.expected_qty),actual:Number(draft[`${r.kind}:${r.product_id}`] ?? r.expected_qty),name:rows.find(x=>x.product_id===r.product_id)?.products?.name ?? ""})),p_note:reason||null}))return false;
  }else{const plannedCrates=rows.reduce((a,r)=>a+Number(r.crates_count ?? 0),0);const crates=draft[CRATES];const diff=rows.some(r=>Number(draft[r.product_id] ?? r.planned_qty)!==Number(r.planned_qty));if(diff&&!reason.trim()){setError(t("ld.diffNeedReason"));return false;}if(diff&&!await call("flag_load_mismatch",{p_trip_id:tripId,p_note:reason}))return false;for(const [i,r] of rows.entries()){const qty=Number(draft[r.product_id] ?? r.planned_qty);const c=crates!=null&&crates!==plannedCrates?(i===0?crates:0):null;if(qty===Number(r.loaded_qty)&&c===null)continue;if(!await call("record_loading",{p_trip_id:tripId,p_product_id:r.product_id,p_loaded_qty:qty,p_crates:c,p_photo_url:null}))return false;}if(!diff&&(staff?.permissions ?? []).some(p=>p==="dispatch:approve"||p==="dispatch:edit")){if(!await call("finalize_loading",{p_trip_id:tripId}))return false;}}
  await load();return true;
 }catch{setError(t("c.error"));return false;}finally{setBusy(false);}};
 return <Ctx.Provider value={{tripId,trip,rows,returns,draft,setDraft,reason,setReason,loading,error,setError,busy,save}}>{children}</Ctx.Provider>;
}
const RET_ORDER=["empties","crates","refused","damaged","undelivered"];
const RET_KEY:Record<string,string>={undelivered:"ld.undelivered",damaged:"ld.damagedR",refused:"ld.returnedPacks",empties:"ld.emptiesR",crates:"ld.cratesR"};
export function LoaderTaskPage({step="load"}:{step?:string}){
 const w=useContext(Ctx);if(!w)throw new Error("Loading context missing");const {t,lang}=useLang();const navigate=useNavigate();const isReturns=step.startsWith("returns");const edit=step.endsWith("counts");
 const pick=(p:Prod|null|undefined,f:"name"|"pack_label")=>(lang==="hi"?p?.[`${f}_hi`]:lang==="mr"?p?.[`${f}_mr`]:p?.[f])||p?.[f]||"";
 const prod=(id:string|null)=>w.rows.find(r=>r.product_id===id)?.products;
 const unit=(p:Prod|null|undefined)=>pick(p,"pack_label")||(p?.sell_unit?t(`ld.unit.${p.sell_unit}`):"");
 const plannedCrates=w.rows.reduce((a,r)=>a+Number(r.crates_count ?? 0),0);
 type Line={key:string;title:string;sub:string;plan:number;group?:string};
 const lines:Line[]=isReturns?RET_ORDER.flatMap(k=>w.returns.filter(r=>r.kind===k&&Number(r.expected_qty)>0).map(r=>({key:`${r.kind}:${r.product_id}`,title:r.product_id?pick(prod(r.product_id),"name"):t(RET_KEY[k] ?? "ld.returns"),sub:unit(prod(r.product_id)),plan:Number(r.expected_qty),group:k})))
  :[...w.rows.map(r=>({key:r.product_id,title:pick(r.products,"name"),sub:unit(r.products),plan:Number(r.planned_qty)})),{key:CRATES,title:t("ld.crates"),sub:"",plan:plannedCrates}];
 const val=(l:Line)=>w.draft[l.key] ?? l.plan;
 const diff=lines.some(l=>val(l)!==l.plan);
 const done=isReturns?!!w.trip?.returns_received_at:!["planned","loading"].includes(w.trip?.status ?? "planned");
 const driver=w.trip?.driver?.full_name ?? w.trip?.hired_driver_name;
 const when=isReturns?w.trip?.gate_in_at:w.trip?.loaded_at;
 const chip=(on:boolean)=>`min-h-11 whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${on?"border-primary bg-primary text-primary-foreground":"border-border bg-card text-foreground"}`;
 const reasonLabel=(r:string)=>t(`ld.reason.${r}`);const picked=REASONS.find(r=>r!=="other"&&w.reason===reasonLabel(r));const [other,setOther]=useState(false);
 const label=isReturns?(diff?t("ld.receivedDiff"):t("ld.allReceived")):(diff?t("ld.loadDiff"):t("ld.allLoaded"));
 const lead=isReturns?t("ld.expectedR"):t("ld.planned");const got=isReturns?t("ld.came"):t("ld.loaded");
 let lastGroup="";
 return <TaskScreen title={t(isReturns?"ld.returns":"ld.loadScreen")} back={<Link to="/loader"><BackIcon/></Link>} error={w.error} action={!done?<MainAction disabled={w.busy||isReturns&&!w.trip?.gate_in_at||diff&&!w.reason.trim()} onClick={()=>{void w.save(isReturns).then(ok=>{if(ok){w.setReason("");w.setDraft({});void navigate({to:"/loader"});}});}}>{label}</MainAction>:undefined}>
 {w.loading?<Spinner/>:<>
  <section className="min-w-0 overflow-hidden rounded-2xl bg-primary p-4 text-primary-foreground shadow-soft" data-testid="loader-head">
   <div className="flex items-center justify-between gap-2"><p className="min-w-0 flex-1 truncate font-display text-xl font-bold">{w.trip?.vehicles?.reg_no ?? "—"}</p></div>
   <p className="mt-1 truncate text-sm opacity-85">{[w.trip?.trip_no,driver,when?istDisplay(when,{hour:"numeric",minute:"2-digit"}):w.trip?.trip_date].filter(Boolean).join(" · ")}</p>
  </section>
  {lines.length>0&&<div className="home-card min-w-0 overflow-hidden" data-testid="count-list">
   <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_auto] items-center gap-2 border-b border-border bg-muted/50 px-4 py-2 text-xs font-bold uppercase text-muted-foreground"><span>{t("ld.product")}</span><span className="text-center">{lead}</span><span className={`text-center ${edit&&!done?"w-[8.5rem]":"w-12"}`}>{got}</span></div>
   {lines.map(l=>{const v=val(l);const changed=v!==l.plan;const head=isReturns&&l.group!==lastGroup?(lastGroup=l.group ?? "",<p key={`g-${l.group}`} className="bg-secondary/10 px-4 py-1.5 text-xs font-bold text-primary">{t(RET_KEY[l.group ?? ""] ?? "ld.returns")}</p>):null;return <div key={l.key}>{head}<div data-changed={changed||undefined} className={`grid grid-cols-[minmax(0,1fr)_2.75rem_auto] items-center gap-2 border-b border-border px-4 py-3 last:border-0 ${changed?"bg-warning/10":""}`}><div className="min-w-0"><p className="truncate text-base font-semibold">{l.title}</p>{l.sub&&<p className="truncate text-xs text-muted-foreground">{l.sub}</p>}</div><span className="text-center text-lg text-muted-foreground">{l.plan}</span>{edit&&!done?<div className="w-[8.5rem]"><Stepper value={v} onChange={n=>w.setDraft({...w.draft,[l.key]:Math.max(0,n)})}/></div>:<strong className={`w-12 text-center text-2xl ${changed?"text-warning-foreground":""}`}>{v}</strong>}</div></div>;})}
  </div>}
  {isReturns&&!lines.length&&!done&&<EmptyState icon={Undo2} text={w.trip?.gate_in_at?t("ld.nothingBack"):t("ld.notBack")}/>}
  {diff&&!done&&<div className="grid gap-2" data-testid="reason-chips"><p className="text-base font-semibold">{t("ld.whyDiff")}</p><div className="flex flex-wrap gap-2">{REASONS.map(r=><button key={r} type="button" className={chip(r==="other"?other&&!picked:picked===r)} onClick={()=>{w.setError(null);if(r==="other"){setOther(true);w.setReason("");}else{setOther(false);w.setReason(reasonLabel(r));}}}>{reasonLabel(r)}</button>)}</div>{(other||(!picked&&w.reason!==""))&&<input aria-label={t("ld.diffReason")} placeholder={t("ld.reasonNote")} className={taskInput} value={w.reason} onChange={e=>w.setReason(e.target.value)} autoFocus/>}</div>}
  {!edit&&!done&&lines.length>0&&<Button asChild variant="outline" className="h-12 text-base"><Link to="/loader/$tripId/$step" params={{tripId:w.tripId,step:isReturns?"returns-counts":"load-counts"}}>{t("ld.changeCount")}</Link></Button>}
  {done&&<p role="status" className="text-xl">{t(isReturns?"ld.received":"ld.loadingDone")}</p>}
  {!isReturns&&w.trip?.gate_in_at&&<Button asChild variant="link"><Link to="/loader/$tripId/$step" params={{tripId:w.tripId,step:"returns"}}>{t("ld.returns")}</Link></Button>}
 </>}
 </TaskScreen>;
}
