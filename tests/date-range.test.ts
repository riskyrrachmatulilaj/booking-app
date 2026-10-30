import { expect, it } from 'vitest';
import { businessDateRange } from '../src/components/date-range';
it('includes Jakarta early morning across UTC date boundary', () => {
  const { from, to } = businessDateRange('2030-11-02', 'Asia/Jakarta');
  expect(from).toBe('2030-11-01T17:00:00.000Z');
  expect(to).toBe('2030-12-01T17:00:00.000Z');
  expect(new Date('2030-11-01T23:00:00Z') >= new Date(from)).toBe(true);
});
it('converts both local boundaries independently across DST', () => {
  expect(businessDateRange('2030-03-01', 'America/New_York')).toEqual({ from: '2030-03-01T05:00:00.000Z', to: '2030-03-31T04:00:00.000Z' });
});
