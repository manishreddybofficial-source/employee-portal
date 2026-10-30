import { describe, expect, it } from 'vitest';
import { allRows } from '../src/lib/supabase';

describe('complete reports', () => {
  it('fetches beyond the API row limit without losing rows', async () => {
    const records = Array.from({ length: 1203 }, (_, id) => ({ id }));
    const ranges: number[][] = [];
    const result = await allRows(async (first, last) => {
      ranges.push([first, last]);
      return { data: records.slice(first, last + 1), error: null };
    });
    expect(result).toEqual(records);
    expect(ranges).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
    ]);
  });
  it('fails rather than returning an incomplete report if a later page fails', async () => {
    await expect(
      allRows(async (first) =>
        first === 0
          ? { data: Array.from({ length: 500 }), error: null }
          : { data: null, error: { message: 'Connection interrupted' } },
      ),
    ).rejects.toThrow('Connection interrupted');
  });
});
