export function partialReasonRequired(amount: number, due: number) { return amount > 0 && amount < due; }
export function paymentResolved(mode: string | null | undefined, due: number, resolution?: string | null, reason?: string | null) {
  return mode === 'credit' || mode === 'prepaid' || due <= 0 || resolution === 'partial' && !!reason?.trim();
}
export function cashToHandover(collections: {mode:string;amount:number}[], expenses: {amount:number;approved?:boolean|null}[]) {
  return Math.max(0,collections.filter(c=>c.mode==='cash').reduce((n,c)=>n+Number(c.amount),0)-expenses.filter(e=>e.approved!==false).reduce((n,e)=>n+Number(e.amount),0));
}
export function handoverValid(amount: number, expected: number, reason: string) { return Number.isFinite(amount) && amount >= 0 && (amount === expected || !!reason.trim()); }