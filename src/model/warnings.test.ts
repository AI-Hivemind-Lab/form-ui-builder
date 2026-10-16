import { describe, expect, it } from 'vitest';
import { loadForm } from './loadForm';
import type { FormDoc } from './types';
import { allWarnings, visibleWarnings, warningKey, warningsFor } from './warnings';

const doc = (ui: FormDoc['uiSchema'], extra: string[] = []): FormDoc => ({
  schema: { type: 'object', properties: [{ name: 'p', type: 'object', title: 'P', properties: ['a', ...extra].map((name) => ({ name, type: 'string', title: name })) }] },
  uiSchema: { p: { 'ui:widget': 'Page' }, ...ui },
});
const node = (d: FormDoc, name: string) => d.schema.properties[0].properties!.find((n) => n.name === name)!;

describe('warningsFor', () => {
  it('flags a field with no label or an empty one, not one with text', () => {
    const d = doc({ a: { 'ui:widget': 'TextBox' }, b: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p> <span> * </span></p>'.replace('*', '') }, c: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name</p>' } }, ['b', 'c']);
    expect(warningsFor(d, node(d, 'a'))).toEqual(['Missing label']);
    expect(warningsFor(d, node(d, 'b'))).toEqual(['Missing label']);
    expect(warningsFor(d, node(d, 'c'))).toEqual([]);
  });
  it('does not ask groups, headers or pages for a label', () => {
    const d = doc({ a: { 'ui:widget': 'Group' }, h: { 'ui:widget': 'Header' } }, ['h']);
    expect(allWarnings(d)).toEqual([]);
  });
  it('flags an empty footnote but not one with text', () => {
    const empty = '<p>Name<span data-title="&lt;p&gt;&lt;/p&gt;">FOOT_NOTE_HERE</span></p>';
    const full = '<p>Name<span data-title="&lt;p&gt;note&lt;/p&gt;">FOOT_NOTE_HERE</span></p>';
    const d = doc({ a: { 'ui:widget': 'TextBox', 'ui:formattedText': empty }, b: { 'ui:widget': 'TextBox', 'ui:formattedText': full } }, ['b']);
    expect(warningsFor(d, node(d, 'a'))).toEqual(['Footnote has no text']);
    expect(warningsFor(d, node(d, 'b'))).toEqual([]);
  });
  it('flags a signature without a signer name', () => {
    const d = doc({ a: { 'ui:widget': 'Signature' } });
    expect(warningsFor(d, node(d, 'a'))).toEqual(['Missing signer name']);
    const ok = doc({ a: { 'ui:widget': 'Signature', 'ui:signatureSigner': 'Individual Signatory' } });
    expect(warningsFor(ok, node(ok, 'a'))).toEqual([]);
  });
  it('counts options without a label', () => {
    const d = doc({ a: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Pick</p>', 'ui:multipleOption': { options: [['x', { formattedText: '' }], ['y', { formattedText: '<p>Y</p>' }], ['z', {}]] } } });
    expect(warningsFor(d, node(d, 'a'))).toEqual(['2 options missing a label']);
  });
  it('lists warnings in form order', () => {
    const d = doc({ a: { 'ui:widget': 'TextBox' }, b: { 'ui:widget': 'TextBox' } }, ['b']);
    expect(allWarnings(d).map((w) => w.name)).toEqual(['a', 'b']);
  });
});

describe('ignored warnings', () => {
  it('hides only the ignored message on that widget', () => {
    const d = doc({ a: { 'ui:widget': 'TextBox' }, b: { 'ui:widget': 'TextBox' } }, ['b']);
    const ignored = [warningKey('a', 'Missing label')];
    expect(visibleWarnings(d, node(d, 'a'), ignored)).toEqual([]);
    expect(visibleWarnings(d, node(d, 'b'), ignored)).toEqual(['Missing label']);
    expect(allWarnings(d, ignored).map((w) => w.name)).toEqual(['b']);
  });
});

describe('lone checkbox', () => {
  it('is labelled by its single option, so no widget label is needed', () => {
    const d = doc({ a: { 'ui:widget': 'MultipleCheckbox', 'ui:multipleOption': { options: [['x', { formattedText: '<p>Check this box</p>' }]] } } });
    expect(warningsFor(d, node(d, 'a'))).toEqual([]);
    const two = doc({ a: { 'ui:widget': 'MultipleCheckbox', 'ui:multipleOption': { options: [['x', { formattedText: '<p>A</p>' }], ['y', { formattedText: '<p>B</p>' }]] } } });
    expect(warningsFor(two, node(two, 'a'))).toEqual(['Missing label']);
  });
});

describe('boxes that need no label of their own', () => {
  const nodes = [
    { name: 'radio', type: 'string', title: 'r', enum: ['a'] },
    { name: 'below', type: 'string', title: 'Please specify' },
    { name: 'plain', type: 'string', title: 'p' },
    { name: 'hidden', type: 'string', title: 'h' },
  ];
  const doc = loadForm({
    namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: nodes }, uiSchema: {
      radio: { 'ui:widget': 'Radio', 'ui:formattedText': '<p>Q</p>', 'ui:multipleOption': { options: [['a', { formattedText: '<p>Other</p>', fieldsBelow: ['below'] }]] } },
      below: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:placeholder': 'Please specify' },
      plain: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:placeholder': 'Type here' },
      hidden: { 'ui:widget': 'TextBox', 'ui:formattedText': '', 'ui:invisible': true },
    } } },
  });
  it('accepts an empty label under an option when a placeholder says what to type, and on invisible plumbing boxes', () => {
    expect(allWarnings(doc).map((w) => w.name)).toEqual(['plain']);
  });
});

describe('repeatables', () => {
  it('are never flagged for a missing label: their rows carry the labels', () => {
    const doc = loadForm({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: [{ name: 'rep', type: 'array', title: 'r', properties: [{ name: 'n', type: 'string', title: 'n' }] }] }, uiSchema: { rep: { 'ui:widget': 'Repeatable', 'ui:formattedText': '' }, n: { 'ui:widget': 'TextBox', 'ui:formattedText': '<p>Name</p>' } } } } });
    expect(allWarnings(doc)).toEqual([]);
  });
});
