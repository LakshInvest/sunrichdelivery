import {describe,it,expect} from 'vitest';
import {partialReasonRequired,paymentResolved,cashToHandover,handoverValid} from '@/lib/payment-policy';
describe('Prompt-54 payment completion',()=>{
 it('COD ₹1600 without payment cannot complete',()=>expect(paymentResolved('cod',1600)).toBe(false));
 it('credit skips payment',()=>expect(paymentResolved('credit',1600)).toBe(true));
 it('FREE order needs no cash',()=>expect(paymentResolved('cod',0)).toBe(true));
 it('₹880 of ₹1600 requires a reason',()=>expect(partialReasonRequired(880,1600)).toBe(true));
 it('partial resolution without reason cannot complete',()=>expect(paymentResolved('cod',720,'partial','')).toBe(false));
 it('recorded partial payment with reason completes',()=>expect(paymentResolved('cod',720,'partial','Customer paid part')).toBe(true));
 it('cash handover ignores UPI and subtracts cash expenses',()=>expect(cashToHandover([{mode:'cash',amount:1600},{mode:'upi',amount:400}],[{amount:120}])).toBe(1480));
 it('different ₹880 handover requires reason',()=>{expect(handoverValid(880,1600,'')).toBe(false);expect(handoverValid(880,1600,'cash loss')).toBe(true);});
});