import { describe, expect, it } from 'vitest';
import { anchorsFor, aliasesOf } from './pdfAnchors';
import type { FormDoc } from './types';

const box = (page: number) => ({ page, left: 0.1, top: 0.2, right: 0.5, bottom: 0.3 });
const doc: FormDoc = {
  schema: { type: 'object', properties: [{ name: 'p', type: 'object', title: 'P', properties: [
    { name: 't', type: 'string', title: 'T' },
    { name: 'r', type: 'string', title: 'R' },
    { name: 'rep', type: 'array', title: 'Rep', properties: [{ name: 'rc', type: 'string', title: 'RC' }] },
    { name: 'g', type: 'object', title: 'G', properties: [] },
  ] }] },
  uiSchema: {
    p: { 'ui:widget': 'Page' }, t: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['a'] },
    r: { 'ui:widget': 'Radio', 'ui:pdfMapping': ['grp'], 'ui:multipleOption': { options: [['x', { pdfMappings: ['o1'] }], ['y', { pdfMappings: ['o2'] }]] } },
    rep: { 'ui:widget': 'Repeatable' }, rc: { 'ui:widget': 'TextBox', 'ui:pdfMapping': ['row1', 'row2'] }, g: { 'ui:widget': 'Group' },
  },
};
const node = (n: string) => doc.schema.properties[0].properties!.find((x) => x.name === n)!;

describe('pdf anchors', () => {
  it('collects aliases from the field, its options and a repeatable row', () => {
    expect(aliasesOf(doc, node('t'))).toEqual(['a']);
    expect(aliasesOf(doc, node('r'))).toEqual(['grp', 'o1', 'o2']);
    expect(aliasesOf(doc, node('rep'))).toEqual(['row1', 'row2']);
    expect(aliasesOf(doc, node('g'))).toEqual([]);
  });
  it('returns only the boxes that exist', () => {
    const anchors = { a: box(1), o1: box(2), row2: box(3) };
    expect(anchorsFor(doc, node('t'), anchors)).toEqual([box(1)]);
    expect(anchorsFor(doc, node('r'), anchors)).toEqual([box(2)]);
    expect(anchorsFor(doc, node('rep'), anchors)).toEqual([box(3)]);
    expect(anchorsFor(doc, node('g'), anchors)).toEqual([]);
  });
});
