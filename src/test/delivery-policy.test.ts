import { describe,it,expect } from 'vitest';
import { DELIVERY_DEFAULTS,distanceMetres,expectedCrates,splitCollection,tripKm } from '../lib/delivery-policy';
describe('Prompt-50 rules',()=>{
 it('arrival limit defaults to 300 metres',()=>expect(DELIVERY_DEFAULTS.arrival_distance_limit_m).toBe(300));
 it('no customer location skips the distance check',()=>expect(distanceMetres(18,76,null,null)).toBeNull());
 it('measures arrival beyond the limit',()=>expect(distanceMetres(18,76,18.006,76)).toBeGreaterThan(300));
 it('crates default off',()=>expect(DELIVERY_DEFAULTS.crates_at_customer_enabled).toBe(false));
 it('expired returns default off',()=>expect(DELIVERY_DEFAULTS.expired_returns_enabled).toBe(false));
 it('expected crates = loaded - left + picked up',()=>expect(expectedCrates(20,4,2)).toBe(18));
 it('collects this bill first and remaining towards old bills',()=>expect(splitCollection(350,200)).toEqual({current:200,old:150}));
 it('partial amount stays on the current bill',()=>expect(splitCollection(100,200)).toEqual({current:100,old:0}));
 it('km is end minus start',()=>expect(tripKm(1000,1065)).toBe(65));
});