import { describe, expect, it } from 'vitest';
import demo from '../data/demo-form.json';
import { FormLoadError, loadForm, parseFormJson } from './loadForm';

describe('loadForm', () => {
  it('loads the bundled demo export', () => {
    const doc = loadForm(demo);
    expect(doc.schema.properties.map((n) => n.name)).toEqual(['file0', 'demoform']);
    expect(Object.keys(doc.uiSchema)).toHaveLength(24);
  });

  it('falls back to the first namespace when defaultNamespace is missing or unknown', () => {
    const raw = { namespaceFormSchemaMap: { alt: { schema: { properties: [] }, uiSchema: {} } } };
    expect(loadForm(raw).schema.properties).toEqual([]);
    expect(loadForm({ ...raw, defaultNamespace: 'nope' }).schema.properties).toEqual([]);
  });

  it('defaults a missing uiSchema to {}', () => {
    const raw = { namespaceFormSchemaMap: { main: { schema: { properties: [] } } }, defaultNamespace: 'main' };
    expect(loadForm(raw).uiSchema).toEqual({});
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['no namespaceFormSchemaMap', {}],
    ['namespaceFormSchemaMap is an array', { namespaceFormSchemaMap: [] }],
    ['empty namespaceFormSchemaMap', { namespaceFormSchemaMap: {} }],
    ['schema.properties not an array', { namespaceFormSchemaMap: { main: { schema: { properties: {} } } } }],
    ['namespace entry has no schema', { namespaceFormSchemaMap: { main: {} } }],
  ])('rejects %s with a FormLoadError', (_label, raw) => {
    expect(() => loadForm(raw)).toThrow(FormLoadError);
  });
});

describe('parseFormJson', () => {
  it('rejects non-JSON text with a readable message', () => {
    expect(() => parseFormJson('{oops')).toThrow('File is not valid JSON');
  });
  it('parses valid text', () => {
    const text = JSON.stringify({ namespaceFormSchemaMap: { main: { schema: { properties: [] }, uiSchema: {} } } });
    expect(parseFormJson(text).schema.properties).toEqual([]);
  });
});

describe('loadForm node validation (malformed nodes must not reach the renderer)', () => {
  const wrap = (properties: unknown) => ({ namespaceFormSchemaMap: { main: { schema: { properties }, uiSchema: {} } } });
  it.each([
    ['a null node', [null]],
    ['a non-object node', [5]],
    ['a node without a name', [{ type: 'string', title: 'T' }]],
    ['nested properties that is not an array', [{ name: 'g', type: 'object', title: 'G', properties: {} }]],
    ['an enum that is not an array', [{ name: 'a', type: 'string', title: 'A', enum: 'x' }]],
    ['a malformed node nested inside a group', [{ name: 'g', type: 'object', title: 'G', properties: [null] }]],
  ])('rejects %s with a FormLoadError', (_label, properties) => {
    expect(() => loadForm(wrap(properties))).toThrow(FormLoadError);
  });
  it('defaults a missing title to the node name and keeps extra fields', () => {
    const doc = loadForm(wrap([{ name: 'a', type: 'string', format: 'date' }]));
    expect(doc.schema.properties[0]).toMatchObject({ name: 'a', title: 'a', format: 'date' });
  });
});

describe('loadForm remembers where it came from', () => {
  it('records the namespace and the raw source', () => {
    const doc = loadForm(demo);
    expect(doc.namespace).toBe('main');
    expect(doc.source).toBe(demo);
  });
  it('records the fallback namespace when defaultNamespace is missing', () => {
    const raw = { namespaceFormSchemaMap: { alt: { schema: { properties: [] }, uiSchema: {} } } };
    expect(loadForm(raw).namespace).toBe('alt');
  });
});

import { buildExport } from './exportForm';
describe('a Repeatable in Form Builder\'s shape', () => {
  const raw = (rep: Record<string, unknown>) => ({ namespaceFormSchemaMap: { main: { schema: { type: 'object', properties: [rep] }, uiSchema: { rep: { 'ui:widget': 'Repeatable', 'ui:maxLength': 2 }, a: { 'ui:widget': 'TextBox' } } } }, defaultNamespace: 'main' });
  const fb = { name: 'rep', type: 'array', title: 'Contacts', items: { type: 'object', title: 'Contacts', properties: [{ name: 'a', type: 'string', title: 'A' }] } };

  it('has its fields in items.properties: they are read as the node\'s own children', () => {
    const doc = loadForm(raw(fb));
    expect(doc.schema.properties[0].properties?.map((n) => n.name)).toEqual(['a']);
    expect(doc.schema.properties[0].items).toBeUndefined();
  });
  it('goes back out the same way, and a Repeatable built here (fields as its children) is written in that shape too', () => {
    const out = (d: ReturnType<typeof loadForm>) => ((buildExport(d) as { namespaceFormSchemaMap: { main: { schema: { properties: unknown[] } } } }).namespaceFormSchemaMap.main.schema.properties[0]);
    expect(out(loadForm(raw(fb)))).toEqual(fb);
    const own = loadForm(raw({ name: 'rep', type: 'array', title: 'Contacts', properties: [{ name: 'a', type: 'string', title: 'A' }] }));
    expect(out(own)).toEqual(fb);
  });
  it('leaves a checkbox group\'s items.enum alone', () => {
    const doc = loadForm(raw({ name: 'rep', type: 'array', title: 'x', items: { type: 'string', enum: ['y'] } }));
    expect(doc.schema.properties[0].items).toEqual({ type: 'string', enum: ['y'] });
  });
});
