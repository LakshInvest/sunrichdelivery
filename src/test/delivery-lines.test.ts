import { describe, expect, it } from 'vitest';
import { deliveredLineTotal, schemeName } from '@/lib/delivery-lines';
describe('scheme quantities and money', () => {
  it('mixed normal and FREE lines charge only the stored normal line total', () => {
    const normal = {qty: 3, line_total: 137.25, value: 300};
    const free = {qty: 2, line_total: 0, is_free: true};
    expect(deliveredLineTotal(normal, 3) + deliveredLineTotal(free, 2)).toBe(137.25);
  });
  it('FREE replacement remains zero even with a legacy value', () => {
    expect(deliveredLineTotal({qty: 2, line_total: 0, value: 200, is_free: true}, 2)).toBe(0);
  });
  it('partial normal delivery prorates its stored discounted total', () => {
    expect(deliveredLineTotal({qty: 4, line_total: 330, value: 440}, 3)).toBe(247.5);
  });
  it('reads the scheme name from supplied scheme information', () => {
    expect(schemeName({scheme_name: 'QA scheme'})).toBe('QA scheme');
  });
});