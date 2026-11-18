import { Button } from '@/components/ui/button';
import { taskInput } from './task-screen';
import { useLang } from '@/lib/l10n';
import { deliveryCopy, type DeliveryLabel } from '@/lib/delivery-copy';
export function DeliveryReasons({ options,value,note,onChange }: { options: readonly string[];value:string;note:string;onChange:(reason:string,note:string)=>void }) {
 const {lang}=useLang();
 return <div className="grid gap-2"><p className="text-lg font-semibold">{deliveryCopy(lang,'reason')}</p><div className="flex flex-wrap gap-2">{options.map(key=><Button key={key} variant={value===key?'default':'outline'} className="min-h-12 whitespace-normal" onClick={()=>onChange(key,note)}>{deliveryCopy(lang,key as DeliveryLabel)}</Button>)}</div>{value==='other'&&<input aria-label={deliveryCopy(lang,'note')} className={taskInput} value={note} onChange={e=>onChange(value,e.target.value)}/>}</div>;
}