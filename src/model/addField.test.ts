import { describe, expect, it } from 'vitest';
import {
  allNames, buildNewField, canContain, defaultNameAndTitle, findParentName, insertNode, locationOptions,
  canSwitchTo, replaceNode, resolveInsertion, sameLocation, switchWidget, validateName,
} from './addField';
import { getOptions } from './editOps';
import type { FormDoc } from './types';

const doc = (): FormDoc => ({
  schema: {
    type: 'object',
    properties: [
      { name: 'p', type: 'object', title: 'Page one', properties: [
        { name: 'a', type: 'string', title: 'A' },
        { name: 'grp', type: 'object', title: 'Group', properties: [{ name: 'g1', type: 'string', title: 'G1' }] },
        { name: 'rep', type: 'array', title: 'Rep', properties: [{ name: 'r1', type: 'string', title: 'R1' }] },
      ] },
      { name: 'q', type: 'object', title: 'Page two', properties: [] },
    ],
  },
  uiSchema: {
    p: { 'ui:widget': 'Page' }, a: { 'ui:widget': 'TextBox' }, grp: { 'ui:widget': 'Group' }, g1: { 'ui:widget': 'TextBox' },
    rep: { 'ui:widget': 'Repeatable' }, r1: { 'ui:widget': 'TextBox' }, q: { 'ui:widget': 'Page' }, ghost: { 'ui:widget': 'TextBox' },
  },
});

describe('names (Review Focus 1)', () => {
  it('collects schema node names and uiSchema-only keys', () => {
    const n = allNames(doc());
    for (const k of ['p', 'a', 'grp', 'g1', 'rep', 'r1', 'q', 'ghost']) expect(n.has(k), k).toBe(true);
  });
  it('accepts a good name', () => {
    expect(validateName(doc(), 'owner_name2')).toBeNull();
  });
  it.each([
    ['', /required/i], ['  ', /required/i], ['1abc', /letter/i], ['a b', /letter|only/i], ['a-b', /letter|only/i],
    ['a', /already/i], ['grp', /already/i], ['ghost', /already/i],
    ['constructor', /reserved/i], ['toString', /reserved/i], ['hasOwnProperty', /reserved/i], ['__proto__', /letter|only/i],
  ])('rejects %j', (name, re) => {
    expect(validateName(doc(), name)).toMatch(re);
  });
  it('defaults to the first unused <widget><n> with a matching title', () => {
    expect(defaultNameAndTitle(doc(), 'TextBox')).toEqual({ name: 'textbox1', title: 'TextBox 1' });
    const d = doc();
    d.uiSchema.textbox1 = {};
    d.uiSchema.textbox2 = {};
    expect(defaultNameAndTitle(d, 'TextBox')).toEqual({ name: 'textbox3', title: 'TextBox 3' });
    expect(defaultNameAndTitle(doc(), 'CustomFormat')).toEqual({ name: 'customformat1', title: 'Custom format 1' });
    expect(defaultNameAndTitle(doc(), 'Pdf')).toEqual({ name: 'pdf1', title: 'Pdf/Word 1' });
  });
});

describe('buildNewField', () => {
  it('builds a labelled input with schema type, widget and margin', () => {
    const { node, ui } = buildNewField(doc(), 'Money');
    expect(node).toMatchObject({ name: 'money1', type: 'number', title: 'Money 1' });
    expect(ui['ui:widget']).toBe('Money');
    expect(ui['ui:formattedText']).toBe('<p>Money 1</p>');
    expect(ui['ui:marginBottom']).toBe('12px');
  });
  it('adds a date format for Date', () => {
    expect(buildNewField(doc(), 'Date').node.format).toBe('date');
  });
  it('seeds options for choice widgets, and the Repeatable defaults and an empty children list', () => {
    const radio = buildNewField(doc(), 'Radio');
    expect(getOptions(radio.ui, radio.node).map((o) => o.label)).toEqual(['Option 1', 'Option 2']);
    const rep = buildNewField(doc(), 'Repeatable');
    expect(rep.node.properties).toEqual([]);
    expect(rep.ui).toMatchObject({ 'ui:maxLength': 1, 'ui:formattedText': '<p>Repeatable 1</p>' });
  });
  it('does not label Header, Page or Group', () => {
    for (const id of ['Header', 'Page', 'Group']) expect(buildNewField(doc(), id).ui['ui:formattedText']).toBeUndefined();
    expect(buildNewField(doc(), 'Header').ui['ui:heading']).toBe('Heading');
    expect(buildNewField(doc(), 'Page').node.properties).toEqual([]);
  });
  it('throws on an unknown widget id', () => {
    expect(() => buildNewField(doc(), 'Bogus')).toThrow();
  });
});

describe('switchWidget (Review Focus 5)', () => {
  it('updates the schema type/format and the widget id', () => {
    const { node, ui } = buildNewField(doc(), 'TextBox');
    const toInt = switchWidget(node, ui, 'Integer');
    expect(toInt.node.type).toBe('number');
    expect(toInt.ui['ui:widget']).toBe('Integer');
    const toDate = switchWidget(toInt.node, toInt.ui, 'Date');
    expect(toDate.node).toMatchObject({ type: 'string', format: 'date' });
    const back = switchWidget(toDate.node, toDate.ui, 'TextBox');
    expect('format' in back.node).toBe(false);
  });
  it('seeds options when switching to a choice widget with none, and Repeatable defaults for a Group', () => {
    const tb = buildNewField(doc(), 'TextBox');
    const radio = switchWidget(tb.node, tb.ui, 'Radio');
    expect(getOptions(radio.ui, radio.node)).toHaveLength(2);
    const g = buildNewField(doc(), 'Group');
    const r = switchWidget(g.node, g.ui, 'Repeatable');
    expect(r.node.type).toBe('array');
    expect(r.node.properties).toEqual([]);
    expect(r.ui).toMatchObject({ 'ui:maxLength': 1 });
  });
  it('keeps existing Repeatable settings and children', () => {
    const node = { name: 'g', type: 'object' as const, title: 'G', properties: [{ name: 'c', type: 'string' as const, title: 'C' }] };
    const r = switchWidget(node, { 'ui:widget': 'Group', 'ui:maxLength': 4 }, 'Repeatable');
    expect(r.ui['ui:maxLength']).toBe(4);
    expect(r.node.properties).toHaveLength(1);
  });
  it('does not mutate its inputs', () => {
    const { node, ui } = buildNewField(doc(), 'TextBox');
    switchWidget(node, ui, 'Integer');
    expect(node.type).toBe('string');
    expect(ui['ui:widget']).toBe('TextBox');
  });
});

describe('parents and containment (Review Focus 2)', () => {
  it('finds parents', () => {
    expect(findParentName(doc(), 'a')).toBe('p');
    expect(findParentName(doc(), 'g1')).toBe('grp');
    expect(findParentName(doc(), 'p')).toBeNull();
    expect(findParentName(doc(), 'nope')).toBeUndefined();
  });
  it('lets fields into Page/Group/Repeatable but never a Page below the top, or a Repeatable inside a Repeatable', () => {
    expect(canContain(doc(), 'p', 'TextBox')).toBe(true);
    expect(canContain(doc(), 'grp', 'Repeatable')).toBe(true);
    expect(canContain(doc(), 'rep', 'TextBox')).toBe(true);
    expect(canContain(doc(), 'rep', 'Repeatable')).toBe(false);
    expect(canContain(doc(), 'p', 'Page')).toBe(false);
  });
  it('blocks a Repeatable inside a Group that sits inside a Repeatable', () => {
    const d = doc();
    d.schema.properties[0].properties![2].properties!.push({ name: 'inner', type: 'object', title: 'Inner', properties: [] });
    d.uiSchema.inner = { 'ui:widget': 'Group' };
    expect(canContain(d, 'inner', 'Repeatable')).toBe(false);
    expect(canContain(d, 'inner', 'TextBox')).toBe(true);
  });
});

describe('resolveInsertion (Review Focus 2)', () => {
  it('goes after the selected field in its parent', () => {
    expect(resolveInsertion(doc(), 'TextBox', 'a', 'p')).toEqual({ parent: 'p', after: 'a' });
    expect(resolveInsertion(doc(), 'TextBox', 'g1', 'p')).toEqual({ parent: 'grp', after: 'g1' });
  });
  it('goes inside a selected Repeatable (at the end) for non-Repeatable widgets', () => {
    expect(resolveInsertion(doc(), 'TextBox', 'rep', 'p')).toEqual({ parent: 'rep', after: null });
  });
  it('never nests a Repeatable: after the selected Repeatable, or the end of the active page from inside one', () => {
    expect(resolveInsertion(doc(), 'Repeatable', 'rep', 'p')).toEqual({ parent: 'p', after: 'rep' });
    expect(resolveInsertion(doc(), 'Repeatable', 'r1', 'p')).toEqual({ parent: 'p', after: null });
  });
  it('uses the end of the active page with no selection, and the first page if the active one is missing', () => {
    expect(resolveInsertion(doc(), 'TextBox', null, 'q')).toEqual({ parent: 'q', after: null });
    expect(resolveInsertion(doc(), 'TextBox', null, null)).toEqual({ parent: 'p', after: null });
    expect(resolveInsertion(doc(), 'TextBox', 'nope', 'zzz')).toEqual({ parent: 'p', after: null });
  });
  it('puts a Page after the active page, or at the end', () => {
    expect(resolveInsertion(doc(), 'Page', 'a', 'p')).toEqual({ parent: null, after: 'p' });
    expect(resolveInsertion(doc(), 'Page', null, null)).toEqual({ parent: null, after: 'q' });
  });
  it('appends at the top level when the doc has no pages', () => {
    const none: FormDoc = { schema: { type: 'object', properties: [{ name: 'x', type: 'string', title: 'X' }] }, uiSchema: { x: { 'ui:widget': 'TextBox' } } };
    expect(resolveInsertion(none, 'TextBox', null, null)).toEqual({ parent: null, after: null });
    expect(resolveInsertion(none, 'TextBox', 'x', null)).toEqual({ parent: null, after: 'x' });
  });
});

describe('locationOptions', () => {
  const ids = (id: string, sel: string | null, page: string | null) => locationOptions(doc(), id, sel, page).map((o) => o.id);
  it('lists after-selected first, then every container that can hold the widget', () => {
    expect(ids('TextBox', 'a', 'p')).toEqual(['after:a', 'in:p', 'in:grp', 'in:rep', 'in:q']);
  });
  it('omits Repeatable targets when adding a Repeatable', () => {
    expect(ids('Repeatable', 'a', 'p')).toEqual(['after:a', 'in:p', 'in:grp', 'in:q']);
  });
  it('lists only page positions for a Page', () => {
    expect(ids('Page', 'a', 'p')).toEqual(['after:p', 'after:q', 'end']);
  });
  it('offers the end of the form when there are no pages', () => {
    const none: FormDoc = { schema: { type: 'object', properties: [] }, uiSchema: {} };
    expect(locationOptions(none, 'TextBox', null, null).map((o) => o.id)).toEqual(['end']);
  });
  it('labels containers with their titles and the default option matches resolveInsertion', () => {
    const opts = locationOptions(doc(), 'TextBox', 'a', 'p');
    expect(opts.find((o) => o.id === 'in:grp')?.label).toBe('Inside "Group"');
    expect(opts.find((o) => o.id === 'in:p')?.label).toBe('End of "Page one"');
    const def = resolveInsertion(doc(), 'TextBox', 'a', 'p');
    expect(opts.some((o) => sameLocation(o.loc, def))).toBe(true);
  });
});

describe('insertNode (Review Focus 2)', () => {
  const field = { name: 'newf', type: 'string' as const, title: 'New' };
  const ui = { 'ui:widget': 'TextBox' };
  const names = (d: FormDoc, parent: string) => d.schema.properties.find((n) => n.name === parent)!.properties!.map((n) => n.name);

  it('inserts after a sibling and records the ui entry', () => {
    const d = insertNode(doc(), field, ui, { parent: 'p', after: 'a' });
    expect(names(d, 'p')).toEqual(['a', 'newf', 'grp', 'rep']);
    expect(d.uiSchema.newf).toEqual(ui);
  });
  it('appends when `after` is null or unknown, including after the last child', () => {
    expect(names(insertNode(doc(), field, ui, { parent: 'p', after: null }), 'p')).toEqual(['a', 'grp', 'rep', 'newf']);
    expect(names(insertNode(doc(), field, ui, { parent: 'p', after: 'rep' }), 'p')).toEqual(['a', 'grp', 'rep', 'newf']);
    expect(names(insertNode(doc(), field, ui, { parent: 'p', after: 'zzz' }), 'p')).toEqual(['a', 'grp', 'rep', 'newf']);
  });
  it('inserts into an empty page and into nested containers', () => {
    expect(names(insertNode(doc(), field, ui, { parent: 'q', after: null }), 'q')).toEqual(['newf']);
    const d = insertNode(doc(), field, ui, { parent: 'grp', after: 'g1' });
    expect(d.schema.properties[0].properties![1].properties!.map((n) => n.name)).toEqual(['g1', 'newf']);
    const r = insertNode(doc(), field, ui, { parent: 'rep', after: null });
    expect(r.schema.properties[0].properties![2].properties!.map((n) => n.name)).toEqual(['r1', 'newf']);
  });
  it('inserts a Page at the top level between pages', () => {
    const page = { name: 'mid', type: 'object' as const, title: 'Mid', properties: [] };
    const d = insertNode(doc(), page, { 'ui:widget': 'Page' }, { parent: null, after: 'p' });
    expect(d.schema.properties.map((n) => n.name)).toEqual(['p', 'mid', 'q']);
  });
  it('does not mutate the original doc', () => {
    const d0 = doc();
    insertNode(d0, field, ui, { parent: 'p', after: 'a' });
    expect(names(d0, 'p')).toEqual(['a', 'grp', 'rep']);
    expect(d0.uiSchema.newf).toBeUndefined();
  });
  it('throws on a duplicate name or an unknown parent', () => {
    expect(() => insertNode(doc(), { ...field, name: 'a' }, ui, { parent: 'p', after: null })).toThrow(/already/i);
    expect(() => insertNode(doc(), field, ui, { parent: 'nope', after: null })).toThrow(/parent/i);
  });
});

describe('replaceNode', () => {
  it('replaces a nested node by name, immutably', () => {
    const d = doc();
    const next = replaceNode(d.schema, { name: 'g1', type: 'number', title: 'G1' });
    expect(next.properties[0].properties![1].properties![0].type).toBe('number');
    expect(d.schema.properties[0].properties![1].properties![0].type).toBe('string');
  });
  it('returns an equal schema when the node is unknown', () => {
    expect(replaceNode(doc().schema, { name: 'zzz', type: 'string', title: 'Z' })).toEqual(doc().schema);
  });
});

describe('no Repeatable inside a Repeatable (review finding #1)', () => {
  const repNode = { name: 'rep2', type: 'array' as const, title: 'Rep 2', properties: [] };
  const repUi = { 'ui:widget': 'Repeatable' };

  it('insertNode refuses a Repeatable placed in a Repeatable, directly or via a Group', () => {
    expect(() => insertNode(doc(), repNode, repUi, { parent: 'rep', after: null })).toThrow(/Repeatable/);
    const d = doc();
    d.schema.properties[0].properties![2].properties!.push({ name: 'inner', type: 'object', title: 'Inner', properties: [] });
    d.uiSchema.inner = { 'ui:widget': 'Group' };
    expect(() => insertNode(d, repNode, repUi, { parent: 'inner', after: null })).toThrow(/Repeatable/);
  });
  it('insertNode still allows a Repeatable in a Page or a plain Group', () => {
    expect(() => insertNode(doc(), repNode, repUi, { parent: 'p', after: null })).not.toThrow();
    expect(() => insertNode(doc(), repNode, repUi, { parent: 'grp', after: null })).not.toThrow();
  });
  it('canSwitchTo blocks Repeatable for a Group inside a Repeatable', () => {
    const d = doc();
    d.schema.properties[0].properties![2].properties!.push({ name: 'inner', type: 'object', title: 'Inner', properties: [] });
    d.uiSchema.inner = { 'ui:widget': 'Group' };
    expect(canSwitchTo(d, 'inner', 'Repeatable')).toBe(false);
    expect(canSwitchTo(d, 'grp', 'Repeatable')).toBe(true);
  });
  it('canSwitchTo blocks Repeatable for a Group that already contains a Repeatable', () => {
    const d = doc();
    d.schema.properties[0].properties![1].properties!.push({ name: 'deep', type: 'array', title: 'Deep', properties: [] });
    d.uiSchema.deep = { 'ui:widget': 'Repeatable' };
    expect(canSwitchTo(d, 'grp', 'Repeatable')).toBe(false);
  });
  it('canSwitchTo allows every other switch and unknown nodes', () => {
    expect(canSwitchTo(doc(), 'a', 'Integer')).toBe(true);
    expect(canSwitchTo(doc(), 'grp', 'Group')).toBe(true);
    expect(canSwitchTo(doc(), 'nope', 'Repeatable')).toBe(true);
  });
});

describe('insertion with a nested active page', () => {
  const sec = (): FormDoc => ({
    schema: {
      type: 'object',
      properties: [
        { name: 'sec', type: 'object', title: 'Section', properties: [
          { name: 'pa', type: 'object', title: 'PA', properties: [{ name: 'x', type: 'string', title: 'X' }] },
        ] },
        { name: 'top', type: 'object', title: 'Top', properties: [] },
      ],
    },
    uiSchema: { sec: { 'ui:widget': 'Group' }, pa: { 'ui:widget': 'Page' }, x: { 'ui:widget': 'TextBox' }, top: { 'ui:widget': 'Page' } },
  });
  it('adds a field to the end of the active nested page', () => {
    expect(resolveInsertion(sec(), 'TextBox', null, 'pa')).toEqual({ parent: 'pa', after: null });
  });
  it('places a new Page at the top level after the active nested page\'s section', () => {
    expect(resolveInsertion(sec(), 'Page', null, 'pa')).toEqual({ parent: null, after: 'sec' });
  });
  it('lists nested pages and sections as targets', () => {
    const ids = locationOptions(sec(), 'TextBox', null, 'pa').map((o) => o.id);
    expect(ids).toEqual(['in:sec', 'in:pa', 'in:top']);
  });
});
