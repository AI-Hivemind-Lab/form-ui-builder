import { describe, expect, it } from 'vitest';
import { addRow, DEFAULT_MAX_ITEMS, getRows, maxItemsOf, removeRow, setRowValue } from './rows';
import type { FormDoc } from './types';

const docWith = (max: unknown): FormDoc => ({
  schema: { type: 'object', properties: [{ name: 'rep', type: 'array', title: 'Rep', properties: [] }] },
  uiSchema: { rep: { 'ui:widget': 'Repeatable', 'ui:maxLength': max } },
});

describe('maxItemsOf (Review Focus 3: bad maxItems)', () => {
  it.each([[3, 3], ['4', 4], [1, 1], [10, 10]])('reads %j as %j', (v, n) => expect(maxItemsOf(docWith(v), 'rep')).toBe(n));
  it.each([0, -1, 2.5, 'abc', '', null, undefined, NaN, {}])('falls back to the default for %j', (v) => {
    expect(maxItemsOf(docWith(v), 'rep')).toBe(DEFAULT_MAX_ITEMS);
  });
  it('falls back to the default when there is no ui entry at all', () => {
    expect(maxItemsOf({ schema: { type: 'object', properties: [] }, uiSchema: {} }, 'nope')).toBe(1);
  });
});

describe('getRows', () => {
  it('shows one empty row when unset, empty, or the wrong shape', () => {
    for (const v of [undefined, [], 'x', 5, null, {}]) expect(getRows({ rep: v }, 'rep')).toEqual([{}]);
  });
  it('returns stored rows and replaces non-object rows with {}', () => {
    expect(getRows({ rep: [{ a: 1 }, 'bad', null, [1]] }, 'rep')).toEqual([{ a: 1 }, {}, {}, {}]);
  });
});

describe('addRow / removeRow / setRowValue', () => {
  it('addRow materialises the default row then appends, up to the max', () => {
    let v = addRow({}, 'rep', 3);
    expect(v.rep).toEqual([{}, {}]);
    v = addRow(v, 'rep', 3);
    expect(v.rep).toHaveLength(3);
    const same = addRow(v, 'rep', 3);
    expect(same).toBe(v);
  });
  it('addRow is a no-op when the max is already exceeded (max lowered below the row count)', () => {
    const v = { rep: [{}, {}, {}] };
    expect(addRow(v, 'rep', 2)).toBe(v);
  });
  it('removeRow removes by index but never the last row, and ignores bad indexes', () => {
    const v = { rep: [{ a: 1 }, { a: 2 }] };
    expect(removeRow(v, 'rep', 0).rep).toEqual([{ a: 2 }]);
    const one = { rep: [{ a: 1 }] };
    expect(removeRow(one, 'rep', 0)).toBe(one);
    expect(removeRow(v, 'rep', 5)).toBe(v);
    expect(removeRow(v, 'rep', -1)).toBe(v);
    const unset = {};
    expect(removeRow(unset, 'rep', 0)).toBe(unset);
  });
  it('setRowValue writes one field of one row without touching others, materialising an unset array', () => {
    const v = setRowValue({}, 'rep', 0, 'name', 'Ann');
    expect(v.rep).toEqual([{ name: 'Ann' }]);
    const two = { rep: [{ name: 'a' }, { name: 'b' }] };
    const next = setRowValue(two, 'rep', 1, 'name', 'z');
    expect(next.rep).toEqual([{ name: 'a' }, { name: 'z' }]);
    expect(two.rep).toEqual([{ name: 'a' }, { name: 'b' }]);
    expect(setRowValue(two, 'rep', 9, 'name', 'q')).toBe(two);
  });
});
