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
type Row={product_id:string;planned_qty:number;loaded_qty:number|null;products:{name:string;name_hi:string|null;name_mr:string|null}|null};
type Ret={product_id:string|null;kind:string;expected_qty:number};
type State={tripId:string;trip:{status:string;gate_in_at:string|null;returns_received_at:string|null;vehicles:{reg_no:string}|null}|null;rows:Row[];returns:Ret[];draft:Record<string,number>;setDraft:(v:Record<string,number>)=>void;reason:string;setReason:(v:string)=>void;loading:boolean;error:string|null;busy:boolean;save:(returns:boolean)=>Promise<boolean>};
const Ctx=createContext<State|null>(null);
export function LoaderWorkflowProvider({tripId,children}:{tripId:string;children:ReactNode}){
 const {t}=useLang();const {staff}=useTeamAuth();const [trip,setTrip]=useState<State["trip"]>(null);const [rows,setRows]=useState<Row[]>([]);const [returns,setReturns]=useState<Ret[]>([]);const [draft,setDraft]=useState<Record<string,number>>({});const [reason,setReason]=useState("");const [loading,setLoading]=useState(true);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
 const load=async()=>{const [tr,ro]=await Promise.all([supabase.from("trips").select("status,gate_in_at,returns_received_at,vehicles(reg_no)").eq("id",tripId).single(),supabase.from("trip_loading").select("product_id,planned_qty,loaded_qty,products(name,name_hi,name_mr)").eq("trip_id",tripId)]);if(tr.error||ro.error){setError(t("c.error"));setLoading(false);return;}setTrip(tr.data as State["trip"]);setRows((ro.data ?? []) as Row[]);if(tr.data.gate_in_at){const r=await supabase.rpc("trip_return_expected",{p_trip_id:tripId});if(r.error)setError(t("c.error"));else setReturns((r.data ?? []) as unknown as Ret[]);}setLoading(false);};
 useLiveRefresh(load,[{table:"trips",filter:`id=eq.${tripId}`},...["trip_loading","trip_stops","trip_returns","gate_passes"].map(table=>({table,filter:`trip_id=eq.${tripId}`}))],`loader:${tripId}`);
 const call=async(name:string,args:Record<string,unknown>)=>{const r=await queueRpc(name,args);if(r.error&&!r.queued){setError(t("c.error"));return false;}return true;};
 const save=async(isReturns:boolean)=>{setBusy(true);setError(null);try{
  if(isReturns){const diff=returns.some(r=>Number(draft[`${r.kind}:${r.product_id}`] ?? r.expected_qty)!==Number(r.expected_qty));if(diff&&!reason.trim()){setError(t("ld.diffNeedReason"));return false;}if(!await call("receive_returns",{p_trip_id:tripId,p_lines:returns.map(r=>({product_id:r.product_id,kind:r.kind,expected:Number(r.expected_qty),actual:Number(draft[`${r.kind}:${r.product_id}`] ?? r.expected_qty),name:rows.find(x=>x.product_id===r.product_id)?.products?.name ?? ""})),p_note:reason||null}))return false;
  }else{const diff=rows.some(r=>Number(draft[r.product_id] ?? r.planned_qty)!==Number(r.planned_qty));if(diff&&!reason.trim()){setError(t("ld.diffNeedReason"));return false;}if(diff&&!await call("flag_load_mismatch",{p_trip_id:tripId,p_note:reason}))return false;for(const r of rows){const qty=Number(draft[r.product_id] ?? r.planned_qty);if(qty===Number(r.loaded_qty))continue;if(!await call("record_loading",{p_trip_id:tripId,p_product_id:r.product_id,p_loaded_qty:qty,p_crates:null,p_photo_url:null}))return false;}if(!diff&&(staff?.permissions ?? []).some(p=>p==="dispatch:approve"||p==="dispatch:edit")){if(!await call("finalize_loading",{p_trip_id:tripId}))return false;}}
  await load();return true;
 }catch{setError(t("c.error"));return false;}finally{setBusy(false);}};
 return <Ctx.Provider value={{tripId,trip,rows,returns,draft,setDraft,reason,setReason,loading,error,busy,save}}>{children}</Ctx.Provider>;
}
export function LoaderTaskPage({step="load"}:{step?:string}){
 const w=useContext(Ctx);if(!w)throw new Error("Loading context missing");const {t,lang}=useLang();const navigate=useNavigate();const isReturns=step.startsWith("returns");const edit=step.endsWith("counts");const current=isReturns?w.returns.filter(r=>Number(r.expected_qty)>0):w.rows.map(r=>({product_id:r.product_id,kind:"load",expected_qty:r.planned_qty}));
 const go=(next:string)=>navigate({to:"/loader/$tripId/$step",params:{tripId:w.tripId,step:next}});
 const name=(id:string|null)=>{const p=w.rows.find(r=>r.product_id===id)?.products;return (lang==="hi"?p?.name_hi:lang==="mr"?p?.name_mr:p?.name)||p?.name||"";};
 const done=isReturns?!!w.trip?.returns_received_at:!["planned","loading"].includes(w.trip?.status ?? "planned");
 return <TaskScreen title={t(isReturns?"ld.returns":"ld.loadScreen")} back={<Link to="/loader"><BackIcon/></Link>} error={w.error} action={!done?<MainAction disabled={w.busy||isReturns&&!w.trip?.gate_in_at} onClick={()=>{void w.save(isReturns).then(ok=>{if(ok)void navigate({to:"/loader"});});}}>{t(isReturns?"ld.allReceived":"ld.allLoaded")}</MainAction>:undefined}>
 {w.loading?<Spinner/>:<><p className="text-2xl font-bold">{w.trip?.vehicles?.reg_no}</p>{current.map(r=>{const key=isReturns?`${r.kind}:${r.product_id}`:r.product_id ?? "";const qty=w.draft[key] ?? Number(r.expected_qty);return <div key={key} className="flex items-center justify-between gap-3 border-b border-border py-2"><p className="max-w-48 text-base font-semibold">{name(r.product_id)} {isReturns?t(({undelivered:"ld.undelivered",damaged:"ld.damagedR",refused:"ld.refusedR",empties:"ld.emptiesR",crates:"ld.cratesR"} as Record<string,string>)[r.kind] ?? "ld.returns"):""}</p>{edit?<Stepper label={t("ld.actual")} value={qty} onChange={n=>w.setDraft({...w.draft,[key]:n})}/>:<strong className="text-2xl">{qty}</strong>}</div>;})}{!edit&&!done&&<Button asChild variant="link" className="justify-start px-0 text-base"><Link to="/loader/$tripId/$step" params={{tripId:w.tripId,step:isReturns?"returns-counts":"load-counts"}}>{t("ld.changeCount")}</Link></Button>}{edit&&<input aria-label={t("ld.diffReason")} placeholder={t("ld.diffReason")} className={taskInput} value={w.reason} onChange={e=>w.setReason(e.target.value)}/>}{isReturns&&!current.length&&!done&&<p className="text-xl">{t("c.none")}</p>}{done&&<p role="status" className="text-xl">{t(isReturns?"ld.received":"ld.loadingDone")}</p>}{!isReturns&&w.trip?.gate_in_at&&<Button asChild variant="link"><Link to="/loader/$tripId/$step" params={{tripId:w.tripId,step:"returns"}}>{t("ld.returns")}</Link></Button>}</>}
 </TaskScreen>;
}
