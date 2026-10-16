import { describe, expect, it } from 'vitest';
import { collectDefaults } from './defaults';
import type { FormDoc } from './types';

const doc: FormDoc = {
  schema: { type: 'object', properties: [{ name: 'p', type: 'object', title: 'P', properties: [
    { name: 'a', type: 'string', title: 'A', default: 'Managing Partner' },
    { name: 'b', type: 'number', title: 'B', default: 5 },
    { name: 'c', type: 'string', title: 'C' },
    { name: 'h', type: 'null', title: 'H', default: 'ignored' },
    { name: 'rep', type: 'array', title: 'Rep', properties: [{ name: 'r', type: 'string', title: 'R', default: 'x' }] },
  ] }] },
  uiSchema: {
    p: { 'ui:widget': 'Page' }, a: { 'ui:widget': 'TextBox' }, b: { 'ui:widget': 'Integer' }, c: { 'ui:widget': 'TextBox' },
    h: { 'ui:widget': 'Header' }, rep: { 'ui:widget': 'Repeatable' }, r: { 'ui:widget': 'TextBox' },
  },
};

describe('collectDefaults', () => {
  it('takes string and number defaults of input fields only, outside repeatables', () => {
    expect(collectDefaults(doc)).toEqual({ a: 'Managing Partner', b: 5 });
  });
});
