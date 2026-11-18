import { createFileRoute,Link } from '@tanstack/react-router';
import { useEffect,useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { taskHead } from '@/components/team/task-screen';
import { deliveryCopy,type DeliveryLabel } from '@/lib/delivery-copy';
import { useLang } from '@/lib/l10n';
import { TaskScreen,BackIcon,taskInput,MainAction } from '@/components/team/task-screen';
import { Spinner } from '@/components/team/ui';
type Row={id:string;trip_no:string;trip_date:string;status:string;reg_no:string;cash:number;upi:number;cheque:number;bank:number;expenses:number;handed_over:number;km:number;done:number;failed:number;settled_at:string|null;cash_received:number|null;settle_note:string|null};
type Account={trips:Row[];total_count:number;totals:Record<string,number>};
export const Route=createFileRoute('/_authenticated/driver-account')({head:()=>taskHead('Driver account','Monthly Sunrich trip collections, expenses, mileage and settlement.'),component:AccountPage});
function AccountPage(){
 const {lang}=useLang();const c=(k:DeliveryLabel)=>deliveryCopy(lang,k);const [month,setMonth]=useState(new Date().toISOString().slice(0,7));const [data,setData]=useState<Account|null>(null);const [error,setError]=useState<string|null>(null);const [busy,setBusy]=useState(false);
 const load=async(offset=0)=>{setBusy(true);const r=await supabase.rpc('my_trip_account',{p_month:`${month}-01`,p_offset:offset,p_limit:30});setBusy(false);if(r.error){setError(c('error'));return;}const value=r.data as unknown as Account;setData(prev=>({...value,trips:offset?[...(prev?.trips ?? []),...value.trips]:value.trips}));};
 useEffect(()=>{setData(null);void load();},[month]);
 const fields=['cash','upi','cheque','bank','expenses','handed_over','km','done','failed'] as const;
 return <TaskScreen title={c('account')} back={<Link to="/driver" search={{view:'trips'}}><BackIcon/></Link>} error={error} action={data&&data.trips.length<data.total_count?<MainAction disabled={busy} onClick={()=>void load(data.trips.length)}>{c('more')}</MainAction>:undefined}>
 <label className="grid gap-2">{c('month')}<input type="month" className={taskInput} value={month} onChange={e=>setMonth(e.target.value)}/></label>
 {!data?<Spinner/>:<><dl className="grid grid-cols-2 gap-3 border-b border-border pb-4">{fields.map(k=><div key={k}><dt className="text-sm text-muted-foreground">{c(k)}</dt><dd className="text-xl font-bold">{['km','done','failed'].includes(k)?'':'₹'}{data.totals[k] ?? 0}</dd></div>)}</dl>{!data.trips.length&&<p>{c('empty')}</p>}{data.trips.map(r=><section key={r.id} className="grid gap-2 border-b border-border py-4"><p className="font-bold truncate">{r.trip_no}</p><p>{r.trip_date} · {r.reg_no}</p><dl className="grid grid-cols-2 gap-2">{fields.map(k=><div key={k}><dt className="text-sm text-muted-foreground">{c(k)}</dt><dd className="font-semibold">{['km','done','failed'].includes(k)?'':'₹'}{r[k]}</dd></div>)}</dl>{(r.settled_at||r.handed_over>0)&&<p className="rounded-lg bg-success/10 p-3 font-semibold">{c('settlement')} · {c('handed_over')} ₹{r.handed_over}{r.cash_received!=null?` · ₹${r.cash_received}`:''}{r.settle_note?` · ${r.settle_note}`:''}</p>}</section>)}</>}
 </TaskScreen>;
}