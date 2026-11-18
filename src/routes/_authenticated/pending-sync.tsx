import { createFileRoute,Link } from '@tanstack/react-router';
import { useEffect,useState } from 'react';
import { pendingEntries,replayQueue,subscribe } from '@/lib/offline';
import { deliveryCopy } from '@/lib/delivery-copy';
import { useLang } from '@/lib/l10n';
import { taskHead } from '@/components/team/task-screen';
import { TaskScreen,BackIcon } from '@/components/team/task-screen';
import { Button } from '@/components/ui/button';
export const Route=createFileRoute('/_authenticated/pending-sync')({head:()=>taskHead('Pending sync','Your unsent Sunrich delivery entries and retry status.'),component:Pending});
function Pending(){const {lang}=useLang();const [entries,setEntries]=useState(pendingEntries());const [busy,setBusy]=useState(false);useEffect(()=>subscribe(()=>setEntries(pendingEntries())),[]);return <TaskScreen title={deliveryCopy(lang,'pending')} back={<Link to="/driver"><BackIcon/></Link>}><p className="text-xl font-bold">{deliveryCopy(lang,'pending')} ({entries.length})</p>{entries.map(e=><div key={e.id} className="grid gap-3 border-b border-border py-3"><p className="text-lg font-semibold">{e.rpc.includes('collection')||e.rpc.includes('payment')?deliveryCopy(lang,'bill'):e.rpc.includes('expired')?deliveryCopy(lang,'expired'):e.rpc.includes('expense')?deliveryCopy(lang,'expenses'):deliveryCopy(lang,'saved')}</p><p className="text-sm text-muted-foreground">{new Date(e.createdAt).toLocaleString('hi-IN')}</p>{e.error&&<p className="text-destructive">{deliveryCopy(lang,'error')}</p>}<Button variant="outline" className="h-12" disabled={busy} onClick={()=>{setBusy(true);void replayQueue(e.id).finally(()=>setBusy(false));}}>{deliveryCopy(lang,'retry')}</Button></div>)}</TaskScreen>;}