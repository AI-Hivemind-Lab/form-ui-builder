import { describe, expect, it } from 'vitest';
import { belowMap, candidatesForBelow, fieldsBelowOf, isFieldBelow, withFieldBelow, withoutFieldBelow } from './fieldsBelow';
import type { FormDoc, Option } from './types';

const leaf = (name: string) => ({ name, type: 'string' as const, title: `T ${name}` });
const opt = (value: string, below?: string[]) => [value, { formattedText: `<p>${value}</p>`, ...(below ? { fieldsBelow: below } : {}) }];

const doc = (): FormDoc => ({
  schema: {
    type: 'object',
    properties: [
      { name: 'pg', type: 'object', title: 'Page', properties: [
        leaf('radio1'),
        leaf('s1'), leaf('s2'), leaf('s3'),
        { name: 'grp', type: 'object', title: 'Group', properties: [leaf('radio2'), leaf('g1')] },
        leaf('dd'),
      ] },
    ],
  },
  uiSchema: {
    pg: { 'ui:widget': 'Page' },
    radio1: { 'ui:widget': 'Radio', 'ui:multipleOption': { options: [opt('a', ['s1', 's2']), opt('b', ['s3'])] } },
    s1: { 'ui:widget': 'TextBox' }, s2: { 'ui:widget': 'TextBox' }, s3: { 'ui:widget': 'TextBox' },
    grp: { 'ui:widget': 'Group' },
    radio2: { 'ui:widget': 'MultipleCheckbox', 'ui:multipleOption': { options: [opt('x'), opt('y')] } },
    g1: { 'ui:widget': 'TextBox' },
    dd: { 'ui:widget': 'Dropdown', 'ui:multipleOption': { options: [opt('p', ['g1'])] } },
  },
});

describe('belowMap (a field below belongs to ONE parent option)', () => {
  it('maps each tagged child to its parent field and option', () => {
    const m = belowMap(doc());
    expect(m.get('s1')).toEqual({ parent: 'radio1', option: 'a' });
    expect(m.get('s2')).toEqual({ parent: 'radio1', option: 'a' });
    expect(m.get('s3')).toEqual({ parent: 'radio1', option: 'b' });
  });
  it('only honours Radio and MultipleCheckbox parents (a Dropdown or MultipleSuggest never has fields below)', () => {
    const m = belowMap(doc());
    expect(m.has('g1')).toBe(false);
    const d = doc();
    d.uiSchema.ms = { 'ui:widget': 'MultipleSuggest', 'ui:multipleOption': { options: [opt('q', ['g1'])] } };
    expect(belowMap(d).has('g1')).toBe(false);
  });
  it('if a child is tagged twice (bad data) the first tag wins', () => {
    const d = doc();
    d.uiSchema.radio2['ui:multipleOption'] = { options: [opt('x', ['s1']), opt('y')] };
    expect(belowMap(d).get('s1')).toEqual({ parent: 'radio1', option: 'a' });
  });
  it('ignores malformed option metadata and is cached per uiSchema identity', () => {
    const d = doc();
    d.uiSchema.radio2['ui:multipleOption'] = { options: [null, ['x', null], ['y', { fieldsBelow: 'nope' }], 5] };
    expect(() => belowMap(d)).not.toThrow();
    const d2 = doc();
    expect(belowMap(d2)).toBe(belowMap(d2));
  });
  it('isFieldBelow reflects the map', () => {
    expect(isFieldBelow(doc(), 's1')).toBe(true);
    expect(isFieldBelow(doc(), 'g1')).toBe(false);
  });
});

describe('fieldsBelowOf', () => {
  it('lists the existing nodes tagged to an option, in order', () => {
    expect(fieldsBelowOf(doc(), 'radio1', 'a')).toEqual(['s1', 's2']);
    expect(fieldsBelowOf(doc(), 'radio1', 'b')).toEqual(['s3']);
  });
  it('drops names that do not exist in the schema, and returns [] for unknown parents/options/non-choice parents', () => {
    const d = doc();
    d.uiSchema.radio1['ui:multipleOption'] = { options: [opt('a', ['s1', 'ghost'])] };
    expect(fieldsBelowOf(d, 'radio1', 'a')).toEqual(['s1']);
    expect(fieldsBelowOf(doc(), 'radio1', 'zzz')).toEqual([]);
    expect(fieldsBelowOf(doc(), 'nope', 'a')).toEqual([]);
    expect(fieldsBelowOf(doc(), 'dd', 'p')).toEqual([]);
  });
});

describe('candidatesForBelow', () => {
  const names = (parent: string, d = doc()) => candidatesForBelow(d, parent).map((n) => n.name);
  it('offers untagged fields, siblings of the parent first', () => {
    // radio1's siblings: s1,s2,s3 (tagged), grp, dd ; everything else comes after
    expect(names('radio1')).toEqual(['grp', 'dd', 'radio2', 'g1']);
  });
  it('never offers the parent itself, its ancestors, Pages, or fields already tagged to any option', () => {
    const n = names('radio2');
    expect(n).not.toContain('radio2');
    expect(n).not.toContain('grp');
    expect(n).not.toContain('pg');
    expect(n).not.toContain('s1');
  });
  it('offers a field again once it is untagged', () => {
    const d = doc();
    d.uiSchema.radio1['ui:multipleOption'] = { options: [opt('a', ['s1']), opt('b')] };
    expect(names('radio1', d)).toContain('s2');
    expect(names('radio1', d)).toContain('s3');
    expect(names('radio1', d)).not.toContain('s1');
  });
  it('works for a parent that is not in the schema yet (the Add form)', () => {
    const n = names('brand_new');
    expect(n).toContain('grp');
    expect(n).not.toContain('pg');
    expect(n).not.toContain('s1');
  });
});

describe('withFieldBelow / withoutFieldBelow on an options list', () => {
  const options = (): Option[] => [{ value: 'a', label: 'A', fieldsBelow: ['s1'] }, { value: 'b', label: 'B' }];
  it('adds a child to an option without duplicating it', () => {
    const next = withFieldBelow(options(), 'b', 's9');
    expect(next[1].fieldsBelow).toEqual(['s9']);
    expect(withFieldBelow(next, 'b', 's9')[1].fieldsBelow).toEqual(['s9']);
  });
  it('moves a child that was on another option of the same field (one parent option only)', () => {
    const next = withFieldBelow(options(), 'b', 's1');
    expect(next[0].fieldsBelow).toEqual([]);
    expect(next[1].fieldsBelow).toEqual(['s1']);
  });
  it('lets one option hold several children, in the order added', () => {
    let next = withFieldBelow(options(), 'a', 's2');
    next = withFieldBelow(next, 'a', 's3');
    expect(next[0].fieldsBelow).toEqual(['s1', 's2', 's3']);
  });
  it('removes a child and clears the list when it was the last', () => {
    const next = withoutFieldBelow(options(), 'a', 's1');
    expect(next[0].fieldsBelow).toEqual([]);
    expect(withoutFieldBelow(options(), 'a', 'nope')[0].fieldsBelow).toEqual(['s1']);
  });
  it('ignores an unknown option value and never mutates its input', () => {
    const o = options();
    expect(withFieldBelow(o, 'zzz', 's5')).toEqual(o);
    withFieldBelow(o, 'b', 's5');
    expect(o[1].fieldsBelow).toBeUndefined();
  });
});
