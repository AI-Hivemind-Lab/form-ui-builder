import { describe, expect, it } from 'vitest';
import {
  buildLabelHtml, parseJsonText,
  getOptions,
  labelText,
  nextOptionValue,
  setInvisible,
  setLabel,
  setOptions,
  setRequired,
  setWidget,
  normalizeCustomKey,
  parseCustomValue,
  setUiKey,
} from './editOps';
import type { SchemaNode, UiSchema } from './types';

const STAR = '<span style="color: rgb(219, 55, 55);">*</span>';
const node: SchemaNode = { name: 'f', type: 'string', title: 'F' };
const base = (): UiSchema => ({
  f: { 'ui:widget': 'TextBox', 'ui:formattedText': `<p>specify percentage ${STAR}</p>`, 'ui:required': 'This field is required' },
});

describe('labelText / buildLabelHtml', () => {
  it('extracts text without the required star', () => {
    expect(labelText(base().f, 'x')).toBe('specify percentage');
  });
  it('falls back when there is no formattedText', () => {
    expect(labelText({}, 'Title')).toBe('Title');
    expect(labelText(undefined, 'Title')).toBe('Title');
  });
  it('builds html with or without the star', () => {
    expect(buildLabelHtml('A', true)).toBe(`<p>A ${STAR}</p>`);
    expect(buildLabelHtml('A', false)).toBe('<p>A</p>');
  });
});

describe('setLabel (Review Focus 3)', () => {
  it('keeps the star when required and does not mutate input', () => {
    const ui = base();
    const next = setLabel(ui, 'f', 'New');
    expect(next.f['ui:formattedText']).toBe(`<p>New ${STAR}</p>`);
    expect(ui.f['ui:formattedText']).toBe(`<p>specify percentage ${STAR}</p>`);
  });
  it('escapes special characters and round-trips them', () => {
    const next = setLabel(base(), 'f', `a < b & "c" <script>`);
    const html = next.f['ui:formattedText'] as string;
    expect(html).not.toContain('<script>');
    expect(labelText(next.f, '')).toBe(`a < b & "c" <script>`);
  });
  it('keeps trailing spaces so a controlled input does not eat them', () => {
    expect(labelText(setLabel(base(), 'f', 'abc ').f, '')).toBe('abc ');
  });
  it('stores Paragraph text escaped, with no star', () => {
    const ui: UiSchema = { p: { 'ui:widget': 'Paragraph', 'ui:formattedText': 'old' } };
    expect(setLabel(ui, 'p', 'a & b').p['ui:formattedText']).toBe('a &amp; b');
  });
  it('creates the entry if missing', () => {
    expect(setLabel({}, 'z', 'Hi').z['ui:formattedText']).toBe('<p>Hi</p>');
  });
});

describe('setRequired / setInvisible', () => {
  it('turns required off and removes the star', () => {
    const next = setRequired(base(), 'f', false);
    expect(next.f['ui:required']).toBeUndefined();
    expect(next.f['ui:formattedText']).toBe('<p>specify percentage</p>');
  });
  it('turns required on and adds the star', () => {
    const off = setRequired(base(), 'f', false);
    const on = setRequired(off, 'f', true);
    expect(on.f['ui:required']).toBe('This field is required');
    expect(on.f['ui:formattedText']).toBe(`<p>specify percentage ${STAR}</p>`);
  });
  it('toggles invisible', () => {
    const on = setInvisible(base(), 'f', true);
    expect(on.f['ui:invisible']).toBe(true);
    expect('ui:invisible' in setInvisible(on, 'f', false).f).toBe(false);
  });
});

describe('options (Review Focus 1)', () => {
  const withOpts: UiSchema = {
    f: { 'ui:multipleOption': { options: [['A', { formattedText: '<p>Class A</p>', blueprintMetadataMapping: '' }], ['B', { formattedText: '<p>Class B</p>' }]] } },
  };
  it('reads options from ui:multipleOption with stripped labels', () => {
    expect(getOptions(withOpts.f, node)).toMatchObject([{ value: 'A', label: 'Class A' }, { value: 'B', label: 'Class B' }]);
  });
  it('falls back to schema enum when ui:multipleOption is absent', () => {
    expect(getOptions({}, { ...node, enum: ['x', 'y'] })).toMatchObject([{ value: 'x', label: 'x' }, { value: 'y', label: 'y' }]);
  });
  it('returns [] when neither exists, and tolerates malformed entries', () => {
    expect(getOptions(undefined, node)).toEqual([]);
    expect(getOptions({ 'ui:multipleOption': { options: [null, 5, [1, 2], ['ok']] } }, node)).toMatchObject([{ value: 'ok', label: 'ok' }]);
  });
  it('setOptions round-trips through getOptions and escapes labels', () => {
    const opts = [{ value: 'a', label: 'A & B' }, { value: 'b', label: 'B' }];
    const next = setOptions({}, 'f', opts);
    expect(getOptions(next.f, node)).toMatchObject(opts);
  });
  it('nextOptionValue picks the first unused option_N', () => {
    expect(nextOptionValue([])).toBe('option_1');
    expect(nextOptionValue([{ value: 'option_1', label: '' }, { value: 'option_3', label: '' }])).toBe('option_2');
  });
});

describe('setWidget', () => {
  it('switches widget and seeds default options for Radio when none exist', () => {
    const next = setWidget(base(), 'f', 'Radio', node);
    expect(next.f['ui:widget']).toBe('Radio');
    expect(getOptions(next.f, node).map((o) => o.label)).toEqual(['Option 1', 'Option 2']);
  });
  it('does not seed when the schema enum already provides options', () => {
    const enumNode = { ...node, enum: ['x'] };
    const next = setWidget(base(), 'f', 'Dropdown', enumNode);
    expect(next.f['ui:multipleOption']).toBeUndefined();
    expect(getOptions(next.f, enumNode)).toHaveLength(1);
  });
  it('does not seed for non-choice widgets', () => {
    expect(setWidget(base(), 'f', 'Money', node).f['ui:multipleOption']).toBeUndefined();
  });
});

describe('rich labels survive edits that do not change the text (Review: flattening)', () => {
  const rich = (): UiSchema => ({
    f: { 'ui:widget': 'TextBox', 'ui:formattedText': `<p>Name of <strong>Transferor</strong> ${STAR}</p>`, 'ui:required': 'This field is required' },
  });
  it('toggling Required off then on keeps the markup', () => {
    const off = setRequired(rich(), 'f', false);
    expect(off.f['ui:formattedText']).toBe('<p>Name of <strong>Transferor</strong></p>');
    const on = setRequired(off, 'f', true);
    expect(on.f['ui:formattedText']).toBe(`<p>Name of <strong>Transferor</strong> ${STAR}</p>`);
  });
  it('setLabel with unchanged text leaves the html untouched', () => {
    const ui = rich();
    expect(setLabel(ui, 'f', 'Name of Transferor').f['ui:formattedText']).toBe(ui.f['ui:formattedText']);
  });
});

describe('setUiKey', () => {
  it('sets a key immutably and deletes it when the value is undefined', () => {
    const ui: UiSchema = { f: { 'ui:widget': 'TextBox' } };
    const next = setUiKey(ui, 'f', 'ui:width', '50%');
    expect(next.f['ui:width']).toBe('50%');
    expect('ui:width' in ui.f).toBe(false);
    expect('ui:width' in setUiKey(next, 'f', 'ui:width', undefined).f).toBe(false);
  });
  it('creates the entry if missing and keeps false/0/empty values', () => {
    expect(setUiKey({}, 'z', 'ui:external', false).z['ui:external']).toBe(false);
    expect(setUiKey({}, 'z', 'ui:maxLength', 0).z['ui:maxLength']).toBe(0);
  });
});

describe('normalizeCustomKey (Review Focus 4)', () => {
  it('auto-prefixes ui: and accepts simple identifiers', () => {
    expect(normalizeCustomKey('foo', [])).toEqual({ ok: true, key: 'ui:foo' });
    expect(normalizeCustomKey(' ui:fooBar_2 ', [])).toEqual({ ok: true, key: 'ui:fooBar_2' });
  });
  it.each(['', '   ', 'ui:', 'a b', '1abc', 'ui:1abc', '__proto__', 'ui:__proto__', 'a.b', 'a-b'])('rejects %j', (raw) => {
    expect(normalizeCustomKey(raw, [])).toMatchObject({ ok: false });
  });
  it('rejects ui:widget and already-taken keys', () => {
    expect(normalizeCustomKey('widget', [])).toMatchObject({ ok: false });
    expect(normalizeCustomKey('ui:widget', [])).toMatchObject({ ok: false });
    expect(normalizeCustomKey('heading', ['ui:heading'])).toMatchObject({ ok: false });
  });
});

describe('parseCustomValue', () => {
  it('keeps JSON types and falls back to a string', () => {
    expect(parseCustomValue('true')).toBe(true);
    expect(parseCustomValue('12')).toBe(12);
    expect(parseCustomValue('["a"]')).toEqual(['a']);
    expect(parseCustomValue('{"a":1}')).toEqual({ a: 1 });
    expect(parseCustomValue('"quoted"')).toBe('quoted');
    expect(parseCustomValue('plain text')).toBe('plain text');
    expect(parseCustomValue('')).toBe('');
    expect(parseCustomValue('[unclosed')).toBe('[unclosed');
  });
});

describe('option order follows the schema enum (real export: the options array can be shuffled)', () => {
  const opt = (v: string) => [v, { formattedText: `<p>${v}</p>`, blueprintMetadataMapping: '' }];
  const shuffled = (): UiSchema => ({ f: { 'ui:multipleOption': { options: [opt('(c) C'), opt('(a) A'), opt('(d) D'), opt('(b) B')] } } });
  const enumNode = (en: string[]): SchemaNode => ({ name: 'f', type: 'string', title: 'F', enum: en });

  it('orders options by enum position, keeping labels from the options list', () => {
    const out = getOptions(shuffled().f, enumNode(['(a) A', '(b) B', '(c) C', '(d) D']));
    expect(out.map((o) => o.value)).toEqual(['(a) A', '(b) B', '(c) C', '(d) D']);
    expect(out.map((o) => o.label)).toEqual(['(a) A', '(b) B', '(c) C', '(d) D']);
  });
  it('keeps the options-list order when the node has no enum', () => {
    expect(getOptions(shuffled().f, node).map((o) => o.value)).toEqual(['(c) C', '(a) A', '(d) D', '(b) B']);
  });
  it('puts options missing from the enum after the enum ones, in their original relative order', () => {
    const ui: UiSchema = { f: { 'ui:multipleOption': { options: [opt('new2'), opt('b'), opt('new1'), opt('a')] } } };
    expect(getOptions(ui.f, enumNode(['a', 'b'])).map((o) => o.value)).toEqual(['a', 'b', 'new2', 'new1']);
  });
  it('only shows options still present in the options list (a removed option stays removed even if the enum has it)', () => {
    const ui: UiSchema = { f: { 'ui:multipleOption': { options: [opt('b'), opt('a')] } } };
    expect(getOptions(ui.f, enumNode(['a', 'b', 'c'])).map((o) => o.value)).toEqual(['a', 'b']);
  });
  it('an option added through setOptions lands at the end of an enum-ordered list', () => {
    const base = shuffled();
    const en = enumNode(['(a) A', '(b) B', '(c) C', '(d) D']);
    const next = setOptions(base, 'f', [...getOptions(base.f, en), { value: 'option_1', label: 'Extra' }]);
    expect(getOptions(next.f, en).map((o) => o.value)).toEqual(['(a) A', '(b) B', '(c) C', '(d) D', 'option_1']);
  });
});

describe('parseJsonText (JSON-valued metadata like ui:dynamicLayout)', () => {
  it('parses objects and arrays', () => {
    expect(parseJsonText('{"sectionsWidth":[70,30],"gutter":8}')).toEqual({ ok: true, value: { sectionsWidth: [70, 30], gutter: 8 } });
    expect(parseJsonText('[1,2]')).toEqual({ ok: true, value: [1, 2] });
  });
  it('treats empty text as "clear the key"', () => {
    expect(parseJsonText('')).toEqual({ ok: true, value: undefined });
    expect(parseJsonText('   ')).toEqual({ ok: true, value: undefined });
  });
  it('flags invalid JSON instead of guessing', () => {
    expect(parseJsonText('{oops')).toEqual({ ok: false });
    expect(parseJsonText('plain')).toEqual({ ok: false });
  });
});

describe('array nodes keep their option order under items.enum (the real MultipleCheckbox shape)', () => {
  const opt = (v: string) => [v, { formattedText: `<p>${v}</p>`, blueprintMetadataMapping: '' }];
  const arrayNode: SchemaNode = { name: 'f', type: 'array', title: 'F', items: { type: 'string', enum: ['one', 'two', 'three', 'four', 'five'] } };
  it('orders by items.enum when there is no top-level enum', () => {
    const ui: UiSchema = { f: { 'ui:multipleOption': { options: [opt('one'), opt('two'), opt('three'), opt('five'), opt('four')] } } };
    expect(getOptions(ui.f, arrayNode).map((o) => o.value)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });
  it('prefers a top-level enum over items.enum when both exist', () => {
    const both: SchemaNode = { ...arrayNode, enum: ['five', 'four'] };
    const ui: UiSchema = { f: { 'ui:multipleOption': { options: [opt('four'), opt('five')] } } };
    expect(getOptions(ui.f, both).map((o) => o.value)).toEqual(['five', 'four']);
  });
  it('falls back to the enum when there is no options list', () => {
    expect(getOptions({}, arrayNode).map((o) => o.value)).toEqual(['one', 'two', 'three', 'four', 'five']);
  });
});

describe('rich option labels and fields below (real export option metadata)', () => {
  const rich = '<p>(1) net worth <span data-title="&lt;p&gt;tip&lt;/p&gt;">FOOT_NOTE_HERE</span> <u>exceeds</u></p>';
  const ui = (): UiSchema => ({
    f: { 'ui:multipleOption': { options: [
      ['a', { formattedText: rich, pdfMappings: ['x'], fieldsBelow: ['c1', 'c2'], blueprintMetadataMapping: 'bp' }],
      ['b', { formattedText: '<p>Plain B</p>', blueprintMetadataMapping: '' }],
    ] } },
  });
  it('exposes the raw html, a footnote-free plain label, and fieldsBelow', () => {
    const [a, b] = getOptions(ui().f, node);
    expect(a.html).toBe(rich);
    expect(a.label).toBe('(1) net worth  exceeds');
    expect(a.fieldsBelow).toEqual(['c1', 'c2']);
    expect(b.fieldsBelow).toBeUndefined();
  });
  it('ignores a malformed fieldsBelow', () => {
    const bad: UiSchema = { f: { 'ui:multipleOption': { options: [['a', { formattedText: '<p>A</p>', fieldsBelow: 'nope' }], ['b', { formattedText: '<p>B</p>', fieldsBelow: ['ok', 5, null] }]] } } };
    const [a, b] = getOptions(bad.f, node);
    expect(a.fieldsBelow).toBeUndefined();
    expect(b.fieldsBelow).toEqual(['ok']);
  });
  it('editing one option leaves every other option untouched (rich html, pdfMappings, fieldsBelow)', () => {
    const base = ui();
    const options = getOptions(base.f, node);
    const next = setOptions(base, 'f', options.map((o) => (o.value === 'b' ? { ...o, label: 'Renamed B' } : o)));
    const raw = (next.f['ui:multipleOption'] as { options: [string, Record<string, unknown>][] }).options;
    expect(raw[0][1]).toEqual({ formattedText: rich, pdfMappings: ['x'], fieldsBelow: ['c1', 'c2'], blueprintMetadataMapping: 'bp' });
    expect(raw[1][1].formattedText).toBe('<p>Renamed B</p>');
  });
  it('renaming an option rebuilds its text but keeps its other metadata', () => {
    const base = ui();
    const options = getOptions(base.f, node);
    const next = setOptions(base, 'f', options.map((o) => (o.value === 'a' ? { ...o, label: 'Plain A' } : o)));
    const raw = (next.f['ui:multipleOption'] as { options: [string, Record<string, unknown>][] }).options;
    expect(raw[0][1]).toMatchObject({ formattedText: '<p>Plain A</p>', pdfMappings: ['x'], fieldsBelow: ['c1', 'c2'], blueprintMetadataMapping: 'bp' });
  });
  it('sets and clears fieldsBelow through the Option, and keeps it when the Option does not mention it', () => {
    const base = ui();
    const options = getOptions(base.f, node);
    const cleared = setOptions(base, 'f', options.map((o) => (o.value === 'a' ? { ...o, fieldsBelow: [] } : o)));
    expect('fieldsBelow' in (cleared.f['ui:multipleOption'] as { options: [string, Record<string, unknown>][] }).options[0][1]).toBe(false);
    const withNew = setOptions(base, 'f', options.map((o) => (o.value === 'b' ? { ...o, fieldsBelow: ['z'] } : o)));
    expect(getOptions(withNew.f, node)[1].fieldsBelow).toEqual(['z']);
    const kept = setOptions(base, 'f', options.map(({ value, label }) => ({ value, label })));
    expect(getOptions(kept.f, node)[0].fieldsBelow).toEqual(['c1', 'c2']);
  });
  it('gives a newly added option fresh metadata', () => {
    const base = ui();
    const next = setOptions(base, 'f', [...getOptions(base.f, node), { value: 'new', label: 'New <b>' }]);
    const raw = (next.f['ui:multipleOption'] as { options: [string, Record<string, unknown>][] }).options;
    expect(raw[2]).toEqual(['new', { formattedText: '<p>New &lt;b&gt;</p>', blueprintMetadataMapping: '' }]);
  });
});
